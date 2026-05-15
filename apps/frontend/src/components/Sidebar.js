import React from 'react';
import { NavLink } from 'react-router-dom';

function Sidebar() {
  return (
    <nav className="sidebar">
      <div className="sidebar-brand">
        <span className="brand-icon">⚕</span>
        <span className="brand-text">EncounterID</span>
      </div>
      <ul className="sidebar-nav">
        <li><NavLink exact to="/" activeClassName="active">📊 Dashboard</NavLink></li>
        <li><NavLink to="/encounters" activeClassName="active">📋 Encounters</NavLink></li>
        <li><NavLink to="/encounters/new" activeClassName="active">➕ New Encounter</NavLink></li>
      </ul>
      <div className="sidebar-footer">
        <span className="env-badge">● ECS Fargate — Production</span>
      </div>
    </nav>
  );
}

export default Sidebar;
