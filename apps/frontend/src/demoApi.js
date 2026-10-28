// Local-only in-memory fixture adapter. No requests, credentials, or real patient data.
// All changes reset on a browser reload. Never point this at a clinical endpoint.
const seeded = [
  {encounterId:'ENC-DEMO-0001',clinicId:'CLINIC-DEMO-NORTH',patientReference:'PAT-DEMO-001',externalVisitReference:'VISIT-DEMO-001',visitType:'urgent_care',department:'emergency',priority:'urgent',provider:'Demo Clinician A',notes:'Synthetic encounter',status:'checked-in',createdAt:'2026-10-19T10:00:00.000Z'},
  {encounterId:'ENC-DEMO-0002',clinicId:'CLINIC-DEMO-NORTH',patientReference:'PAT-DEMO-002',externalVisitReference:'VISIT-DEMO-002',visitType:'follow_up',department:'general',priority:'normal',provider:'Demo Clinician B',notes:'Fixture only',status:'created',createdAt:'2026-10-19T11:00:00.000Z'},
  {encounterId:'ENC-DEMO-0003',clinicId:'CLINIC-DEMO-EAST',patientReference:'PAT-DEMO-003',externalVisitReference:'VISIT-DEMO-003',visitType:'lab_work',department:'laboratory',priority:'low',provider:'Demo Clinician C',notes:'No external system',status:'completed',createdAt:'2026-10-19T12:00:00.000Z'}
];
const flow = ['created','checked-in','in-progress','completed','discharged'];
const options = {
  visitTypes: ['routine_checkup','follow_up','urgent_care','emergency','specialist_referral','lab_work'],
  departments: ['general','outpatient','inpatient','emergency','radiology','laboratory','cardiology','pediatrics'],
  priorities: ['low','normal','urgent','critical'],
  statuses: flow
};
const clone = item => JSON.parse(JSON.stringify(item));
let counter = 3;
let encounters = seeded.map(e => ({...e,updatedAt:e.createdAt,statusHistory:[{status:e.status,timestamp:e.createdAt}]}));
const findEncounter = id => encounters.find(e => e.encounterId === id);
const result = fn => Promise.resolve().then(fn);
const api = {
  getOptions: () => result(() => clone(options)),
  getHealth: () => result(() => ({status:'demo',database:'not connected'})),
  getStats: () => result(() => {
    const stats = {total:encounters.length};const byDepartment={};const byPriority={};
    encounters.forEach(e=>{stats[e.status]=(stats[e.status]||0)+1;byDepartment[e.department]=(byDepartment[e.department]||0)+1;byPriority[e.priority]=(byPriority[e.priority]||0)+1});
    return {stats,byStatus:stats,byDepartment,byPriority};
  }),
  getEncounters: (params='') => result(() => {
    const query = new URLSearchParams(params);
    const search=(query.get('search')||'').toLowerCase();
    const all=encounters.filter(e=>(!query.get('status')||e.status===query.get('status'))&&(!query.get('department')||e.department===query.get('department'))&&(!search||[e.encounterId,e.patientReference,e.clinicId].some(v=>v.toLowerCase().includes(search))));
    const limit=Math.max(1,Math.min(parseInt(query.get('limit'),10)||50,100));
    return {count:all.length,encounters:clone(all.slice(0,limit))};
  }),
  getEncounter: id => result(() => {
    const e=findEncounter(id);if(!e)throw Error('Synthetic encounter not found');return clone(e);
  }),
  createEncounter: data => result(() => {
    if(!data.clinicId||!data.patientReference||!data.visitType)throw Error('Required fields missing');
    const now=new Date().toISOString();const e={...data,encounterId:`ENC-DEMO-${String(++counter).padStart(4,'0')}`,status:'created',priority:data.priority||'normal',department:data.department||'general',createdAt:now,updatedAt:now,statusHistory:[{status:'created',timestamp:now}]};
    encounters.unshift(e);return clone(e);
  }),
  advanceStatus: id => result(() => {
    const e=findEncounter(id);if(!e)throw Error('Synthetic encounter not found');
    const index=flow.indexOf(e.status);if(index<0||index>=flow.length-1)throw Error('Final status');
    e.status=flow[index+1];e.updatedAt=new Date().toISOString();e.statusHistory.push({status:e.status,timestamp:e.updatedAt});return clone(e);
  }),
  updateEncounter: (id,data) => result(() => {
    const e=findEncounter(id);if(!e)throw Error('Synthetic encounter not found');
    for(const k of ['notes','provider','priority'])if(Object.prototype.hasOwnProperty.call(data,k))e[k]=data[k];
    e.updatedAt=new Date().toISOString();return clone(e);
  }),
  deleteEncounter: id => result(() => {
    const e=findEncounter(id);if(!e)throw Error('Synthetic encounter not found');
    e.status='voided';e.updatedAt=new Date().toISOString();return {message:'Synthetic encounter voided',encounterId:id};
  })
};
export default api;
