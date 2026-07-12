# Production EC2 and CodeDeploy Guide

## Purpose

This is an optional deployment path alongside the existing ECS architecture. It proves that a tested Git commit can become an immutable S3 artifact, deploy to an EC2 application host through CodeDeploy, start under a dedicated operating-system identity, and pass an application health check. The application EC2 instance never needs GitHub credentials.

```text
GitHub -> Jenkins -> tests -> commit-SHA ZIP -> private S3 bucket
       -> CodeDeploy -> EC2 -> systemd -> GET /health
```

The existing `Jenkinsfile` remains the ECS pipeline. Configure a separate Jenkins job with script path `Jenkinsfile.codedeploy` for this workflow.

## Repository Components

| Path | Responsibility |
|---|---|
| `appspec.yml` | CodeDeploy file mappings, permissions, and lifecycle hook order |
| `deployment/scripts/` | Stop, install, start, and health-validation hooks |
| `deployment/systemd/healthcare-encounter-api.service` | Non-root service definition |
| `Jenkinsfile.codedeploy` | Test, package, upload, deploy, and wait pipeline |
| `infra/modules/codedeploy/` | S3, CodeDeploy, IAM, instance profile, and target-tag resources |
| `apps/backend/routes/health.js` | HTTP liveness/dependency response used by `ValidateService` |

## Values You Must Supply

| Value | Source |
|---|---|
| `environment` | One of your Terraform environments, such as `dev` or `prod` |
| `db_password` | Secret Terraform input; do not commit it |
| `codedeploy_target_instance_id` | Existing Linux application EC2 instance ID |
| `jenkins_role_name` | Existing IAM role attached to the Jenkins EC2 instance |
| `codedeploy_artifact_bucket_name` | Optional globally unique name; Terraform derives one when null |
| `DATABASE_URL` | Runtime secret written to the target host through an approved secret bootstrap process |

The Terraform module creates an application instance profile but does not mutate the IAM profile on an existing EC2 instance. Attach the `application_instance_profile_name` output to the target instance. If it already has a profile, merge the generated permissions into that role instead of attaching a second profile.

## Provision AWS Resources

Use an environment-specific uncommitted `.tfvars` file:

```hcl
environment                       = "dev"
db_password                       = "REDACTED"
enable_ec2_codedeploy             = true
codedeploy_target_instance_id     = "i-0123456789abcdef0"
jenkins_role_name                 = "existing-jenkins-ec2-role"
codedeploy_artifact_bucket_name   = null
codedeploy_target_tags            = {}
```

Then run the normal backend initialization for this repository and review the plan before applying:

```bash
cd infra
terraform init -backend-config="key=env/dev/terraform.tfstate"
terraform fmt -check -recursive
terraform validate
terraform plan -var-file=dev.tfvars
terraform apply -var-file=dev.tfvars
terraform output -json codedeploy
```

The module provisions:

- a private, encrypted, versioned S3 release bucket;
- a lifecycle rule for noncurrent artifact versions;
- a CodeDeploy Server application and tag-selected deployment group;
- automatic rollback on deployment failure;
- a CodeDeploy service role;
- an SSM-enabled application EC2 role and instance profile with read-only artifact access;
- a Jenkins policy for release uploads and CodeDeploy operations;
- `Application` and `Environment` tags on the supplied target instance.

## Prepare the EC2 Target

Use Amazon Linux 2023 or another supported systemd Linux distribution. The target requires Node.js compatible with the application, npm, curl, the CodeDeploy agent, and outbound HTTPS access to AWS endpoints. Pin the Node.js major version in your image/bootstrap process.

Attach the generated application instance profile. Confirm SSM access before removing SSH. Install and verify the CodeDeploy agent using the current AWS instructions for your region, then check:

```bash
sudo systemctl status codedeploy-agent
sudo systemctl is-enabled codedeploy-agent
```

