# Healthcare Integration Architecture

## Purpose

This platform serves as a centralized, API-driven source of truth for healthcare encounter identifiers. When a hospital EHR triggers an ADT event, an integration engine forwards the event payload to the platform API. The platform generates or resolves a unique encounter ID, stores it in PostgreSQL, and returns it to the EHR so the same identifier can be reused across clinical, billing, lab, and reporting systems.

## Architecture Flow

```text
EHR triggers ADT event (A01/A02/A03/A04/A08)
  -> Integration engine (Epic Bridges / Rhapsody / MuleSoft)
  -> POST /api/encounters/from-adt
  -> Platform generates or resolves Encounter ID
  -> Encounter ID and metadata stored in PostgreSQL
  -> ID returned to integration engine
  -> EHR stores canonical encounter ID
  -> Downstream systems resolve the same ID
     - Billing:   GET /api/encounters/resolve?mrn=X&csn=Y
     - Lab:       GET /api/encounters/resolve?mrn=X&facility_id=Z
     - Reporting: GET /api/encounters/:encounterId
```

## Supported ADT Events

| Event | Action | Platform Behavior |
| --- | --- | --- |
| ADT_A01 | Admit | Creates encounter, sets status to `checked-in` |
| ADT_A02 | Transfer | Advances existing encounter to `in-progress` |
| ADT_A03 | Discharge | Advances existing encounter to `discharged` |
| ADT_A04 | Register | Creates encounter, sets status to `created` |
| ADT_A08 | Update | Updates existing encounter metadata |

## Resolve Endpoint

Downstream systems call the resolve endpoint to look up the canonical encounter ID without needing to know the internal identifier:

```text
GET /api/encounters/resolve?mrn=PAT-12345&csn=CSN-67890
GET /api/encounters/resolve?mrn=PAT-12345&facility_id=CLINIC-A
```

Returns:

```json
{
  "encounter_id": "ENC-20250101-A1B2C3D4",
  "status": "in-progress",
  "patient_reference": "PAT-12345",
  "facility": "CLINIC-A"
}
```

## System Identification

All API consumers pass an `X-Source-System` header to identify themselves:

```text
X-Source-System: epic-bridges
X-Source-System: billing-engine
X-Source-System: lab-lis
```

This enables audit trails showing which system triggered each encounter event.

## Idempotency

The platform guarantees idempotent behavior:

- If an ADT event with the same `event_id` is received twice, the existing encounter is returned with HTTP 200.
- If a register/admit event arrives for a patient and visit that already has an encounter, the existing ID is returned.
- Transfer, discharge, and update events fail clearly if no encounter exists.

## Vendor Neutrality

The platform is EHR-agnostic. It accepts standardized ADT payloads regardless of whether the source is Epic, Cerner, MEDITECH, or another system. The integration engine normalizes vendor-specific formats before calling the API.
