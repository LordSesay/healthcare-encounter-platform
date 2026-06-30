import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useHistory, Link } from 'react-router-dom';
import api from '../api';
import StatusBadge from '../components/StatusBadge';
import PriorityBadge from '../components/PriorityBadge';

const STATUS_FLOW = ['created', 'checked-in', 'in-progress', 'completed', 'discharged'];

function EncounterDetail() {
  const { id } = useParams();
  const history = useHistory();
  const [enc, setEnc] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    api.getEncounter(id).then(setEnc).catch(err => setError(err.message));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const advance = async () => {
    setBusy('advance');
    try { const updated = await api.advanceStatus(id); setEnc(updated); } catch (err) { setError(err.message); }
    setBusy('');
  };

  const remove = async () => {
    if (!window.confirm('Void this encounter? This cannot be undone.')) return;
    setBusy('delete');
    try { await api.deleteEncounter(id); history.push('/encounters'); } catch (err) { setError(err.message); }
    setBusy('');
  };

  if (error && !enc) return <div className="page"><div className="panel"><p className="error">{error}</p><Link to="/encounters" className="link">&lt;- Back</Link></div></div>;
  if (!enc) return <div className="page"><div className="panel"><p>Loading...</p></div></div>;

  const currentIdx = STATUS_FLOW.indexOf(enc.status);
  const canAdvance = currentIdx < STATUS_FLOW.length - 1;
  const nextStatus = canAdvance ? STATUS_FLOW[currentIdx + 1] : null;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <Link to="/encounters" className="link">&lt;- Encounters</Link>
          <h1>{enc.encounterId}</h1>
        </div>
        <div className="header-actions">
          {canAdvance && (
            <button className="btn btn-primary" onClick={advance} disabled={!!busy}>
              {busy === 'advance' ? 'Updating...' : `Advance -> ${nextStatus}`}
            </button>
          )}
          <button className="btn btn-danger" onClick={remove} disabled={!!busy}>
            {busy === 'delete' ? 'Voiding...' : 'Void Encounter'}
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="status-timeline">
        {STATUS_FLOW.map((s, i) => (
          <div key={s} className={`timeline-step ${i <= currentIdx ? 'done' : ''} ${s === enc.status ? 'current' : ''}`}>
            <div className="timeline-dot" />
            <span>{s}</span>
          </div>
        ))}
      </div>

      <div className="detail-grid">
        <div className="panel">
          <h2>Encounter Info</h2>
          <dl className="detail-list">
            <dt>Status</dt><dd><StatusBadge status={enc.status} /></dd>
            <dt>Priority</dt><dd><PriorityBadge priority={enc.priority} /></dd>
            <dt>Clinic</dt><dd>{enc.clinicId}</dd>
            <dt>Patient</dt><dd>{enc.patientReference}</dd>
            <dt>Visit Type</dt><dd>{enc.visitType.replace(/_/g, ' ')}</dd>
            <dt>Department</dt><dd>{enc.department}</dd>
            <dt>Provider</dt><dd>{enc.provider || '-'}</dd>
            <dt>Notes</dt><dd>{enc.notes || '-'}</dd>
            <dt>Created</dt><dd>{new Date(enc.createdAt).toLocaleString()}</dd>
            <dt>Updated</dt><dd>{new Date(enc.updatedAt).toLocaleString()}</dd>
          </dl>
        </div>

        <div className="panel">
          <h2>Status History</h2>
          {enc.statusHistory && enc.statusHistory.length > 0 ? (
            <ul className="history-list">
              {enc.statusHistory.map((h, i) => (
                <li key={i} className="history-item">
                  <StatusBadge status={h.status} />
                  <span className="history-time">{new Date(h.timestamp).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">No history available.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default EncounterDetail;
