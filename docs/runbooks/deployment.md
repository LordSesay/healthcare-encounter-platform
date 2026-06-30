# Deployment Runbook

## Purpose

This runbook explains how code moves from GitHub to ECS.

## Flow

1. Developer pushes code to GitHub.
2. Jenkins checks out the repository.
3. Backend dependencies are installed.
4. Backend tests run as a deployment gate.
5. Frontend dependencies are installed.
6. Frontend production build is created.
7. Docker images are built for backend and frontend.
8. Images are tagged with `latest` and the Jenkins build number.
9. Images are pushed to ECR.
10. Jenkins renders a new ECS task definition revision.
11. ECS service is updated to the exact task definition ARN.
12. Jenkins waits for ECS service stability.

## Why This Matters

For a healthcare encounter ID platform, deployments must be traceable and repeatable. Clinic check-in and downstream hospital workflows depend on the encounter API returning consistent identifiers.

## Current Deployment Strategy

```text
Build image -> Push to ECR -> Register task definition -> Update ECS service -> Wait for stability
```

## Immutable ECS Deployment Upgrade

The pipeline deploys by registering a new ECS task definition revision for each Jenkins build.

1. Jenkins builds backend and frontend Docker images.
2. Images are tagged with the Jenkins build number.
3. Images are pushed to Amazon ECR.
4. Jenkins fetches the current ECS task definition.
5. Backend and frontend container image values are replaced with the new ECR image tags.
6. Jenkins registers a new ECS task definition revision.
7. ECS service is updated to the exact new task definition ARN.
8. Jenkins waits for ECS service stability.

This improves auditability, rollback capability, and deployment traceability.

## DNS

Route 53 and HTTPS are optional. The default production-style portfolio deployment can be served directly from the ALB DNS name.
