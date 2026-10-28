import api from './demoApi';

test('synthetic demo never reaches network and only modifies temporary fixture data', async () => {
  const previousFetch=global.fetch;
  global.fetch=jest.fn(()=>Promise.reject(new Error('No real network allowed')));
  try {
    expect((await api.getHealth()).status).toBe('demo');
    expect((await api.getStats()).stats.total).toBeGreaterThan(0);
    expect((await api.getEncounters('status=created')).encounters.every(x=>x.status==='created')).toBe(true);
    const e=await api.createEncounter({clinicId:'DEMO',patientReference:'PAT-DEMO-99',visitType:'follow_up'});
    expect((await api.getEncounter(e.encounterId)).status).toBe('created');
    await api.advanceStatus(e.encounterId);
    expect((await api.getEncounter(e.encounterId)).status).toBe('checked-in');
    await api.deleteEncounter(e.encounterId);
    expect((await api.getEncounter(e.encounterId)).status).toBe('voided');
    expect(global.fetch).not.toHaveBeenCalled();
  } finally {global.fetch=previousFetch;}
});
