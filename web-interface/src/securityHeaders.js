import { normalizeHost } from './domains.js';
import { ADMIN_ALLOWED_HOST } from './config.js';

function isAdminPath(pathname) {
  const path = String(pathname || '');
  return path === '/admin' || path.startsWith('/admin/') || path.startsWith('/api/admin/');
}

function isLocalAdminHost(hostname) {
  const host = normalizeHost(hostname);
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function isLoopbackAddress(address) {
  const value = String(address || '')
    .trim()
    .toLowerCase();
  return (
    value === '127.0.0.1' ||
    value === '::1' ||
    value === '::ffff:127.0.0.1' ||
    value === 'localhost'
  );
}

function isAllowedAdminRequest(req) {
  if (normalizeHost(req.hostname) === ADMIN_ALLOWED_HOST) {
    return true;
  }

  return isLocalAdminHost(req.hostname) && isLoopbackAddress(req.ip || req.socket?.remoteAddress);
}

const DEFAULT_FRAME_ANCESTORS_PROD = [
  "'self'",
  'https://kassir.ru',
  'https://www.kassir.ru',
  'https://*.kassir.ru',
  'https://msk.stg.kassirdev.ru',
  ...Array.from({ length: 10 }, (_, index) => `https://msk.dev${index}.kassirdev.ru`),
];

const DEFAULT_FRAME_ANCESTORS_DEV = [
  ...DEFAULT_FRAME_ANCESTORS_PROD,
  // sferaai.ru (стенд/тест)
  'https://sferaai.ru',
  'https://www.sferaai.ru',
  'https://*.sferaai.ru',
  'http://sferaai.ru',
  'http://www.sferaai.ru',
  'http://*.sferaai.ru',
  // ВАЖНО: CSP `frame-ancestors` не везде поддерживает wildcard-порты, поэтому указываем явный порт стенда.
  'http://sferaai.ru:8080',
  'http://www.sferaai.ru:8080',
  'http://*.sferaai.ru:8080',
  'http://158.160.65.201:8080',
  'http://localhost',
  'http://localhost:*',
  'http://127.0.0.1',
  'http://127.0.0.1:*',
  'http://[::1]',
  'http://[::1]:*',
];

function buildFrameAncestorsValue(options = {}) {
  const { forceDev = false } = options;
  const raw = (process.env.WIDGET_FRAME_ANCESTORS || '').trim();
  if (!raw) {
    const isProd = process.env.NODE_ENV === 'production' && !forceDev;
    return (isProd ? DEFAULT_FRAME_ANCESTORS_PROD : DEFAULT_FRAME_ANCESTORS_DEV).join(' ');
  }

  // Allow comma/space separated values (for ops convenience).
  const parts = raw
    .split(/[\s,]+/g)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length > 0) {
    return parts.join(' ');
  }

  const isProd = process.env.NODE_ENV === 'production' && !forceDev;
  return (isProd ? DEFAULT_FRAME_ANCESTORS_PROD : DEFAULT_FRAME_ANCESTORS_DEV).join(' ');
}

function ensureFrameAncestorsHasSelf(value) {
  const raw = String(value || '').trim();
  if (!raw) return "'self'";
  const parts = raw.split(/\s+/g).filter(Boolean);
  const hasSelf = parts.some((part) => part === "'self'" || part === 'self');
  if (hasSelf) return parts.join(' ');
  return ["'self'", ...parts].join(' ');
}

export {
  isAdminPath,
  isAllowedAdminRequest,
  buildFrameAncestorsValue,
  ensureFrameAncestorsHasSelf,
};
