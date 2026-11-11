function toIsoDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function getEventNamesForExport(doc) {
  const payload = doc && typeof doc.payload === 'object' ? doc.payload : {};
  const rawEvents =
    doc?.events ?? doc?.eventsList ?? payload?.events ?? payload?.eventsList ?? null;
  if (!Array.isArray(rawEvents)) {
    return '';
  }
  return rawEvents
    .map((item) => {
      if (item && typeof item === 'object') {
        return String(item.name || item.title || item.eventName || item.label || '').trim();
      }
      return String(item || '').trim();
    })
    .filter(Boolean)
    .join(' | ');
}

function extractEventNames(doc) {
  const value = getEventNamesForExport(doc);
  if (!value) return [];
  return value
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractEventCount(doc) {
  const payload = doc && typeof doc.payload === 'object' ? doc.payload : {};
  const fromCount = Number(
    doc?.count ?? doc?.eventsCount ?? payload?.count ?? payload?.eventsCount ?? 0
  );
  if (Number.isFinite(fromCount) && fromCount > 0) {
    return fromCount;
  }
  const names = extractEventNames(doc);
  return names.length;
}

export {
  toIsoDate,
  safeJsonStringify,
  getEventNamesForExport,
  extractEventNames,
  extractEventCount,
};
