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

## Identity and event processing

The body `source_system` is caller-asserted provenance, not authentication. `X-Source-System` does not establish a verified identity. Machine authentication remains future work.

PostgreSQL enforces scoped visit and message uniqueness. Exact retries return the original response; changed content under a used message ID, stale events, and invalid lifecycle transitions are rejected. See the [normalized envelope contract](../normalized-adt.md) for required fields, namespace rules, migration and verification instructions. The API consumes normalized JSON and does not parse HL7 v2.

## Vendor Neutrality

The platform is EHR-agnostic. It accepts standardized ADT payloads regardless of whether the source is Epic, Cerner, MEDITECH, or another system. The integration engine normalizes vendor-specific formats before calling the API.
