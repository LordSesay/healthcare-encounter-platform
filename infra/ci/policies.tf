# Every statement below maps to an AWS call the pipelines actually make.
# Application resources are named <project>-<env>-..., so "${local.prefix}-*"
# covers dev, staging and prod without listing each environment.

# ── App pipeline (Jenkinsfile) ───────────────────────────────────────────────

data "aws_iam_policy_document" "jenkins_app_deploy" {
  # ECR Login stage. GetAuthorizationToken has no resource-level permissions.
  statement {
    sid       = "EcrLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  # Push Images and Record Image Digests stages.
  statement {
    sid = "EcrPushAndDescribe"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:DescribeImages",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = ["arn:aws:ecr:${local.region}:${local.account}:repository/${local.prefix}-*"]
  }

  # render-taskdef.sh / register-taskdef.sh. Neither action supports
  # resource-level permissions, so pin the region instead.
  statement {
    sid       = "EcsTaskDefinitions"
    actions   = ["ecs:DescribeTaskDefinition", "ecs:RegisterTaskDefinition"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "aws:RequestedRegion"
      values   = [local.region]
    }
  }

  # Deploy to ECS stage, `aws ecs wait services-stable`, smoke evidence.
  statement {
    sid       = "EcsServices"
    actions   = ["ecs:DescribeServices", "ecs:UpdateService"]
    resources = ["arn:aws:ecs:${local.region}:${local.account}:service/${local.prefix}-*-cluster/${local.prefix}-*-service"]
  }

  # run-migration.sh: one-off Fargate task, only in this project's clusters.
  statement {
    sid       = "EcsMigrationTask"
    actions   = ["ecs:RunTask"]
    resources = ["arn:aws:ecs:${local.region}:${local.account}:task-definition/${local.prefix}-*-task:*"]
    condition {
      test     = "ArnLike"
      variable = "ecs:cluster"
      values   = ["arn:aws:ecs:${local.region}:${local.account}:cluster/${local.prefix}-*-cluster"]
    }
  }

  statement {
    sid       = "EcsDescribeTasks"
    actions   = ["ecs:DescribeTasks"]
    resources = ["arn:aws:ecs:${local.region}:${local.account}:task/${local.prefix}-*-cluster/*"]
  }

  # Registering a task definition or running a task that names an execution
  # role requires passing that role, and only to ECS.
  statement {
    sid       = "PassTaskExecutionRole"
    actions   = ["iam:PassRole"]
    resources = ["arn:aws:iam::${local.account}:role/${local.prefix}-*-ecs-exec-role"]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }

  # smoke.sh reads the Cognito M2M client secret.
  statement {
    sid       = "ReadSmokeTestClient"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = ["arn:aws:secretsmanager:${local.region}:${local.account}:secret:${local.prefix}/*/m2m-client-*"]
  }

  # That secret is encrypted with a per-environment customer-managed key whose
  # ARN isn't known here. The conditions limit decryption to Secrets Manager
  # calls for that one secret.
  statement {
    sid       = "DecryptSmokeTestClient"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${local.region}.amazonaws.com"]
    }
    condition {
      test     = "ArnLike"
      variable = "kms:EncryptionContext:SecretARN"
      values   = ["arn:aws:secretsmanager:${local.region}:${local.account}:secret:${local.prefix}/*/m2m-client-*"]
    }
  }

  # Post-Deploy Smoke Test looks up the ALB DNS name. No resource-level support.
  statement {
    sid       = "FindAlb"
    actions   = ["elasticloadbalancing:DescribeLoadBalancers"]
    resources = ["*"]
  }

  # Jenkinsfile.infra switches to the Terraform role for plan/apply.
  statement {
    sid       = "AssumeTerraformRole"
    actions   = ["sts:AssumeRole"]
    resources = [aws_iam_role.terraform.arn]
  }
}

# ── Infra pipeline (Jenkinsfile.infra → Terraform) ───────────────────────────

