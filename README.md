# Healthcare Encounter ID Source-of-Truth Platform

A production-style healthcare interoperability platform that acts as the centralized source of truth for encounter identifiers across hospital systems.

When an EHR triggers an ADT event, an integration engine forwards the encounter context to this platform API. The platform generates or resolves a unique encounter ID, stores it, returns it to the EHR, and allows downstream systems to reference the same identifier across the patient visit lifecycle.

> API-driven healthcare encounter ID source-of-truth platform using React, Node.js, PostgreSQL, Docker, Jenkins, Terraform, ECS, ALB, ECR, RDS, and Secrets Manager.

---

## Core Encounter Workflow

1. EHR system triggers an ADT event.
2. Integration engine forwards the encounter request to the platform API.
3. API generates or resolves a unique encounter ID.
4. Encounter ID is stored as the canonical source of truth.
5. Encounter ID is returned to the EHR.
6. ID is injected back into the EHR encounter record.
7. Downstream systems reference the same encounter identifier.

---

## Architecture Flow

```
EHR / ADT Event
        ↓
Integration Engine
        ↓
Encounter Platform API
        ↓
Encounter Database
        ↓
API Response with Encounter ID
        ↓
EHR Encounter Record
        ↓
Downstream Systems
```

---

## API Platform Role

This platform is designed to sit between hospital systems and downstream applications as an interchangeable API layer.

Instead of every system managing encounter identity differently, this API provides a consistent encounter ID that can be reused across:

- EHR systems
- Integration engines
- Billing platforms
- Lab systems
- Clinical documentation tools
- Reporting and analytics pipelines

### ADT Event Ingestion
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/encounters/from-adt` | POST | Ingest ADT events (A01, A02, A03, A04, A08) |

### Encounter Resolution (for downstream systems)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/encounters/resolve?mrn=X&csn=Y` | GET | Resolve encounter ID by external identifiers |

### Encounter Lifecycle
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/encounters` | POST | Create encounter directly |
| `/api/encounters` | GET | List/filter encounters |
| `/api/encounters/:id` | GET | Get encounter detail + history |
| `/api/encounters/:id/status` | PATCH | Advance lifecycle status |
| `/api/encounters/stats` | GET | Operational dashboard stats |

### System Identification
All consumers pass `X-Source-System` header to identify the calling system for audit purposes.

---

## Features

- Generates or resolves canonical encounter IDs
- Stores encounter identity as the source of truth
- Returns encounter IDs to EHR systems through API response
- Supports downstream system lookup by encounter ID
- Provides lifecycle visibility across registration, treatment, billing, and reporting
- Idempotent — duplicate ADT events return the existing encounter (HTTP 200)
- Vendor-neutral — works with any EHR via integration engine

---

## Multi-ADT Event Support

| Event | Action | Behavior |
|-------|--------|----------|
| ADT_A01 | Admit | Creates encounter → `checked-in` |
| ADT_A02 | Transfer | Advances → `in-progress` |
| ADT_A03 | Discharge | Advances → `discharged` |
| ADT_A04 | Register | Creates encounter → `created` |
| ADT_A08 | Update | Updates metadata on existing encounter |

---

## CI/CD Pipeline

1. Code pushed to GitHub
2. Jenkins (EC2) triggers pipeline
3. Backend & frontend containerized via Docker
4. Images tagged with build numbers → pushed to ECR
5. ECS task definition dynamically updated with new revision
6. Zero-downtime rollout behind ALB

---

## Infrastructure

- [x] RDS (PostgreSQL) persistence layer
- [x] Secrets Manager for credential management
- [x] ECS Fargate orchestration
- [x] ALB with path-based routing
- [x] Route 53 DNS configuration
- [x] IAM roles and policies
- [x] VPC with public/private subnets
- [x] ECR image repositories
- [x] Multi-environment support (dev/staging/prod)

---

## Challenges & Solutions

| Problem | Solution |
|---------|----------|
| ECS failed to pull images | Proper ECR tagging + versioned deployment |
| Jenkins Docker permission errors | Fixed Docker socket configuration |
| CI builds failing on warnings | Enforced production-grade build standards |
| Frontend/backend routing issues | ALB path-based routing + relative API paths |

---

## Future Enhancements

- [ ] Authentication & RBAC (API key per system)
- [ ] Webhook callbacks for async notifications
- [ ] CI/CD rollback automation
- [ ] Monitoring (CloudWatch / Prometheus)
- [ ] Blue/green deployments

---

## Connect

Built by **Malcolm Sesay**
🔗 [LinkedIn](https://www.linkedin.com/in/malcolmsesay/)

---

## Tags

`#DevOps` `#AWS` `#CICD` `#CloudEngineering` `#Jenkins` `#ECS` `#Docker` `#Terraform` `#HealthcareTech` `#Interoperability`
