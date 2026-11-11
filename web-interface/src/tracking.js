import { getDatabase } from './database.js';
import { normalizeUserId, normalizeSessionId, normalizeClientId } from './identifiers.js';
import { extractHostname, detectBaseDomain, normalizeAnalyticsDomain } from './domains.js';

async function recordServerEventsShown({
  userId,
  clientId,
  sessionId,
  clientContext,
  offerEvents,
  timestamp,
}) {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId || !Array.isArray(offerEvents) || offerEvents.length === 0) {
    return;
  }

  const events = offerEvents
    .map((event) => {
      if (!event || typeof event !== 'object') return null;
      const title = String(event.title || event.name || '').trim();
      if (!title) return null;
      return { title, url: event.url ? String(event.url) : null };
    })
    .filter(Boolean);

  if (!events.length) return;

  const clientContextBaseDomain = normalizeAnalyticsDomain(clientContext?.baseDomain);
  const clientContextEmbeddingHost = extractHostname(clientContext?.embeddingHost);
  const pageDomain = detectBaseDomain(clientContext?.pageUrl);
  const analyticsDomain =
    clientContextBaseDomain ||
    pageDomain ||
    (clientContextEmbeddingHost ? detectBaseDomain(clientContextEmbeddingHost) : null);
  const payloadPageHost = extractHostname(clientContext?.pageUrl);
  const recordedAt =
    timestamp instanceof Date && !Number.isNaN(timestamp.getTime())
      ? new Date(timestamp.getTime())
      : new Date();

  const db = await getDatabase();
  const doc = {
    userId: normalizedUserId,
    clientId: normalizeClientId(clientId) || null,
    sessionId: normalizeSessionId(sessionId),
    timestamp: recordedAt,
    count: events.length,
    events,
    page: clientContext?.pageUrl || null,
    embeddingHost: clientContextEmbeddingHost || null,
    pageHost: payloadPageHost || null,
    baseDomain: analyticsDomain || null,
    domain: analyticsDomain || null,
    city: clientContext?.city || null,
    deliverySource: 'server',
    event: 'events_shown',
  };

  await db.collection('widget_events').insertOne(doc);
}

export { recordServerEventsShown };
