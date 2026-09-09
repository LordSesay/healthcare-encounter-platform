// Uses a unique schema; never truncates or drops existing application tables.
const { randomUUID } = require('crypto');
const schema = 'adt_test_' + randomUUID().replace(/-/g, '');
const enabled = Boolean(process.env.TEST_DATABASE_URL);
if (enabled) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DB_SSL = process.env.TEST_DB_SSL || 'false';
  process.env.PGOPTIONS = `-c search_path=${schema} -c timezone=${process.env.TEST_DB_TIMEZONE || 'UTC'} -c lock_timeout=1500`;
}
const { pool } = require('./db');
const { migrate } = require('./migrate');
const { cleanupDatabase } = require('../test-support/database');
const service = require('../services/encounters.service');
const repo = require('./encounters.repository');
const fs = require('fs');
const path = require('path');
const suite = enabled ? describe : describe.skip;
const event = (type='ADT_A01', seconds=0, overrides={}) => ({
  event_type:type, event_id:randomUUID(), source_system:'ehr',
  occurred_at:new Date(Date.UTC(2026,0,1,10,0,seconds)).toISOString(),
  patient:{mrn:'mrn-1',assigning_authority:'authority-1'},
  visit:{visit_id:randomUUID(),facility_id:'north'}, ...overrides
});
const send = e => service.createFromAdt(e);
const next = (e,type,seconds,fields={}) => ({...e,event_type:type,event_id:randomUUID(),occurred_at:new Date(Date.UTC(2026,0,1,10,0,seconds)).toISOString(),visit:{...e.visit,...fields}});
suite('PostgreSQL encounter integration', () => {
  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(fs.readFileSync(path.join(__dirname,'migrations/001_initial_schema.sql'),'utf8'));
    await pool.query("INSERT INTO encounters(encounter_id,clinic_id,patient_reference,visit_type,department,status,external_visit_reference) SELECT 'legacy',clinic_id,'old-mrn','urgent_care','general','created','legacy-csn' FROM clinics WHERE external_clinic_ref='clinic-default'");
    await pool.query("UPDATE clinics SET created_at='2026-01-02 03:04:05.123',updated_at='2026-01-02 04:05:06.234'");
    await pool.query("UPDATE encounters SET created_at='2026-01-02 03:04:05.123',updated_at='2026-01-02 04:05:06.234',discharged_at='2026-01-02 05:06:07.345'");
    await pool.query("INSERT INTO encounter_status_history(encounter_id,new_status,changed_at) VALUES('legacy','created','2026-01-02 03:04:05.123')");
    // Upgrade an already-applied Phase 1 schema; 001 and 002 remain unchanged.
    await pool.query(fs.readFileSync(path.join(__dirname,'migrations/002_adt_identity.sql'),'utf8'));
    await pool.query("CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
    await pool.query("INSERT INTO schema_migrations(name) VALUES('001_initial_schema.sql'),('002_adt_identity.sql')");
    await pool.query("UPDATE encounters SET last_event_at='2026-01-02T06:07:08.456+02:00' WHERE encounter_id='legacy'");
    await migrate();
    await migrate();
  });
  afterAll(async () => {
    await cleanupDatabase(pool, schema);
  });
  test('migration preserves old identifiers and is repeatable', async () => {
    expect((await repo.getEncounterById('legacy')).externalVisitReference).toBe('legacy-csn');
    expect((await pool.query('SELECT * FROM schema_migrations')).rowCount).toBe(3);
  });
  test('concurrent identical messages create one encounter, inbox entry and history row', async () => {
    const e = event(); const results = await Promise.all(Array.from({length:20},()=>send(e)));
    const id = results[0].data.encounter_id;
    expect(new Set(results.map(r=>r.data.encounter_id)).size).toBe(1);
    expect(results.filter(r=>!r.duplicate)).toHaveLength(1);
    expect(await repo.getStatusHistory(id)).toHaveLength(1);
    expect((await pool.query('SELECT * FROM adt_events WHERE message_id=$1',[e.event_id])).rowCount).toBe(1);
  });
  test('distinct simultaneous admissions for one visit cannot create two encounters', async () => {
    const e = event();
    const results = await Promise.allSettled([send(e),send({...e,event_id:randomUUID()})]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect((await pool.query('SELECT * FROM encounters WHERE external_visit_reference=$1',[e.visit.visit_id])).rowCount).toBe(1);
  });
  test('register, admit, transfer, metadata, discharge; duplicates do not repeat history', async () => {
    const e = event('ADT_A04'); const {data:{encounter_id:id}} = await send(e);
    await send(next(e,'ADT_A01',1));
    const transfer = next(e,'ADT_A02',2,{location:'ward-3',department:'inpatient'});
    await send(transfer); expect((await send(transfer)).duplicate).toBe(true);
    await send(next(e,'ADT_A02',3,{location:'ward-4'}));
    await send(next(e,'ADT_A08',4,{attending_provider:'dr-2',priority:'urgent',notes:'synthetic'}));
    const discharge = next(e,'ADT_A03',5); await send(discharge); await send(discharge);
    const row = await repo.getEncounterById(id);
    expect(row).toMatchObject({status:'discharged',location:'ward-4',provider:'dr-2',priority:'urgent',notes:'synthetic'});
    expect(new Date(row.dischargedAt).toISOString()).toBe(discharge.occurred_at);
    expect(await repo.getStatusHistory(id)).toHaveLength(4);
    expect((await send(e)).data.status).toBe('created'); // Original response, not mutable current state.
  });
  test('scoped visit IDs do not collide and broad resolution rejects ambiguity', async () => {
    const e = event(); await send(e);
    const other = {...e,visit:{...e.visit,facility_id:'south'}};
    const b = await send(other);
    await send({...e,source_system:'other-ehr'});
    await expect(service.resolveEncounter({csn:e.visit.visit_id})).rejects.toMatchObject({status:409});
    expect((await service.resolveEncounter({csn:e.visit.visit_id,facility_id:'south',source_system:'ehr'})).encounterId).toBe(b.data.encounter_id);
    const listed = await service.listAdtEncounters({facility_id:'south'});
    expect(listed.every(r=>r.clinicId==='south')).toBe(true);
  });
  test('changed message content and mismatched patient identity cannot mutate a visit', async () => {
    const e = event(); await send(e);
    await expect(send({...e,visit:{...e.visit,priority:'critical'}})).rejects.toMatchObject({status:409});
    await expect(send({...next(e,'ADT_A08',1),patient:{...e.patient,assigning_authority:'other'}})).rejects.toMatchObject({status:409});
  });
  test('missing encounters and stale events are durably rejected without partial mutation', async () => {
    const e = event(); const missing = next(e,'ADT_A03',3);
    await expect(send(missing)).rejects.toMatchObject({status:404});
    const {data:{encounter_id:id}} = await send(e);
    await send(next(e,'ADT_A02',5,{location:'ward'}));
    const stale = next(e,'ADT_A03',4);
    await expect(send(stale)).rejects.toMatchObject({status:409});
    await expect(send(stale)).rejects.toMatchObject({status:409});
    expect((await pool.query('SELECT outcome FROM adt_events WHERE message_id=$1',[stale.event_id])).rows[0].outcome).toBe('rejected');
    expect((await repo.getEncounterById(id)).status).toBe('in-progress');
    expect(await repo.getStatusHistory(id)).toHaveLength(2);
  });
  test('direct status routes enforce transitions and voiding is idempotent', async () => {
    const {data:{encounter_id:id}} = await send(event());
    await expect(service.updateAdtStatus(id,'created')).rejects.toMatchObject({status:409});
    await service.deleteEncounter(id); await service.deleteEncounter(id);
    expect(await repo.getStatusHistory(id)).toHaveLength(2);
  });
  test('direct creation preserves external identity and rolls back failed creation', async () => {
    const input = {clinicId:'direct',patientReference:'patient',visitType:'urgent_care',externalVisitReference:randomUUID(),sourceSystem:'direct',patientAssigningAuthority:'direct'};
    const row = await service.createEncounter(input);
    expect(row.externalVisitReference).toBe(input.externalVisitReference);
    await expect(service.createEncounter(input)).rejects.toMatchObject({code:'23505'});
    expect(await repo.getStatusHistory(row.encounterId)).toHaveLength(1);
  });
  test('unexpected database failure rolls back inbox, encounter and history, allowing retry', async () => {
    const e = event();
    await pool.query("ALTER TABLE adt_events ADD CONSTRAINT test_failure CHECK (outcome <> 'processed') NOT VALID");
    try {
      await expect(send(e)).rejects.toMatchObject({code:'23514'});
      expect((await pool.query('SELECT * FROM adt_events WHERE message_id=$1',[e.event_id])).rowCount).toBe(0);
      expect((await pool.query('SELECT * FROM encounters WHERE external_visit_reference=$1',[e.visit.visit_id])).rowCount).toBe(0);
    } finally { await pool.query('ALTER TABLE adt_events DROP CONSTRAINT test_failure'); }
    expect((await send(e)).duplicate).toBe(false);
  });
  test('HTTP create, resolve, duplicate and rejection responses', async () => {
    const express = require('express');
    const app = express(); app.use(express.json());
    app.use('/api/encounters', require('../routes/adt'));
    app.use('/api/encounters', require('../routes/encounters'));
    const server = await new Promise(resolve => {
      const instance = app.listen(0,'127.0.0.1',()=>resolve(instance));
    });
    const base = `http://127.0.0.1:${server.address().port}/api/encounters`;
    const post = e => fetch(`${base}/from-adt`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(e)});
    try {
      const e = event();
      const created = await post(e); expect(created.status).toBe(201);
      const body = await created.json();
      const retry = await post(e); expect(retry.status).toBe(200);
      expect(await retry.json()).toEqual(body);
      const query = new URLSearchParams({source_system:e.source_system,facility_id:e.visit.facility_id,csn:e.visit.visit_id});
      const resolved = await fetch(`${base}/resolve?${query}`);
      expect(resolved.status).toBe(200);
      expect((await resolved.json()).encounter_id).toBe(body.encounter_id);
      expect((await post({...e,occurred_at:'invalid'})).status).toBe(400);
      expect((await post({...e,visit:{...e.visit,priority:'critical'}})).status).toBe(409);
      expect((await post({...e,event_id:randomUUID(),occurred_at:'2026-02-30T10:00:00Z'})).status).toBe(400);
      const direct = {clinicId:'direct-http',patientReference:'patient',visitType:'urgent_care',externalVisitReference:randomUUID(),sourceSystem:'http',patientAssigningAuthority:'http'};
      for (const key of ['clinicId','patientReference','externalVisitReference','sourceSystem','patientAssigningAuthority']) {
        for (const invalid of ['   ',null,123,{},'x'.repeat(151)]) {
          const invalidResponse=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...direct,[key]:invalid})});
          expect(invalidResponse.status).toBe(400);
        }
      }
      await fetch(`${base}/${body.encounter_id}`,{method:'DELETE'});
      for (const suffix of ['', '/status']) {
        const mutated=await fetch(`${base}/${body.encounter_id}${suffix}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({notes:'forbidden'})});
        expect([400,409]).toContain(mutated.status);
      }
      expect((await fetch(`${base}/adt/${body.encounter_id}/status`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'checked-in'})})).status).toBe(409);
      expect((await repo.getEncounterById(body.encounter_id)).notes).toBeNull();
      expect((await fetch(`${base}/${body.encounter_id}`,{method:'DELETE'})).status).toBe(200);

    } finally { await new Promise(resolve=>server.close(resolve)); }
  });

  test('all persisted instants are timezone-aware and legacy UTC values are preserved', async () => {
    expect((await pool.query('SHOW TimeZone')).rows[0].TimeZone).toBe(process.env.TEST_DB_TIMEZONE || 'UTC');
    if (process.env.TZ === 'UTC') expect(new Date('2026-01-01T00:00:00Z').getTimezoneOffset()).toBe(0);
    if (process.env.TZ === 'America/New_York') expect(new Date('2026-01-01T00:00:00Z').getTimezoneOffset()).toBe(300);
    const columns = await pool.query("SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema=$1 AND data_type LIKE 'timestamp%'", [schema]);
    expect(columns.rows).toHaveLength(10);
    expect(columns.rows.every(c=>c.data_type==='timestamp with time zone')).toBe(true);
    const row = await service.getEncounterById('legacy');
    expect(row.createdAt.toISOString()).toBe('2026-01-02T03:04:05.123Z');
    expect(row.updatedAt.toISOString()).toBe('2026-01-02T04:05:06.234Z');
    expect(row.dischargedAt.toISOString()).toBe('2026-01-02T05:06:07.345Z');
    expect(row.lastEventAt.toISOString()).toBe('2026-01-02T04:07:08.456Z');
    expect(row.statusHistory[0].timestamp.toISOString()).toBe('2026-01-02T03:04:05.123Z');
    const clinic = (await pool.query("SELECT * FROM clinics WHERE external_clinic_ref='clinic-default'")).rows[0];
    expect(clinic.created_at.toISOString()).toBe('2026-01-02T03:04:05.123Z');
    expect(clinic.updated_at.toISOString()).toBe('2026-01-02T04:05:06.234Z');
    const e = event(); const accepted = await send(e);
    const current = await service.getEncounterById(accepted.data.encounter_id);
    const inbox = (await pool.query('SELECT * FROM adt_events WHERE message_id=$1',[e.event_id])).rows[0];
    expect(current.createdAt.getTime()).toBe(inbox.received_at.getTime());
    expect(current.statusHistory[0].timestamp.getTime()).toBe(inbox.received_at.getTime());
    expect(inbox.occurred_at.toISOString()).toBe(e.occurred_at);
  });
  test('fresh database migrations succeed and cleanup closes even after a real SQL error', async () => {
    const { Pool } = require('pg');
    const freshSchema = 'migration_test_' + randomUUID().replace(/-/g,'');
    const db = new Pool({connectionString:process.env.TEST_DATABASE_URL,ssl:process.env.TEST_DB_SSL === 'true' ? {rejectUnauthorized:false} : false,options:`-c search_path=${freshSchema} -c timezone=${process.env.TEST_DB_TIMEZONE || 'UTC'}`});
    try {
      await db.query(`CREATE SCHEMA ${freshSchema}`);
      const before = Date.now();
      await migrate(db); await migrate(db);
      const seeded = (await db.query("SELECT created_at FROM clinics WHERE external_clinic_ref='clinic-default'")).rows[0].created_at.getTime();
      expect(seeded).toBeGreaterThanOrEqual(before - 1000);
      expect(seeded).toBeLessThanOrEqual(Date.now() + 1000);
      expect((await db.query('SELECT * FROM schema_migrations')).rowCount).toBe(3);
    } finally { await cleanupDatabase(db,freshSchema); }
    expect(db.ended).toBe(true);
    const failed = new Pool({connectionString:process.env.TEST_DATABASE_URL,ssl:false});
    const c = await failed.connect();
    await c.query('BEGIN');
    await expect(c.query('SELECT nonexistent_cleanup_test_column')).rejects.toMatchObject({code:'42703'});
    c.release();
    await expect(cleanupDatabase(failed,freshSchema)).rejects.toMatchObject({code:'25P02'});
    expect(failed.ended).toBe(true);
  });
  test('A03 overrides direct discharge time, later A03 corrects it, retries and A08 preserve it', async () => {
    const e = event(); const {data:{encounter_id:id}} = await send(e);
    await service.updateAdtStatus(id,'discharged');
    const discharge = next(e,'ADT_A03',2);
    await send(discharge);
    expect((await repo.getEncounterById(id)).dischargedAt.toISOString()).toBe(discharge.occurred_at);
    const corrected = next(e,'ADT_A03',3); await send(corrected);
    await send(discharge); // Exact older retry must not undo correction.
    await send(next(e,'ADT_A08',4,{notes:'after discharge'}));
    expect((await repo.getEncounterById(id)).dischargedAt.toISOString()).toBe(corrected.occurred_at);
    expect(await repo.getStatusHistory(id)).toHaveLength(2);
  });
  test('invalid timestamps fail before inbox insertion and equivalent representations retry', async () => {
    const e = event();
    for (const value of ['2026-02-30T10:00:00Z','January 1, 2026 10:00:00Z','2026-01-01T24:00:00Z']) {
      await expect(send({...e,occurred_at:value})).rejects.toMatchObject({status:400});
    }
    expect((await pool.query('SELECT * FROM adt_events WHERE message_id=$1',[e.event_id])).rowCount).toBe(0);
    await send(e);
    expect((await send({...e,occurred_at:'2026-01-01t05:00:00-05:00'})).duplicate).toBe(true);
  });
  test('unrelated visits can process while their existing clinic has a non-key update lock', async () => {
    const facility = 'unblocked-' + randomUUID();
    const clinicId = await repo.getOrCreateClinic(facility);
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT * FROM clinics WHERE clinic_id=$1 FOR NO KEY UPDATE',[clinicId]);
      const e = event(); e.visit.facility_id=facility;
      await send(e);
      await service.createEncounter({clinicId:facility,patientReference:'direct',visitType:'urgent_care'});
    } finally { try {await holder.query('ROLLBACK');} finally {holder.release();} }
  });
  test('concurrent first use of a facility resolves one clinic without updates', async () => {
    const facility='new-' + randomUUID();
    const results=await Promise.all(Array.from({length:10},()=>repo.getOrCreateClinic(facility)));
    expect(new Set(results).size).toBe(1);
    const before=(await pool.query('SELECT xmin::text,updated_at FROM clinics WHERE clinic_id=$1',[results[0]])).rows[0];
    await repo.getOrCreateClinic(facility);
    const after=(await pool.query('SELECT xmin::text,updated_at FROM clinics WHERE clinic_id=$1',[results[0]])).rows[0];
    expect(after).toEqual(before);
  });
  test('a direct metadata update waiting on a concurrent void sees the voided state', async () => {
    const {data:{encounter_id:id}} = await send(event());
    const holder=await pool.connect();
    let update;
    try {
      await holder.query('BEGIN');
      await holder.query("UPDATE encounters SET status='voided' WHERE encounter_id=$1",[id]);
      update=service.updateEncounter(id,{notes:'must not persist'}).then(value=>({value}),error=>({error}));
      const holderPid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      let blocked = false;
      for (let attempt = 0; attempt < 50 && !blocked; attempt++) {
        blocked = (await pool.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked',[holderPid])).rows[0].blocked;
        if (!blocked) await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(blocked).toBe(true);
      await holder.query('COMMIT');
      expect((await update).error).toMatchObject({status:409});
      expect((await repo.getEncounterById(id)).notes).toBeNull();
    } finally { try {await holder.query('ROLLBACK');} finally {holder.release();} }
  });

});