data "aws_iam_policy_document" "terraform_deploy" {
  # S3 backend: list the bucket, read/write state only under env/*.
  statement {
    sid       = "StateBucketList"
    actions   = ["s3:ListBucket"]
    resources = ["arn:aws:s3:::${var.state_bucket_name}"]
  }

  statement {
    sid       = "StateObjects"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["arn:aws:s3:::${var.state_bucket_name}/env/*"]
  }

  statement {
    sid       = "StateLock"
    actions   = ["dynamodb:DescribeTable", "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem"]
    resources = ["arn:aws:dynamodb:${local.region}:${local.account}:table/${var.lock_table_name}"]
  }

  # Services the stack creates (see infra/modules). Coarse by service but
  # pinned to one region; IAM, the escalation path, is handled separately below.
  statement {
    sid = "ManagedServices"
    actions = [
      "acm:*",
      "application-autoscaling:*",
      "cloudwatch:*",
      "codedeploy:*",
      "cognito-idp:*",
      "ec2:*",
      "ecr:*",
      "ecs:*",
      "elasticloadbalancing:*",
      "kms:*",
      "logs:*",
      "rds:*",
      "secretsmanager:*",
    ]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "aws:RequestedRegion"
      values   = [local.region]
    }
  }

  # Route 53 is global, so it can't take the region condition.
  statement {
    sid       = "Dns"
    actions   = ["route53:*"]
    resources = ["*"]
  }

  # Optional CodeDeploy artifact bucket (<project>-<env>-...-releases).
  statement {
    sid       = "ProjectBuckets"
    actions   = ["s3:*"]
    resources = ["arn:aws:s3:::${local.prefix}-*", "arn:aws:s3:::${local.prefix}-*/*"]
  }

  # Terraform refresh reads IAM objects it manages.
  statement {
    sid       = "IamRead"
    actions   = ["iam:Get*", "iam:List*"]
    resources = ["*"]
  }

  statement {
    sid = "IamProjectRoles"
    actions = [
      "iam:CreateRole",
      "iam:DeleteRole",
      "iam:DeleteRolePolicy",
      "iam:DetachRolePolicy",
      "iam:PutRolePolicy",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:UpdateAssumeRolePolicy",
      "iam:UpdateRole",
      "iam:UpdateRoleDescription",
    ]
    resources = ["arn:aws:iam::${local.account}:role/${local.prefix}-*"]
  }

  # Attaching managed policies is limited to the three AWS policies the stack
  # uses plus the project's own customer-managed policies. AdministratorAccess
  # and other AWS policies can't be attached.
  statement {
    sid       = "IamAttachApprovedPolicies"
    actions   = ["iam:AttachRolePolicy"]
    resources = ["arn:aws:iam::${local.account}:role/${local.prefix}-*"]
    condition {
      test     = "ArnLike"
      variable = "iam:PolicyARN"
      values = [
        "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
        "arn:aws:iam::aws:policy/service-role/AWSCodeDeployRole",
        "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
        "arn:aws:iam::${local.account}:policy/${local.prefix}-*",
      ]
    }
  }

  statement {
    sid = "IamProjectPolicies"
    actions = [
      "iam:CreatePolicy",
      "iam:CreatePolicyVersion",
      "iam:DeletePolicy",
      "iam:DeletePolicyVersion",
      "iam:TagPolicy",
      "iam:UntagPolicy",
    ]
    resources = ["arn:aws:iam::${local.account}:policy/${local.prefix}-*"]
  }

  statement {
    sid = "IamProjectInstanceProfiles"
    actions = [
      "iam:AddRoleToInstanceProfile",
      "iam:CreateInstanceProfile",
      "iam:DeleteInstanceProfile",
      "iam:RemoveRoleFromInstanceProfile",
      "iam:TagInstanceProfile",
      "iam:UntagInstanceProfile",
    ]
    resources = ["arn:aws:iam::${local.account}:instance-profile/${local.prefix}-*"]
  }

  # Task definitions, CodeDeploy groups, autoscaling targets and instance
  # profiles all pass a project role to an AWS service.
  statement {
    sid       = "IamPassProjectRoles"
    actions   = ["iam:PassRole"]
    resources = ["arn:aws:iam::${local.account}:role/${local.prefix}-*"]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values = [
        "application-autoscaling.amazonaws.com",
        "codedeploy.amazonaws.com",
        "ec2.amazonaws.com",
        "ecs-tasks.amazonaws.com",
      ]
    }
  }

  # First-time use of ECS, ELB, RDS or ECS autoscaling in an account creates
  # their service-linked roles.
  statement {
    sid       = "ServiceLinkedRoles"
    actions   = ["iam:CreateServiceLinkedRole"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "iam:AWSServiceName"
      values = [
        "ecs.amazonaws.com",
        "ecs.application-autoscaling.amazonaws.com",
        "elasticloadbalancing.amazonaws.com",
        "rds.amazonaws.com",
      ]
    }
  }

  # Explicit denies win over every Allow above, including future mistakes.
  statement {
    sid     = "DenyCiIdentityChanges"
    effect  = "Deny"
    actions = ["iam:*"]
    resources = [
      aws_iam_role.jenkins.arn,
      aws_iam_instance_profile.jenkins.arn,
      "arn:aws:iam::${local.account}:role/${var.terraform_role_name}",
    ]
  }

  statement {
    sid    = "DenyLongLivedCredentials"
    effect = "Deny"
    actions = [
      "iam:AttachUserPolicy",
      "iam:CreateAccessKey",
      "iam:CreateLoginProfile",
      "iam:CreateUser",
      "iam:PutUserPolicy",
      "iam:UpdateAccessKey",
    ]
    resources = ["*"]
  }

  statement {
    sid       = "DenyCiState"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = ["arn:aws:s3:::${var.state_bucket_name}/ci/*"]
  }
}
