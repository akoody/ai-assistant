import { getDatabase } from './database.js';
import { normalizeUserId, normalizeSessionId, pickClientId } from './identifiers.js';
import { resolveUserByClientId, upsertClientLink } from './widgetUsers.js';
import { extractHostname, detectBaseDomain, normalizeAnalyticsDomain } from './domains.js';
import { parseTimestamp } from './analyticsTimeline.js';

export function registerTrackingRoutes(app) {
  app.post('/api/analytics/track', async (req, res) => {
    try {
      const { event, userId, sessionId, payload } = req.body;
      const db = await getDatabase();
      const normalizedPayload =
        payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
      const clientId = pickClientId(
        req.body?.clientId,
        req.body?.client_id,
        normalizedPayload?.clientId,
        normalizedPayload?.client_id
      );
      let effectiveUserId = normalizeUserId(userId);

      if (!effectiveUserId && clientId) {
        const resolved = await resolveUserByClientId(db, clientId);
        effectiveUserId = normalizeUserId(resolved?.userId);
      }

      if (!event || (!effectiveUserId && !clientId)) {
        return res
          .status(400)
          .json({ success: false, error: 'event и userId/clientId обязательны' });
      }

      if (clientId && effectiveUserId) {
        await upsertClientLink(db, clientId, effectiveUserId);
      }

      const {
        userId: _payloadUserId,
        sessionId: _payloadSessionId,
        clientId: _payloadClientId,
        client_id: _payloadClientIdSnake,
        event: _payloadEvent,
        timestamp: rawClientTimestamp,
        createdAt: _payloadCreatedAt,
        ...payloadFields
      } = normalizedPayload;
      const payloadPageHost = extractHostname(payloadFields?.page);
      const payloadEmbeddingHost = extractHostname(payloadFields?.embeddingHost);
      const payloadDomain = normalizeAnalyticsDomain(payloadFields?.domain);
      const payloadBaseDomain = normalizeAnalyticsDomain(payloadFields?.baseDomain);
      const inferredDomain =
        payloadDomain ||
        payloadBaseDomain ||
        detectBaseDomain(payloadPageHost) ||
        detectBaseDomain(payloadEmbeddingHost);
      const clientTimestamp = parseTimestamp(rawClientTimestamp);
      const doc = {
        userId: effectiveUserId || null,
        clientId: clientId || null,
        sessionId: normalizeSessionId(sessionId),
        timestamp: new Date(),
        ...payloadFields,
        embeddingHost: payloadEmbeddingHost || payloadFields?.embeddingHost || null,
        pageHost: payloadPageHost || null,
        baseDomain: inferredDomain || null,
        domain: inferredDomain || null,
      };
      if (clientTimestamp) {
        doc.clientTimestamp = clientTimestamp;
      }
      const collectionMap = {
        widget_open: 'widget_opens',
        widget_expanded: 'widget_opens',
        events_shown: 'widget_events',
        event_card_click: 'widget_event_clicks',
      };
      const col = collectionMap[event];
      if (col) {
        await db.collection(col).insertOne({ ...doc, event });
      }
      return res.json({ success: true });
    } catch (err) {
      console.error('Ошибка analytics/track:', err);
      return res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
  });
}
