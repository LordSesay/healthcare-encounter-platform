import demoApi from './demoApi';

import API_URL from './config';

async function request(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

const api = {
  getStats: () => request(`${API_URL}/encounters/stats`),
  getOptions: () => request(`${API_URL}/encounters/options`),
  getEncounters: (params = '') => request(`${API_URL}/encounters${params ? `?${params}` : ''}`),
  getEncounter: (id) => request(`${API_URL}/encounters/${id}`),
  createEncounter: (data) => request(`${API_URL}/encounters`, { method: 'POST', body: JSON.stringify(data) }),
  advanceStatus: (id) => request(`${API_URL}/encounters/${id}/status`, { method: 'PATCH' }),
  updateEncounter: (id, data) => request(`${API_URL}/encounters/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteEncounter: (id) => request(`${API_URL}/encounters/${id}`, { method: 'DELETE' }),
  getHealth: () => request('/health')
};

// Demo mode never calls fetch; the production API always requires service identity.
export default process.env.REACT_APP_DEMO_MODE === 'true' ? demoApi : api;
