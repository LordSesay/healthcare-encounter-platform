# CI IAM: Jenkins instance role and Terraform deployer role

This root replaces the static `aws-credentials` access key that both Jenkins pipelines used.

| Role | Who uses it | What it can do |
| --- | --- | --- |
| `jenkins-encounter-platform-ci` | Jenkins EC2 host (instance profile) | `Jenkinsfile` deploys only: push to `encounter-platform-*` ECR repos, register task definitions, run the migration task, update `encounter-platform-*-service`, read the M2M smoke-test secret, assume the Terraform role |
| `terraform-encounter-platform-deployer` | `Jenkinsfile.infra`, assumed from the Jenkins role | Create and destroy the stack's resources in `us-east-1`. IAM is limited to `encounter-platform-*` roles and policies, plus three approved AWS-managed policies |

Design decisions:

- **No long-lived keys.** Credentials come from instance metadata and expire within the hour. `cicd/jenkins/verify-aws-identity.sh` fails the build if keys appear in the environment or in `~/.aws/credentials`, or if the caller isn't the expected role.
- **Deploy and provision are separate.** An app deploy never holds Terraform's broader permissions.
- **Jenkins can't change its own access.** This root is applied by an administrator. The Terraform role has an explicit deny on both CI roles and on this root's state (`ci/*`), and both role names sit outside the `encounter-platform-*` prefix the Terraform role manages.
- **No IAM users or access keys.** The Terraform role is explicitly denied `CreateUser`, `CreateAccessKey`, and similar actions.

## Apply (one time, as an administrator)

Run from a machine with admin credentials. Not from Jenkins.

```bash
cd infra/ci
terraform init

# If the role or profile already exist (the setup runbook used to create them
# by hand), import them first instead of letting the apply fail on a name clash:
aws iam get-role --role-name jenkins-encounter-platform-ci >/dev/null 2>&1 && {
  terraform import aws_iam_role.jenkins jenkins-encounter-platform-ci
  terraform import aws_iam_instance_profile.jenkins jenkins-encounter-platform-ci
}

terraform plan -out=ci.tfplan   # read it: 2 roles, 1 instance profile, 2 inline policies
terraform apply ci.tfplan
```

If you imported an existing role, list what was attached by hand and detach anything this root doesn't manage (the old `*FullAccess` policies):

```bash
aws iam list-attached-role-policies --role-name jenkins-encounter-platform-ci
aws iam detach-role-policy --role-name jenkins-encounter-platform-ci --policy-arn <arn>
```

Then, on the Jenkins EC2 instance:

```bash
aws ec2 associate-iam-instance-profile --instance-id <id> --iam-instance-profile Name=jenkins-encounter-platform-ci
# Keep the hop limit at 1. Jenkins uses host networking (cicd/jenkins/docker-compose.yml),
# so it reaches the role; containers on the Docker bridge are one hop away and can't.
aws ec2 modify-instance-metadata-options --instance-id <id> \
  --http-tokens required --http-put-response-hop-limit 1 --http-endpoint enabled
```

Why not hop limit 2? It would let Jenkins run on the bridge network, but it would also hand the role to every
container on the host: `test-db`, image build steps running third-party `npm` install scripts, and anything
started through the Docker socket. One malicious dependency could then push images and update the ECS service.

## Verification plan

Write each result into the evidence record as you run it. None of these have been run yet.

**Run from an admin session.** The policy simulator evaluates permissions without changing anything:

| # | Check | Command | Expected |
| --- | --- | --- | --- |
| 1 | Terraform role can't edit the Jenkins role | `aws iam simulate-principal-policy --policy-source-arn <terraform_role_arn> --action-names iam:PutRolePolicy --resource-arns <jenkins_role_arn> --query 'EvaluationResults[0].EvalDecision'` | `"explicitDeny"` |
| 2 | Terraform role can't create IAM users | same, `--action-names iam:CreateUser --resource-arns '*'` | `"explicitDeny"` |
| 3 | Jenkins role can't use IAM | `--policy-source-arn <jenkins_role_arn> --action-names iam:ListUsers --resource-arns '*'` | `"implicitDeny"` |
| 4 | Jenkins role can push to the app repo | `--policy-source-arn <jenkins_role_arn> --action-names ecr:PutImage --resource-arns arn:aws:ecr:us-east-1:<acct>:repository/encounter-platform-dev-backend` | `"allowed"` |
| 5 | Jenkins role can't push to another repo | same, with `repository/some-other-repo` | `"implicitDeny"` |

