# Healthcare Encounter ID Source-of-Truth Platform

Production-style healthcare interoperability platform for generating, resolving, and tracking canonical encounter identifiers across simulated hospital systems.

When an EHR sends an ADT event through an integration engine, this API creates or resolves the encounter ID, stores it in PostgreSQL, and returns the same identifier for downstream systems such as billing, labs, clinical documentation, and analytics.

> Built with React, Node.js, PostgreSQL, Docker, Jenkins, Terraform, ECS Fargate, ALB, ECR, RDS, CloudWatch Logs, IAM, and Secrets Manager.

No PHI is used in this project. All patient and visit values are synthetic.

## Production Access

The application is designed to run behind an AWS Application Load Balancer.

- Primary production access: ALB DNS name
- Optional: Route 53 hosted zone, ACM certificate, and custom domain
- Default Terraform path: no custom domain required

This keeps the portfolio deployment realistic without requiring a purchased domain.

## Core Workflow

1. EHR emits an ADT event.
2. Integration engine forwards patient and visit context to the API.
3. API creates or resolves the canonical encounter ID.
4. Encounter identity is stored in PostgreSQL.
5. API returns the encounter ID to the caller.
6. Downstream systems resolve the same ID throughout the visit lifecycle.

```text
EHR / ADT Event
  -> Integration Engine
  -> Encounter Platform API
  -> PostgreSQL Encounter Store
  -> API Response with Encounter ID
  -> EHR Encounter Record
  -> Downstream Systems
```

## API Capabilities

### ADT Ingestion

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/encounters/from-adt` | POST | Ingest ADT_A01, ADT_A02, ADT_A03, ADT_A04, and ADT_A08 events |

### Encounter Resolution

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/encounters/resolve?mrn=X&csn=Y` | GET | Resolve encounter ID by external identifiers |

### Encounter Lifecycle

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/encounters` | POST | Create an encounter directly |
| `/api/encounters` | GET | List and filter encounters |
| `/api/encounters/:id` | GET | Get encounter details and status history |
| `/api/encounters/:id/status` | PATCH | Advance lifecycle status |
| `/api/encounters/stats` | GET | Return operational dashboard metrics |

All API consumers can pass `X-Source-System` to identify the calling integration or hospital system for audit context.

## ADT Event Behavior

| Event | Meaning | Behavior |
| --- | --- | --- |
| `ADT_A01` | Admit | Creates or resolves encounter as `checked-in` |
| `ADT_A02` | Transfer | Advances existing encounter to `in-progress` |
| `ADT_A03` | Discharge | Advances existing encounter to `discharged` |
| `ADT_A04` | Register | Creates or resolves encounter as `created` |
| `ADT_A08` | Update | Updates metadata on an existing encounter |

Duplicate ADT events return the existing encounter ID instead of creating duplicate records.

## Cloud Architecture

- React frontend served by Nginx container
- Node.js/Express backend API
- PostgreSQL persistence on Amazon RDS
- ECS Fargate service running frontend and backend containers
- ALB path-based routing for `/api/*` and frontend traffic
- ECR repositories for immutable image tags
- Secrets Manager for database connection configuration
- CloudWatch Logs for container output
- Terraform modules for VPC, security groups, ALB, ECS, ECR, RDS, IAM, secrets, and optional DNS

## CI/CD Pipeline

1. Jenkins checks out the repository.
2. Backend dependencies are installed with `npm ci`.
3. Backend tests run as a deployment gate.
4. Frontend dependencies are installed and production build is created.
5. Backend and frontend Docker images are built.
6. Images are tagged with the Jenkins build number and pushed to ECR.
7. Jenkins renders a new ECS task definition revision.
8. ECS service is updated to the exact task definition ARN.
9. Jenkins waits for ECS service stability.

Production deployments support promotion by image tag, with a manual approval gate before rollout.

## Local Development

```bash
docker compose up --build
```

Default local services:

- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:8080`
- PostgreSQL: `localhost:5432`

Run backend tests:

```bash
cd apps/backend
npm test
```

## Terraform Notes

Route 53 and HTTPS are optional.

Default portfolio deployment:

```hcl
enable_dns   = false
enable_https = false
```

Custom domain deployment:

```hcl
enable_dns   = true
enable_https = true
domain_name  = "encounters.example.com"
```

## Validation Scenario

The platform was validated with simulated ADT payloads. Repeated ADT messages with the same visit reference resolve to the original encounter ID, demonstrating idempotent encounter identity behavior.

## Future Enhancements

- API key authentication per source system
- RBAC for operational users
- Rollback automation by previous ECS task definition
- CloudWatch alarms and dashboard
- Blue/green deployment strategy
- OpenAPI documentation

## Portfolio Summary

This project demonstrates cloud application delivery, healthcare interoperability modeling, infrastructure as code, containerized deployments, CI/CD automation, and production-oriented AWS architecture.

Built by **Malcolm Sesay**

[LinkedIn](https://www.linkedin.com/in/malcolmsesay/)

## Tags

`#DevOps` `#AWS` `#CICD` `#CloudEngineering` `#Jenkins` `#ECS` `#Docker` `#Terraform` `#HealthcareTech` `#Interoperability`
