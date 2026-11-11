import { toIsoDate, safeJsonStringify, getEventNamesForExport } from './analyticsEvents.js';

function toCsvCell(value) {
  const raw = String(value ?? '');
  const str = /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  if (/[;"\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildAnalyticsCsv(data) {
  const headers = [
    'dataset',
    'userId',
    'sessionId',
    'timestamp',
    'event',
    'message',
    'eventName',
    'url',
    'page',
    'city',
    'count',
    'events',
    'raw',
  ];

  const rows = [headers];
  const collections = [
    ['widget_opens', Array.isArray(data?.widgetOpens) ? data.widgetOpens : []],
    ['widget_messages', Array.isArray(data?.messages) ? data.messages : []],
    ['widget_events', Array.isArray(data?.events) ? data.events : []],
    ['widget_event_clicks', Array.isArray(data?.eventClicks) ? data.eventClicks : []],
  ];

  collections.forEach(([dataset, items]) => {
    items.forEach((doc) => {
      const payload = doc && typeof doc.payload === 'object' ? doc.payload : {};
      const eventName =
        doc?.eventName ||
        doc?.event_name ||
        doc?.title ||
        payload?.eventName ||
        payload?.title ||
        '';
      const count = doc?.count ?? doc?.eventsCount ?? payload?.count ?? payload?.eventsCount ?? '';
      rows.push([
        dataset,
        doc?.userId || doc?.user_id || '',
        doc?.sessionId || doc?.session_id || '',
        toIsoDate(doc?.timestamp || doc?.createdAt),
        doc?.event || '',
        doc?.message || doc?.text || doc?.content || '',
        eventName,
        doc?.url || '',
        doc?.page || '',
        doc?.city || '',
        count,
        getEventNamesForExport(doc),
        safeJsonStringify(doc),
      ]);
    });
  });

  return rows.map((row) => row.map((value) => toCsvCell(value)).join(';')).join('\n');
}

function buildMessagesCsv(items) {
  const rows = [['userId', 'timestamp', 'message']];

  (Array.isArray(items) ? items : []).forEach((doc) => {
    rows.push([
      doc?.userId || doc?.user_id || '',
      toIsoDate(doc?.timestamp || doc?.createdAt),
      doc?.message || doc?.text || doc?.content || '',
    ]);
  });

  return rows.map((row) => row.map((value) => toCsvCell(value)).join(';')).join('\n');
}

export { buildAnalyticsCsv, buildMessagesCsv };