**Run inside the Jenkins container** (`docker exec -it jenkins-encounter-ci bash`):

| # | Check | Command | Expected |
| --- | --- | --- | --- |
| 6 | Identity is the instance role | `aws sts get-caller-identity --query Arn --output text` | `arn:aws:sts::<acct>:assumed-role/jenkins-encounter-platform-ci/i-...` |
| 7 | No stored keys | `ls -l ~/.aws/credentials; env \| grep -c AWS_ACCESS_KEY_ID` | `No such file or directory`, then `0` |
| 8 | Bridge containers can't reach the role (run on the EC2 host, not in Jenkins) | `docker run --rm curlimages/curl -s -m 3 -o /dev/null -w '%{http_code}\n' -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60'` | `000` after about 3 s: the token response is dropped at `docker0`. A `200` here means the hop limit is above 1, so stop and fix it |
| 9 | Denied outside its scope | `aws s3 ls` | `AccessDenied` (ListAllMyBuckets isn't granted) |
| 10 | Guard rejects a static key | `AWS_ACCESS_KEY_ID=x AWS_SECRET_ACCESS_KEY=y ./cicd/jenkins/verify-aws-identity.sh jenkins-encounter-platform-ci; echo $?` | `Refusing to run: AWS_ACCESS_KEY_ID is set...`, then `1` |
| 11 | Hop limit is really 1 | `aws ec2 describe-instances --instance-ids <id> --query 'Reservations[0].Instances[0].MetadataOptions.[HttpTokens,HttpPutResponseHopLimit]'` | `["required", 1]` |

**Pipelines:**

| # | Check | Expected |
| --- | --- | --- |
| 12 | `Jenkinsfile`, `ENVIRONMENT=dev`, `DEPLOY=false` | `Verify AWS Identity` passes; all test stages run |
| 13 | `Jenkinsfile.infra`, `dev`, `apply`: stop at Manual Approval | `Assume Terraform Role` prints `assumed-role/terraform-encounter-platform-deployer/jenkins-infra-dev-<n>`; plan completes with no `AccessDenied` |
| 14 | Full dev cycle: infra apply → `Jenkinsfile` deploy → smoke test → infra destroy | Every stage green; `aws-identity.json` in the archived evidence shows the role ARN |

**If a stage fails with `AccessDenied`,** the error names the missing action. Add that one action to the matching statement in `policies.tf`, re-apply this root, and note the change in the build log. Never re-add an access key to get past it.

## After the pipelines are green

1. Delete the `aws-credentials` entry from Jenkins (Manage Jenkins → Credentials).
2. Deactivate and delete the old IAM user's access keys, then delete the user:
   ```bash
   aws iam list-access-keys --user-name <old-jenkins-user>
   aws iam update-access-key --user-name <old-jenkins-user> --access-key-id <id> --status Inactive
   aws iam delete-access-key --user-name <old-jenkins-user> --access-key-id <id>
   ```
3. Confirm with `aws iam get-access-key-last-used --access-key-id <id>`; it should return `NoSuchEntity`.

## Known limits

- **IAM escalation is reduced, not eliminated.** The Terraform role can still `PutRolePolicy` on `encounter-platform-*` roles, and any role it creates could be given broad inline permissions. The full fix is a permissions boundary: require `iam:PermissionsBoundary` on `CreateRole` and set `permissions_boundary` on every role in `infra/modules`.
- **Service permissions are coarse.** `ec2:*`, `rds:*` and similar are pinned to one region but not to resources. After a few clean applies, use IAM Access Analyzer's policy generation (it reads CloudTrail) to replace the wildcards with the actions Terraform actually called.
- **CodeDeploy.** The optional `modules/codedeploy` attaches a policy to `var.jenkins_role_name`, which the Terraform role is now denied. If you enable `enable_ec2_codedeploy`, attach that policy from this root instead of setting `jenkins_role_name`.
- **Host networking trade-off.** Jenkins isn't isolated from the host's network stack, and Docker port mappings no longer apply: 8080 and 50000 listen directly on the instance. The security group (22 and 8080 from your IP only, 50000 closed) is the control that matters. `test-db` publishes only on `127.0.0.1:5433`.
- **Not yet tested.** `terraform validate` and an apply have not been run against AWS. The plan above is how this gets proven.
