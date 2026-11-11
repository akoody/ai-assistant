import { getDatabase } from './database.js';
import { adminAuth } from './accessAuth.js';
import {
  buildAnalyticsFilter,
  parseAnalyticsLimit,
  fetchAnalyticsRows,
  buildWidgetOpenFilter,
  mergeMongoFilters,
  percent,
  buildFunnelStep,
} from './analyticsFilters.js';
import { normalizeAnalyticsDomain, detectBaseDomain } from './domains.js';
import { buildMessagesCsv, buildAnalyticsCsv } from './analyticsCsv.js';
import { extractEventNames, extractEventCount } from './analyticsEvents.js';
import { buildUserSessions, buildUserTimeline } from './analyticsTimeline.js';

export function registerAnalyticsRoutes(app) {
  app.get('/api/admin/analytics/widget-opens', adminAuth(), async (req, res) => {
    try {
      const { from, to, userId, limit, domain } = req.query;
      const db = await getDatabase();
      const filter = buildWidgetOpenFilter(buildAnalyticsFilter({ from, to, userId, domain }));
      const rowsLimit = parseAnalyticsLimit(limit, 5000, 20000);
      const data = await fetchAnalyticsRows(db, 'widget_opens', filter, rowsLimit);
      return res.json({ success: true, data });
    } catch (err) {
      console.error('Ошибка analytics widget-opens:', err);
      return res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
  });

  app.get('/api/admin/analytics/messages', adminAuth(), async (req, res) => {
    try {
      const { from, to, userId, limit, domain } = req.query;
      const db = await getDatabase();
      const filter = buildAnalyticsFilter({ from, to, userId, domain });
      const rowsLimit = parseAnalyticsLimit(limit, 5000, 20000);
      const data = await fetchAnalyticsRows(db, 'widget_messages', filter, rowsLimit);
      return res.json({ success: true, data });
    } catch (err) {
      console.error('Ошибка analytics messages:', err);
      return res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
  });

  app.get('/api/admin/analytics/messages/export', adminAuth(), async (req, res) => {
    try {
      const { from, to, userId, domain } = req.query;
      const rawLimit = req.query.limit;

      let exportLimit = null;
      if (rawLimit !== undefined) {
        const parsed = parseInt(String(rawLimit), 10);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          return res
            .status(400)
            .json({ success: false, error: 'Параметр limit должен быть положительным числом' });
        }
        exportLimit = Math.min(parsed, 50000);
      }

      const db = await getDatabase();
      const filter = buildAnalyticsFilter({ from, to, userId, domain });
      const messages = await fetchAnalyticsRows(db, 'widget_messages', filter, exportLimit);

      const normalizedDomain = normalizeAnalyticsDomain(domain) || 'all-domains';
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const csv = buildMessagesCsv(messages);

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="widget-messages-${normalizedDomain}-${stamp}.csv"`
      );
      return res.send(`\uFEFF${csv}`);
    } catch (err) {
      console.error('Ошибка экспорта сообщений analytics:', err);
      return res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
  });

  app.get('/api/admin/analytics/events', adminAuth(), async (req, res) => {
    try {
      const { from, to, userId, limit, domain } = req.query;
      const db = await getDatabase();
      const filter = buildAnalyticsFilter({ from, to, userId, domain });
      const rowsLimit = parseAnalyticsLimit(limit, 5000, 20000);
      const data = await fetchAnalyticsRows(db, 'widget_events', filter, rowsLimit);
      return res.json({ success: true, data });
    } catch (err) {
      console.error('Ошибка analytics events:', err);
      return res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
  });

  app.get('/api/admin/analytics/event-clicks', adminAuth(), async (req, res) => {
    try {
      const { from, to, userId, limit, domain } = req.query;
      const db = await getDatabase();
      const filter = buildAnalyticsFilter({ from, to, userId, domain });
      const rowsLimit = parseAnalyticsLimit(limit, 5000, 20000);
      const data = await fetchAnalyticsRows(db, 'widget_event_clicks', filter, rowsLimit);
      return res.json({ success: true, data });
    } catch (err) {
      console.error('Ошибка analytics event-clicks:', err);
      return res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
  });

  app.get('/api/admin/analytics/funnel', adminAuth(), async (req, res) => {
    try {
      const { from, to, userId, domain } = req.query;
      const baseFilter = buildAnalyticsFilter({ from, to, userId, domain });
      const db = await getDatabase();

      const [stepOpen, stepMessage, stepEventsShown, stepEventClick] = await Promise.all([
        buildFunnelStep(db, {
          key: 'widget_open',
          label: 'Открыли виджет',
          collection: 'widget_opens',
          filter: buildWidgetOpenFilter(baseFilter),
        }),
        buildFunnelStep(db, {
          key: 'message_sent',
          label: 'Отправили сообщение',
          collection: 'widget_messages',
          filter: baseFilter,
        }),
        buildFunnelStep(db, {
          key: 'events_shown',
          label: 'Получили выдачу событий',
          collection: 'widget_events',
          filter: baseFilter,
        }),
        buildFunnelStep(db, {
          key: 'event_click',
          label: 'Кликнули по событию',
          collection: 'widget_event_clicks',
          filter: mergeMongoFilters(baseFilter, { event: 'event_card_click' }),
        }),
      ]);

      const steps = [stepOpen, stepMessage, stepEventsShown, stepEventClick];
      steps.forEach((step, index) => {
        if (index === 0) {
          step.conversionFromPrevUsers = 100;
          step.conversionFromPrevSessions = 100;
          return;
        }
        const prev = steps[index - 1];
        step.conversionFromPrevUsers = percent(step.uniqueUsers, prev.uniqueUsers);
        step.conversionFromPrevSessions = percent(step.uniqueSessions, prev.uniqueSessions);
      });

      return res.json({
        success: true,
        steps,
        totals: {
          usersAtStart: stepOpen.uniqueUsers,
          usersAtEnd: stepEventClick.uniqueUsers,
          overallUsersConversion: percent(stepEventClick.uniqueUsers, stepOpen.uniqueUsers),
          sessionsAtStart: stepOpen.uniqueSessions,
          sessionsAtEnd: stepEventClick.uniqueSessions,
          overallSessionsConversion: percent(
            stepEventClick.uniqueSessions,
            stepOpen.uniqueSessions
          ),
        },
      });
    } catch (err) {
      console.error('Ошибка analytics funnel:', err);
      return res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
  });

  app.get('/api/admin/analytics/user-card', adminAuth(), async (req, res) => {
    try {
      const { userId, from, to, domain } = req.query;
      const normalizedUserId = String(userId || '').trim();
      if (!normalizedUserId) {
        return res.status(400).json({ success: false, error: 'Параметр userId обязателен' });
      }

      const requestedLimit = parseInt(String(req.query.limit || '100'), 10);
      const perCollectionLimit = Number.isInteger(requestedLimit)
        ? Math.min(Math.max(requestedLimit, 20), 300)
        : 100;

      const filter = buildAnalyticsFilter({ from, to, userId: normalizedUserId, domain });
      const db = await getDatabase();

      const [opens, messages, events, clicks] = await Promise.all([
        fetchAnalyticsRows(db, 'widget_opens', buildWidgetOpenFilter(filter), perCollectionLimit),
        fetchAnalyticsRows(db, 'widget_messages', filter, perCollectionLimit),
        fetchAnalyticsRows(db, 'widget_events', filter, perCollectionLimit),
        fetchAnalyticsRows(db, 'widget_event_clicks', filter, perCollectionLimit),
      ]);

      const allItems = [
        ...opens.map((item) => ({ item, kind: 'open' })),
        ...messages.map((item) => ({ item, kind: 'message' })),
        ...events.map((item) => ({ item, kind: 'events_shown' })),
        ...clicks.map((item) => ({ item, kind: 'event_click' })),
      ];

      const sessions = buildUserSessions(allItems);
      const timeline = buildUserTimeline(allItems, 200);

      const messageRows = messages.map((msg) => ({
        timestamp: msg.timestamp || msg.createdAt || null,
        sessionId: msg.sessionId || msg.session_id || null,
        text: msg.message || msg.text || msg.content || '',
      }));

      const eventRows = events.map((evt) => ({
        timestamp: evt.timestamp || evt.createdAt || null,
        sessionId: evt.sessionId || evt.session_id || null,
        count: extractEventCount(evt),
        eventNames: extractEventNames(evt),
      }));

      const clickRows = clicks.map((click) => ({
        timestamp: click.timestamp || click.createdAt || null,
        sessionId: click.sessionId || click.session_id || null,
        eventName: click.eventName || click.event_name || click.title || '',
        url: click.url || '',
        event: click.event || '',
      }));

      return res.json({
        success: true,
        userId: normalizedUserId,
        summary: {
          opens: opens.length,
          messages: messages.length,
          eventsShown: events.length,
          eventClicks: clicks.length,
          sessions: sessions.length,
        },
        sessions,
        timeline,
        details: {
          messages: messageRows,
          events: eventRows,
          clicks: clickRows,
        },
      });
    } catch (err) {
      console.error('Ошибка analytics user-card:', err);
      return res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
  });

  app.get('/api/admin/analytics/export', adminAuth(), async (req, res) => {
    try {
      const { from, to, userId, domain } = req.query;
      const format = String(req.query.format || 'json')
        .trim()
        .toLowerCase();
      const rawLimit = req.query.limit;

      if (!['json', 'csv'].includes(format)) {
        return res.status(400).json({ success: false, error: 'Поддерживаются форматы: json, csv' });
      }

      let exportLimit = null;
      if (rawLimit !== undefined) {
        const parsed = parseInt(String(rawLimit), 10);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          return res
            .status(400)
            .json({ success: false, error: 'Параметр limit должен быть положительным числом' });
        }
        exportLimit = Math.min(parsed, 50000);
      }

      const filter = buildAnalyticsFilter({ from, to, userId, domain });
      const db = await getDatabase();

      const [widgetOpens, messages, events, eventClicks] = await Promise.all([
        fetchAnalyticsRows(db, 'widget_opens', buildWidgetOpenFilter(filter), exportLimit),
        fetchAnalyticsRows(db, 'widget_messages', filter, exportLimit),
        fetchAnalyticsRows(db, 'widget_events', filter, exportLimit),
        fetchAnalyticsRows(db, 'widget_event_clicks', filter, exportLimit),
      ]);

      const exportPayload = {
        exportedAt: new Date().toISOString(),
        filter: {
          from: from || null,
          to: to || null,
          userId: userId || null,
          domain: normalizeAnalyticsDomain(domain) || null,
          limit: exportLimit,
        },
        totals: {
          widgetOpens: widgetOpens.length,
          messages: messages.length,
          events: events.length,
          eventClicks: eventClicks.length,
        },
        data: {
          widgetOpens,
          messages,
          events,
          eventClicks,
        },
      };

      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      if (format === 'json') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="analytics-export-${stamp}.json"`
        );
        return res.send(JSON.stringify(exportPayload, null, 2));
      }

      const csv = buildAnalyticsCsv(exportPayload.data);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="analytics-export-${stamp}.csv"`);
      return res.send(`\uFEFF${csv}`);
    } catch (err) {
      console.error('Ошибка экспорта аналитики:', err);
      return res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
  });

  app.post('/api/admin/analytics/delete-by-user', adminAuth('admin'), async (req, res) => {
    try {
      const userId = String(req.body?.userId || '').trim();
      const dataset = String(req.body?.dataset || 'all')
        .trim()
        .toLowerCase();
      if (!userId) {
        return res.status(400).json({ success: false, error: 'Параметр userId обязателен' });
      }

      const datasetMap = {
        opens: ['widget_opens'],
        messages: ['widget_messages'],
        events: ['widget_events'],
        clicks: ['widget_event_clicks'],
        all: ['widget_opens', 'widget_messages', 'widget_events', 'widget_event_clicks'],
      };
      const targetCollections = datasetMap[dataset];
      if (!targetCollections) {
        return res.status(400).json({
          success: false,
          error: 'Неверный dataset. Допустимо: all, opens, messages, events, clicks',
        });
      }

      const db = await getDatabase();
      const deletedByCollection = {};
      let totalDeleted = 0;
      for (const collectionName of targetCollections) {
        const result = await db.collection(collectionName).deleteMany({ userId });
        const deletedCount = Number(result?.deletedCount || 0);
        deletedByCollection[collectionName] = deletedCount;
        totalDeleted += deletedCount;
      }

      return res.json({
        success: true,
        userId,
        dataset,
        totalDeleted,
        deletedByCollection,
      });
    } catch (err) {
      console.error('Ошибка удаления analytics по userId:', err);
      return res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
  });

  app.get('/api/admin/analytics/domains', adminAuth(), async (req, res) => {
    try {
      const db = await getDatabase();
      const collections = [
        'widget_opens',
        'widget_messages',
        'widget_events',
        'widget_event_clicks',
      ];
      const domains = new Set();

      for (const collectionName of collections) {
        const rows = await db
          .collection(collectionName)
          .find(
            {},
            { projection: { domain: 1, baseDomain: 1, embeddingHost: 1, pageHost: 1, page: 1 } }
          )
          .sort({ timestamp: -1 })
          .limit(10000)
          .toArray();
        rows.forEach((row) => {
          const detected =
            normalizeAnalyticsDomain(row?.domain) ||
            normalizeAnalyticsDomain(row?.baseDomain) ||
            detectBaseDomain(row?.pageHost) ||
            detectBaseDomain(row?.embeddingHost) ||
            detectBaseDomain(row?.page);
          if (detected) domains.add(detected);
        });
      }

      const ordered = Array.from(domains).sort((a, b) => a.localeCompare(b));
      return res.json({ success: true, domains: ordered });
    } catch (err) {
      console.error('Ошибка analytics domains:', err);
      return res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
  });
}