The first deployment creates the `encounter-app` system user, installs the version-controlled systemd unit, creates `/etc/healthcare-encounter-platform/runtime.env`, installs production dependencies, and starts the service.

Populate runtime configuration without committing secrets:

```text
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/encounters
CORS_ORIGIN=https://your-frontend.example.com
APP_VERSION=release-version
```

The file must remain `root:encounter-app` mode `0640`. For a stronger production implementation, use instance bootstrap or a root-owned startup helper to fetch the database URL from Secrets Manager using the EC2 role. Do not give Jenkins the database credential.

## Configure Jenkins

Create a pipeline/multibranch job whose script path is `Jenkinsfile.codedeploy`. The Jenkins agent needs:

- Git and repository checkout access;
- Node.js/npm, `zip`, `unzip`, `tar`, and AWS CLI v2;
- an EC2 IAM role with the Terraform-created Jenkins policy attached;
- no static AWS access keys.

Set job parameters from `terraform output -json codedeploy`:

```text
ARTIFACT_BUCKET=<artifact_bucket_name>
CODEDEPLOY_APPLICATION=<application_name>
CODEDEPLOY_GROUP=<deployment_group_name>
```

Each build runs backend tests and the production dependency audit, creates `healthcare-encounter-platform-<40-character-git-sha>.zip`, verifies that `appspec.yml` is at the ZIP root, uploads it to `releases/<git-sha>/`, starts CodeDeploy, and waits for success. The `ValidateService` hook must receive HTTP 200 from `http://127.0.0.1:8080/health`; otherwise CodeDeploy and Jenkins fail.

## Manual First Deployment

Before enabling push-triggered deployments, run the Jenkins job manually. Confirm:

```bash
aws s3api head-object --bucket <bucket> --key releases/<sha>/healthcare-encounter-platform-<sha>.zip
aws deploy get-deployment --deployment-id <deployment-id>
```

On the target through Session Manager:

```bash
sudo systemctl status healthcare-encounter-api.service
curl -i http://127.0.0.1:8080/health
sudo journalctl -u healthcare-encounter-api.service -n 100 --no-pager
sudo tail -n 100 /var/log/aws/codedeploy-agent/codedeploy-agent.log
```

If the database is unreachable, `/health` intentionally returns HTTP 503 and the release fails validation. This prevents a deployment that cannot serve its production dependency from being reported as healthy.

## Rollback and Failure Evidence

The deployment group enables automatic rollback on failure. With a single in-place EC2 target, CodeDeploy redeploys the last known-good revision; this is not zero downtime. Use an Auto Scaling group and blue/green deployment before treating this pattern as highly available production infrastructure.

Record these identifiers for every release:

- full Git commit SHA;
- Jenkins build URL and build number;
- S3 key and object version;
- CodeDeploy deployment ID;
- lifecycle hook result and health response.

To redeploy a known revision manually:

```bash
aws deploy create-deployment \
  --application-name <application> \
  --deployment-group-name <group> \
  --s3-location bucket=<bucket>,key=releases/<sha>/healthcare-encounter-platform-<sha>.zip,bundleType=zip \
  --region <region>
```

## Production Hardening Checklist

- Prove one successful and one intentionally failed deployment.
- Confirm the target has no GitHub deploy key or personal token.
- Confirm Jenkins and EC2 use IAM roles rather than static AWS keys.
- Confirm S3 public access is blocked and versioning is enabled.
- Confirm EC2 is reachable through Session Manager before removing inbound TCP 22.
- Restrict application ingress to the load balancer security group.
- Require IMDSv2 and encrypted EBS in the EC2 definition or launch template.
- Send application and CodeDeploy logs to CloudWatch and alarm on unhealthy targets/deployment failure.
- Add an Auto Scaling group and blue/green strategy when zero-downtime releases are required.

## Definition of Done

A full commit SHA is tested, stored at a unique S3 key, deployed by CodeDeploy without GitHub credentials on the application host, executed as `encounter-app`, and marked successful only after `/health` returns HTTP 200.
