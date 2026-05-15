import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import StatusBadge from '../components/StatusBadge';

function Dashboard() {
  const [stats, setStats] = useState(null);
  const [deptData, setDeptData] = useState(null);
  const [recent, setRecent] = useState([]);
  const [health, setHealth] = useState(null);

  useEffect(() => {
    api.getStats().then(d => { setStats(d.stats || d); setDeptData(d.byDepartment || {}); }).catch(() => {});
    api.getEncounters('limit=5').then(d => setRecent(d.encounters || [])).catch(() => {});
    api.getHealth().then(setHealth).catch(() => setHealth({ status: 'unreachable' }));
  }, []);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p style={{ color: '#64748b', fontSize: '14px', marginTop: '4px' }}>
            Real-time encounter lifecycle overview
          </p>
        </div>
        <Link to="/encounters/new" className="btn btn-primary">+ New Encounter</Link>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-label">Total Encounters</span>
          <span className="stat-value">{stats ? stats.total : '—'}</span>
        </div>
        <div className="stat-card accent-blue">
          <span className="stat-label">Checked In</span>
          <span className="stat-value">{stats ? (stats['checked-in'] || 0) : '—'}</span>
        </div>
        <div className="stat-card accent-amber">
          <span className="stat-label">In Progress</span>
          <span className="stat-value">{stats ? (stats['in-progress'] || 0) : '—'}</span>
        </div>
        <div className="stat-card accent-green">
          <span className="stat-label">Completed</span>
          <span className="stat-value">{stats ? (stats['completed'] || 0) : '—'}</span>
        </div>
        <div className="stat-card accent-purple">
          <span className="stat-label">Discharged</span>
          <span className="stat-value">{stats ? (stats['discharged'] || 0) : '—'}</span>
        </div>
        <div className="stat-card accent-teal">
          <span className="stat-label">Billed</span>
          <span className="stat-value">{stats ? (stats['billed'] || 0) : '—'}</span>
        </div>
        <div className="stat-card accent-slate">
          <span className="stat-label">Closed</span>
          <span className="stat-value">{stats ? (stats['closed'] || 0) : '—'}</span>
        </div>
        <div className={`stat-card ${health && health.status === 'healthy' ? 'accent-green' : 'accent-red'}`}>
          <span className="stat-label">API Health</span>
          <span className="stat-value" style={{ fontSize: '18px' }}>{health ? (health.status === 'healthy' ? '● Online' : '○ Offline') : '—'}</span>
        </div>
      </div>

      {stats && stats.total > 0 && deptData && Object.keys(deptData).length > 0 && (
        <div className="panel">
          <div className="panel-header">
            <h2>Department Breakdown</h2>
          </div>
          <div className="dept-bars">
            {Object.entries(deptData).map(([dept, count]) => (
              <div key={dept} className="dept-row">
                <span className="dept-name">{dept}</span>
                <div className="dept-bar-track">
                  <div className="dept-bar-fill" style={{ width: `${Math.min((count / stats.total) * 100, 100)}%` }} />
                </div>
                <span className="dept-count">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-header">
          <h2>Recent Activity</h2>
          <Link to="/encounters" className="link">View all →</Link>
        </div>
        {recent.length === 0 ? (
          <p className="empty">No encounters yet. <Link to="/encounters/new">Create your first encounter</Link> to get started.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Encounter ID</th>
                  <th>Patient</th>
                  <th>Department</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {recent.map(e => (
                  <tr key={e.encounterId}>
                    <td><Link to={`/encounters/${e.encounterId}`} className="link">{e.encounterId}</Link></td>
                    <td>{e.patientReference}</td>
                    <td style={{ textTransform: 'capitalize' }}>{e.department}</td>
                    <td><StatusBadge status={e.status} /></td>
                    <td style={{ color: '#64748b' }}>{new Date(e.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default Dashboard;
