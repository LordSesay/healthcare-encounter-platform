-- Legacy identifiers are preserved. Duplicate scoped visits must be reconciled
-- explicitly before this unique index can be installed.
ALTER TABLE encounters ADD COLUMN patient_assigning_authority VARCHAR(150);
ALTER TABLE encounters ADD COLUMN location VARCHAR(150);
ALTER TABLE encounters ADD COLUMN last_event_at TIMESTAMPTZ;
-- Legacy deployment timestamps were UTC; verify that assumption before upgrade.
ALTER TABLE encounters ALTER COLUMN discharged_at TYPE TIMESTAMPTZ
 USING discharged_at AT TIME ZONE 'UTC';
CREATE UNIQUE INDEX encounters_source_visit_unique
 ON encounters(source_system, clinic_id, external_visit_reference);

CREATE TABLE adt_events (
 inbox_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 source_system VARCHAR(100) NOT NULL,
 facility_id VARCHAR(100) NOT NULL,
 message_id VARCHAR(150) NOT NULL,
 visit_id VARCHAR(150) NOT NULL,
 event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('ADT_A01','ADT_A02','ADT_A03','ADT_A04','ADT_A08')),
 occurred_at TIMESTAMPTZ NOT NULL,
 received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 payload_hash TEXT NOT NULL,
 encounter_id VARCHAR(50) REFERENCES encounters(encounter_id),
 outcome VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending','processed','rejected')),
 response JSONB,
 UNIQUE(source_system, facility_id, message_id)
);
ALTER TABLE encounter_status_history ADD COLUMN inbox_id UUID REFERENCES adt_events(inbox_id);
CREATE UNIQUE INDEX history_inbox_unique ON encounter_status_history(inbox_id);
