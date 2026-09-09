# Normalized ADT envelope and Phase 1 guarantees

This prototype consumes normalized JSON from an upstream integration engine. It does not parse native HL7 v2 messages. These rules are a deliberately limited lifecycle model, not a complete clinical workflow specification.

POST `/api/encounters/from-adt`:

```json
{
  "event_type": "ADT_A01",
  "event_id": "message-0001",
  "source_system": "ehr-demo",
  "occurred_at": "2026-01-01T10:00:00Z",
  "patient": { "mrn": "synthetic-123", "assigning_authority": "hospital-demo" },
  "visit": { "visit_id": "visit-456", "facility_id": "north", "department": "emergency" }
}
```

All shown identity fields and `occurred_at` are required. A shared validator enforces the [RFC 3339 calendar and offset syntax](https://www.rfc-editor.org/rfc/rfc3339.html#section-5.6), with an explicit application profile: years 0001–9999 (including the normalized UTC year), seconds 00–59, and at most three fractional digits. Leap seconds and finer precision are rejected with 400 rather than rounded. Upper/lowercase T and Z and numeric offsets are accepted; equivalent instants normalize to UTC milliseconds before hashing. Invalid dates such as February 30, 24:00, missing offsets, and natural-language dates are rejected. `visit.epic_csn` is a compatibility alias for `visit.visit_id`; conflicting aliases are rejected. A message ID never substitutes for a visit ID. Identifiers are case-sensitive. Optional visit metadata: `visit_type`, `department`, `priority`, `attending_provider`, `location`, `notes`. Values must be nonempty strings; omission preserves existing values, and null/clearing is not supported in this version. Priorities: low, normal, urgent, critical.

## Identity and retries

- Encounter uniqueness: `(source_system, facility, visit_id)`, enforced by a PostgreSQL unique index.
- Message uniqueness: `(source_system, facility, event_id)`, enforced by the inbox unique constraint.
- Patient identity: `(assigning_authority, mrn)`; an existing visit cannot be reassigned to a different patient. Legacy records with no assigning authority need explicit reconciliation before ADT updates.
- Inbox insertion, encounter mutation, history and response recording commit together. A per-visit transaction lock serializes first creation and subsequent processing. Unexpected database failures roll everything back and can be retried.
- An exact retry returns HTTP 200 and the original stored response, including the original status. Use GET to read current encounter state. The comparison hashes normalized supported fields; unknown fields are ignored.
- Changed content under a used message ID returns 409. A new message for an existing visit must satisfy lifecycle and ordering rules; it never creates another encounter.
- Well-formed events rejected by domain rules are stored with `outcome=rejected`, a response, timestamp and payload hash. Retrying that ID returns the same rejection. Corrections require a new message ID. Malformed envelopes fail with 400 before inbox insertion. No automatic replay or reconciliation UI is provided.
- The inbox stores provenance and a hash, not a full payload. Retain the original envelope in the upstream integration engine for reconciliation. `source_system` remains caller asserted until authentication is implemented in Phase 3.

## Lifecycle

| Event | Behavior |
| --- | --- |
| A04 | Create at `created`; an existing encounter must still be `created` |
| A01 | Create at `checked-in`, or admit an encounter at `created` |
| A02 | Requires `visit.location`; transition from `checked-in` to `in-progress`, or update location while `in-progress` |
| A03 | Discharge from `checked-in`, `in-progress` or `completed`; set discharge time to the accepted A03 occurrence timestamp, replacing a provisional direct-write time or an earlier A03 time |
| A08 | Update allowed visit metadata without changing status, including after discharge |

Same-status events with newer timestamps are accepted without another status-history row. Every accepted message remains in the inbox, including transfers and metadata updates that do not change status. Voided encounters reject ADT changes. Direct status APIs use the same transition rules; voiding is idempotent. The UI can also advance `in-progress` to `completed`. Direct metadata updates check the same voided-state invariant under an encounter row lock, preventing concurrent voiding from bypassing the check. Repeating a void remains a no-op. A08 and exact retries never replace discharge time; only a newly accepted A03 does.

Distinct events must have a timestamp strictly later than the last accepted ADT event. Equal timestamps are rejected conservatively because this contract has no ordering sequence. Exact retries are checked before ordering. Unknown encounters return 404 for A02/A03/A08; stale, identity-conflicting and invalid-transition events return 409. A later A01 cannot reopen a discharged encounter.

Resolve with `/api/encounters/resolve?source_system=ehr-demo&facility_id=north&csn=visit-456`. Optional `mrn` and `assigning_authority` narrow results. Broad queries matching more than one encounter return 409 instead of selecting an arbitrary visit. Listing supports `facility_id`.

Direct creation accepts `externalVisitReference`, `sourceSystem`, and `patientAssigningAuthority`. The latter two are required when an external visit reference is supplied. All supplied identity fields use the same string, nonblank and length rules as normalized ADT fields (source/facility: 100 characters; visit/MRN/authority: 150). Explicit nulls, non-string values and blank values are rejected; unscoped direct creation remains supported when external identity fields are omitted. Repeated direct creation returns a conflict; use the ADT ingestion endpoint for stored-response retry semantics.

## Migration and verification

From `apps/backend`, run `npm ci`, then configure `DATABASE_URL` and run `npm run migrate`. Local PostgreSQL also needs `DB_SSL=false`. The migration runner tracks applied files and applies pending migrations in one transaction under a migration lock. It adopts the original untracked schema without deleting data. Migration 002 interprets legacy discharge timestamps as UTC when converting them to timezone-aware storage; verify the historical database timezone before upgrading. It preserves existing references and leaves unknown patient authorities null. Duplicate source/facility/visit combinations cause migration failure and rollback; investigate and reconcile explicitly before retrying. Do not infer that an old visit reference is a genuine CSN: older code sometimes stored a message ID there.

Migration 003 additionally converts clinic creation/update, encounter creation/update and status-history timestamps to `TIMESTAMPTZ`, interpreting every legacy naive value explicitly as UTC. It leaves already-aware discharge, last-event, inbox and migration-ledger instants untouched. The migration runner temporarily uses UTC within its transaction so fresh installs of older migrations also seed correct instants, even when the database session normally uses another timezone. Verify the legacy UTC assumption before applying these migrations.

Existing clinics are resolved without unconditional UPDATE statements. Concurrent first creation uses INSERT/ON CONFLICT DO NOTHING followed by a fresh SELECT on the same transaction client; visit serialization and inbox retry guarantees are unchanged.

This is an additive migration compatible with old readers, but old writers do not populate the new identity and event fields. Stop ingestion during the upgrade and deploy the new writer before resuming. Back up the database before migration. ECS migration execution remains Phase 2 work.

`npm test -- --runInBand` runs validation tests and skips PostgreSQL tests unless `TEST_DATABASE_URL` is set. To run the integration suite against a disposable PostgreSQL 16 database in PowerShell:

```powershell
$env:TEST_DATABASE_URL='postgresql://postgres:password@127.0.0.1:5432/encounter_test'
$env:TZ='UTC'
$env:TEST_DB_TIMEZONE='UTC'
npm run test:integration
$env:TZ='America/New_York'
$env:TEST_DB_TIMEZONE='America/New_York'
npm run test:integration
```

The suite creates and drops its own randomly named schema, requires CREATE SCHEMA permission, and tests upgrading seeded old data, retries (20 concurrent deliveries), scoped uniqueness, lifecycle behavior, rollback, and ambiguity. Use synthetic data only. `TEST_DB_SSL` defaults to false for a local test server.

Test cleanup closes pools in `finally`, even if schema removal fails. A database outage may still prevent schema deletion; the cleanup error is surfaced instead of claiming successful removal. Regression coverage includes a real failed cleanup query, existing-clinic lock contention, concurrent first clinic creation, direct-write/void races, and timestamp migration under both timezones.
