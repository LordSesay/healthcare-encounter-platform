import React from 'react';

const styles = {
  low: { background: 'linear-gradient(135deg, #6b7280, #4b5563)' },
  normal: { background: 'linear-gradient(135deg, #2563eb, #1d4ed8)' },
  high: { background: 'linear-gradient(135deg, #d97706, #b45309)' },
  critical: { background: 'linear-gradient(135deg, #dc2626, #b91c1c)' }
};

function PriorityBadge({ priority }) {
  const style = styles[priority] || styles['normal'];
  return (
    <span className="priority-badge" style={style}>
      {priority}
    </span>
  );
}

export default PriorityBadge;
