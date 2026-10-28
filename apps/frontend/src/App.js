import React from 'react';
import { BrowserRouter as Router, Route, Switch } from 'react-router-dom';
import './App.css';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import EncounterList from './pages/EncounterList';
import NewEncounter from './pages/NewEncounter';
import EncounterDetail from './pages/EncounterDetail';

const DEMO = process.env.REACT_APP_DEMO_MODE === 'true';

function App() {
  return (
    <Router>
      <div className="layout">
        <Sidebar />
        <main className="main">
          {DEMO && <div role="status" style={{background:"#fef3c7",color:"#78350f",padding:"12px 16px",fontWeight:600,marginBottom:16,borderRadius:8}}>LOCAL DEMO — Synthetic data only · Changes are temporary · Not connected to hospital systems, PostgreSQL or AWS</div>}
          <Switch>
            <Route exact path="/" component={Dashboard} />
            <Route exact path="/encounters" component={EncounterList} />
            <Route exact path="/encounters/new" component={NewEncounter} />
            <Route path="/encounters/:id" component={EncounterDetail} />
          </Switch>
        </main>
      </div>
    </Router>
  );
}

export default App;
