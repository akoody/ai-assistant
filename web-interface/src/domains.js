function normalizeHost(hostname) {
  return String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/^\.+/, '')
    .replace(/\.+$/, '');
}

function extractHostname(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return normalizeHost(new URL(raw).hostname);
  } catch {
    return normalizeHost(raw);
  }
}

function detectBaseDomain(value) {
  const host = extractHostname(value);
  if (!host) return null;
  if (host === 'sferaai.ru' || host.endsWith('.sferaai.ru')) return 'sferaai.ru';
  if (host === 'kassir.ru' || host.endsWith('.kassir.ru')) return 'kassir.ru';
  return null;
}

function normalizeAnalyticsDomain(value) {
  const base = detectBaseDomain(value);
  if (base) return base;
  const host = normalizeHost(value);
  if (!host) return null;
  if (host === 'all') return null;
  if (host === 'sferaai') return 'sferaai.ru';
  if (host === 'kassir') return 'kassir.ru';
  return null;
}

export { normalizeHost, extractHostname, detectBaseDomain, normalizeAnalyticsDomain };
