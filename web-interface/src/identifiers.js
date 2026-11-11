import { MAX_CLIENT_ID_LENGTH } from './config.js';

function normalizeUserId(value) {
  const raw = String(value || '').trim();
  return raw || null;
}

function normalizeSessionId(value) {
  const raw = String(value || '').trim();
  return raw || null;
}

function normalizeClientId(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  return raw.slice(0, MAX_CLIENT_ID_LENGTH);
}

function getBearerToken(req) {
  const authHeader = req.headers['authorization'] || '';
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
}

function pickClientId(...candidates) {
  for (const candidate of candidates) {
    const normalized = normalizeClientId(candidate);
    if (normalized) return normalized;
  }
  return null;
}

export { normalizeUserId, normalizeSessionId, normalizeClientId, getBearerToken, pickClientId };
