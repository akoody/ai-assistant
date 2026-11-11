import { rateLimitBuckets } from './accessAuth.js';

function normalizeRateLimitKeyPart(value) {
  return (
    String(value || '')
      .trim()
      .toLowerCase()
      .slice(0, 256) || 'unknown'
  );
}

function cleanupRateLimitBucket(key, now) {
  const bucket = rateLimitBuckets.get(key);
  if (!bucket) return null;
  if (bucket.resetAt <= now) {
    rateLimitBuckets.delete(key);
    return null;
  }
  return bucket;
}

function hitRateLimitBucket(key, limit, windowMs, now) {
  const existing = cleanupRateLimitBucket(key, now);
  if (!existing) {
    const bucket = { count: 1, resetAt: now + windowMs };
    rateLimitBuckets.set(key, bucket);
    return { limited: false, remaining: Math.max(limit - 1, 0), resetAt: bucket.resetAt };
  }

  existing.count += 1;
  return {
    limited: existing.count > limit,
    remaining: Math.max(limit - existing.count, 0),
    resetAt: existing.resetAt,
  };
}

function resetRateLimitBucket(key) {
  rateLimitBuckets.delete(key);
}

function getRequestIp(req) {
  return normalizeRateLimitKeyPart(req.ip || req.socket?.remoteAddress || 'unknown');
}

function createLoginRateLimiter({
  windowMs = 15 * 60 * 1000,
  perLoginLimit = 30,
  perIpLimit = 240,
  namespace,
}) {
  return (req, res, next) => {
    const now = Date.now();
    const ip = getRequestIp(req);
    const login = normalizeRateLimitKeyPart(req.body?.login);
    const ipKey = `${namespace}:ip:${ip}`;
    const loginKey = `${namespace}:login:${ip}:${login}`;

    const ipHit = hitRateLimitBucket(ipKey, perIpLimit, windowMs, now);
    const loginHit = hitRateLimitBucket(loginKey, perLoginLimit, windowMs, now);
    const hit = ipHit.limited ? ipHit : loginHit;

    if (ipHit.limited || loginHit.limited) {
      const retryAfterSeconds = Math.max(1, Math.ceil((hit.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({
        success: false,
        error: 'Слишком много попыток входа. Попробуйте ещё раз позже.',
      });
    }

    req.loginRateLimit = {
      reset: () => {
        resetRateLimitBucket(ipKey);
        resetRateLimitBucket(loginKey);
      },
    };
    next();
  };
}

const adminLoginRateLimit = createLoginRateLimiter({
  namespace: 'admin-login',
  perLoginLimit: 30,
  perIpLimit: 240,
});

const siteLoginRateLimit = createLoginRateLimiter({
  namespace: 'site-login',
  perLoginLimit: 40,
  perIpLimit: 300,
});

export { adminLoginRateLimit, siteLoginRateLimit };
