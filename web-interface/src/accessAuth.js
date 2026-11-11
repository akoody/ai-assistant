import jwt from 'jsonwebtoken';
import { JWT_SECRET, SITE_LOGIN, SITE_PASSWORD, SITE_JWT_SECRET } from './config.js';
import crypto from 'crypto';

function adminAuth(requiredRole) {
  return (req, res, next) => {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return res.status(401).json({ success: false, error: 'Токен отсутствует' });
    }
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.adminUser = payload;
      if (requiredRole && payload.role !== requiredRole) {
        return res.status(403).json({ success: false, error: 'Недостаточно прав' });
      }
      next();
    } catch {
      return res.status(401).json({ success: false, error: 'Неверный или истёкший токен' });
    }
  };
}

function isSiteAuthConfigured() {
  return Boolean(
    String(SITE_LOGIN || '').trim() &&
    String(SITE_PASSWORD || '').trim() &&
    String(SITE_JWT_SECRET || '').trim()
  );
}

function timingSafeStringEqual(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ''));
  const expectedBuffer = Buffer.from(String(expected || ''));
  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function siteAuth(req, res, next) {
  if (!isSiteAuthConfigured()) {
    return res.status(503).json({
      success: false,
      error: 'Авторизация главной страницы не настроена',
    });
  }

  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ success: false, error: 'Токен отсутствует' });
  }

  try {
    const payload = jwt.verify(token, SITE_JWT_SECRET);
    if (payload?.scope !== 'site-widget') {
      return res.status(401).json({ success: false, error: 'Неверный токен' });
    }
    req.siteUser = payload;
    next();
  } catch {
    return res.status(401).json({ success: false, error: 'Неверный или истёкший токен' });
  }
}

const rateLimitBuckets = new Map();

export { adminAuth, isSiteAuthConfigured, timingSafeStringEqual, siteAuth, rateLimitBuckets };
