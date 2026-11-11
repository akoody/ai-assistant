import { ObjectId } from 'mongodb';
import { extractEventNames, extractEventCount } from './analyticsEvents.js';

function parseTimestamp(value) {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function getTimelineTypePriority(kind) {
  if (kind === 'event_click') return 4;
  if (kind === 'events_shown') return 3;
  if (kind === 'message') return 2;
  if (kind === 'open') return 1;
  return 0;
}

function getTimelineTieBreaker(item) {
  const rawId = item?._id;
  if (rawId instanceof ObjectId) {
    return rawId.toHexString();
  }
  return String(rawId || '');
}

function buildUserSessions(items) {
  const bySession = new Map();

  items.forEach(({ item, kind }) => {
    const sessionId = String(item?.sessionId || item?.session_id || '').trim() || 'no-session';
    const timestamp = parseTimestamp(item?.timestamp || item?.createdAt);
    if (!timestamp) return;

    if (!bySession.has(sessionId)) {
      bySession.set(sessionId, {
        sessionId: sessionId === 'no-session' ? null : sessionId,
        firstSeen: timestamp,
        lastSeen: timestamp,
        totalEvents: 0,
        opens: 0,
        messages: 0,
        eventsShown: 0,
        eventClicks: 0,
      });
    }

    const entry = bySession.get(sessionId);
    entry.totalEvents += 1;
    if (timestamp < entry.firstSeen) entry.firstSeen = timestamp;
    if (timestamp > entry.lastSeen) entry.lastSeen = timestamp;
    if (kind === 'open') entry.opens += 1;
    if (kind === 'message') entry.messages += 1;
    if (kind === 'events_shown') entry.eventsShown += 1;
    if (kind === 'event_click') entry.eventClicks += 1;
  });

  return Array.from(bySession.values())
    .sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime())
    .map((entry) => ({
      ...entry,
      firstSeen: entry.firstSeen.toISOString(),
      lastSeen: entry.lastSeen.toISOString(),
    }));
}

function timelineDescription({ kind, item }) {
  if (kind === 'message') {
    const text = String(item?.message || item?.text || item?.content || '').trim();
    return text.length > 140 ? `${text.slice(0, 140)}...` : text;
  }
  if (kind === 'events_shown') {
    const count = extractEventCount(item);
    const names = extractEventNames(item).slice(0, 5);
    const namesText = names.length ? ` (${names.join(', ')})` : '';
    return `${count} событий${namesText}`;
  }
  if (kind === 'event_click') {
    return String(item?.eventName || item?.event_name || item?.title || item?.url || '').trim();
  }
  return String(item?.event || item?.page || '').trim();
}

function buildUserTimeline(items, limit = 200) {
  return items
    .map(({ item, kind }) => {
      const timestamp = parseTimestamp(item?.timestamp || item?.createdAt);
      if (!timestamp) return null;
      return {
        timestamp,
        type: kind,
        event: item?.event || '',
        sessionId: item?.sessionId || item?.session_id || null,
        description: timelineDescription({ kind, item }),
        typePriority: getTimelineTypePriority(kind),
        tieBreaker: getTimelineTieBreaker(item),
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const timestampDiff = b.timestamp.getTime() - a.timestamp.getTime();
      if (timestampDiff !== 0) return timestampDiff;

      const typeDiff = b.typePriority - a.typePriority;
      if (typeDiff !== 0) return typeDiff;

      return b.tieBreaker.localeCompare(a.tieBreaker);
    })
    .slice(0, Math.max(1, Number(limit) || 200))
    .map((entry) => ({
      ...entry,
      timestamp: entry.timestamp.toISOString(),
      typePriority: undefined,
      tieBreaker: undefined,
    }));
}

export { parseTimestamp, buildUserSessions, buildUserTimeline };
