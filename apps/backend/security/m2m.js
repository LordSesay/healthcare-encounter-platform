'use strict';

// HEP-SEC-001: fail-closed service-to-service authentication.
// No development bypass. Tests inject a fake verifier; production ALWAYS uses
// CognitoJwtVerifier, which verifies signature, issuer, expiry, client and token use.

function csvList(value) {
  return String(value || '').split(',').map(s => s.trim()).filter(Boolean);
}

function readConfig(env = process.env) {
  const userPoolId = String(env.AUTH_COGNITO_USER_POOL_ID || '').trim();
  const clientIds = csvList(env.AUTH_M2M_CLIENT_IDS);
  const readScope = String(env.AUTH_READ_SCOPE || '').trim();
  const writeScope = String(env.AUTH_WRITE_SCOPE || '').trim();
  if (!/^[\w-]+_[a-zA-Z0-9]+$/.test(userPoolId)) {
    throw new Error('AUTH_COGNITO_USER_POOL_ID is required (e.g. us-east-1_XXXXXXXX)');
  }
  if (!clientIds.length || new Set(clientIds).size !== clientIds.length) {
    throw new Error('AUTH_M2M_CLIENT_IDS must list unique, nonempty app-client IDs');
  }
  if (!readScope || !writeScope || readScope === writeScope || /\s/.test(readScope + writeScope)) {
    throw new Error('Set distinct OAuth AUTH_READ_SCOPE and AUTH_WRITE_SCOPE');
  }
  return Object.freeze({ userPoolId, clientIds, readScope, writeScope });
}

function requiredScope(req, config) {
  // ID generation is a write-oriented capability despite GET method.
  if (['GET', 'HEAD'].includes(req.method) && String(req.path).replace(/\/+$/, '').toLowerCase() === '/id') return config.writeScope;
  if (req.method === 'GET' || req.method === 'HEAD') return config.readScope;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return config.writeScope;
  return null;
}

function createM2MAuth({ config = readConfig(), verifyToken } = {}) {
  const allowedClients = new Set(config.clientIds);
  let verifier;
  if (!verifyToken) {
    const { CognitoJwtVerifier } = require('aws-jwt-verify');
    verifier = CognitoJwtVerifier.create({
      userPoolId: config.userPoolId,
      tokenUse: 'access',
      clientId: config.clientIds
    });
  }
  const verify = verifyToken || (token => verifier.verify(token));

  return async function m2mAuth(req, res, next) {
    const required = requiredScope(req, config);
    if (!required) return res.status(405).json({ error: 'Method not allowed' });

    const authorization = req.get('authorization') || '';
    const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(authorization);
    if (!match) {
      res.set('WWW-Authenticate', 'Bearer');
      return res.status(401).json({ error: 'Service access token required' });
    }

    let payload;
    try {
      payload = await verify(match[1]);
    } catch {
      res.set('WWW-Authenticate', 'Bearer error="invalid_token"');
      return res.status(401).json({ error: 'Invalid service access token' });
    }

    // Only verified token claims are read here. Client IDs must be dedicated
    // to the Cognito client_credentials grant (enforced in Cognito configuration).
    if (!payload || payload.token_use !== 'access' ||
        typeof payload.client_id !== 'string' || !allowedClients.has(payload.client_id) ||
        payload.username || payload['cognito:username'] || payload['cognito:groups']) {
      res.set('WWW-Authenticate', 'Bearer error="invalid_token"');
      return res.status(401).json({ error: 'Unrecognized service identity' });
    }
    const scopes = new Set(typeof payload.scope === 'string' ? payload.scope.split(/\s+/).filter(Boolean) : []);
    if (!scopes.has(required)) {
      res.set('WWW-Authenticate', `Bearer error="insufficient_scope", scope="${required}"`);
      return res.status(403).json({ error: 'Insufficient service scope' });
    }
    req.auth = Object.freeze({ type: 'service', clientId: payload.client_id });
    return next();
  };
}

module.exports = { readConfig, requiredScope, createM2MAuth };
