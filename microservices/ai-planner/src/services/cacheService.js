import NodeCache from 'node-cache';

const cache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

export function getCache(key) {
  return cache.get(key) || null;
}

export function setCache(key, value, ttl = 3600) {
  return cache.set(key, value, ttl);
}

export function deleteCache(key) {
  return cache.del(key);
}

export function clearCache() {
  cache.flushAll();
}

export function getCacheStats() {
  const stats = cache.getStats();
  return {
    keys: stats.keys,
    hits: stats.hits,
    misses: stats.misses,
  };
}
