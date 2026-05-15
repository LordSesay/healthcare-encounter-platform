import React from 'react';

const styles = {
  'created': { background: 'linear-gradient(135deg, #6b7280, #4b5563)' },
  'checked-in': { background: 'linear-gradient(135deg, #2563eb, #1d4ed8)' },
  'in-progress': { background: 'linear-gradient(135deg, #d97706, #b45309)' },
  'completed': { background: 'linear-gradient(135deg, #059669, #047857)' },
  'discharged': { background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' },
  'billed': { background: 'linear-gradient(135deg, #0d9488, #0f766e)' },
  'closed': { background: 'linear-gradient(135deg, #475569, #334155)' }
};

function StatusBadge({ status }) {
  const style = styles[status] || styles['created'];
  return (
    <span className="status-badge" style={style}>
      {status}
    </span>
  );
}

export default StatusBadge;
