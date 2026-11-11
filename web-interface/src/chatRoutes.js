import {
  AI_PLANNER_URL,
  AI_PLANNER_API_KEY,
  LONG_TIMEOUT_AGENT,
  CHAT_PROXY_TIMEOUT_MS,
} from './config.js';
import {
  normalizeUserId,
  pickClientId,
  normalizeSessionId,
  normalizeClientId,
} from './identifiers.js';
import { widgetAuth, assertWidgetUserAccess } from './widgetAuth.js';
import {
  buildChatProxyFriendlyError,
  sanitizeUpstreamChatErrorMessage,
  readUpstreamJsonResponse,
  isExpectedSseAbort,
} from './upstreamErrors.js';
import { getDatabase } from './database.js';
import { upsertClientLink } from './widgetUsers.js';
import { extractHostname, detectBaseDomain, normalizeAnalyticsDomain } from './domains.js';
import { recordServerEventsShown } from './tracking.js';

export function registerChatRoutes(app) {
  app.get('/api/chat/history', widgetAuth, async (req, res) => {
    try {
      const { userId, limit } = req.query;
      const clientId = pickClientId(req.query?.clientId, req.query?.client_id);
      const effectiveUserId = normalizeUserId(req.widgetUser?.userId);

      if (!effectiveUserId || !assertWidgetUserAccess(req, res, userId, clientId)) {
        return;
      }

      if (!effectiveUserId) {
        return res.status(400).json({
          success: false,
          error: 'Параметр userId или clientId обязателен',
        });
      }

      const params = new URLSearchParams({ userId: effectiveUserId });
      if (limit) {
        params.append('limit', limit);
      }

      const response = await fetch(`${AI_PLANNER_URL}/api/chat/history?${params.toString()}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${AI_PLANNER_API_KEY}`,
        },
        dispatcher: LONG_TIMEOUT_AGENT,
      });

      const data = await response
        .json()
        .catch(() => ({ success: false, error: 'Некорректный ответ AI Planner' }));

      if (!response.ok) {
        return res.status(response.status).json({
          success: false,
          error: data.error || `AI Planner ошибка: ${response.status} - ${response.statusText}`,
        });
      }

      return res.json({
        ...data,
        userId: effectiveUserId,
        clientId: clientId || null,
      });
    } catch (error) {
      console.error('Ошибка получения истории чата:', error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Внутренняя ошибка сервера',
      });
    }
  });

  app.post('/api/chat/message', widgetAuth, async (req, res) => {
    try {
      const { userId, sessionId, message, clientContext } = req.body;
      const clientId = pickClientId(
        req.body?.clientId,
        req.body?.client_id,
        req.body?.clientContext?.clientId,
        req.body?.clientContext?.client_id
      );
      const effectiveUserId = normalizeUserId(req.widgetUser?.userId);

      if (!assertWidgetUserAccess(req, res, userId, clientId)) {
        return;
      }

      if (!effectiveUserId || !message) {
        return res.status(400).json({
          success: false,
          error: 'Поля userId (или clientId) и message обязательны',
        });
      }

      const requestReceivedAt = new Date();

      if (clientId && normalizeClientId(req.widgetUser?.clientId) === clientId) {
        const db = await getDatabase();
        await upsertClientLink(db, clientId, effectiveUserId);
      }

      // Отправляем запрос в AI Planner
      const upstreamController = new AbortController();
      const upstreamTimeoutId = setTimeout(() => upstreamController.abort(), CHAT_PROXY_TIMEOUT_MS);
      let response;

      try {
        response = await fetch(`${AI_PLANNER_URL}/api/chat/message`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${AI_PLANNER_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            userId: effectiveUserId,
            sessionId: normalizeSessionId(sessionId),
            message,
            requestId: req.body.requestId, // Передаем requestId дальше
            clientContext: clientContext || null,
            clientId: clientId || null,
          }),
          signal: upstreamController.signal,
          dispatcher: LONG_TIMEOUT_AGENT,
        });
      } catch (error) {
        clearTimeout(upstreamTimeoutId);
        if (error?.name === 'AbortError') {
          console.error('Таймаут ожидания AI Planner в /api/chat/message', {
            timeoutMs: CHAT_PROXY_TIMEOUT_MS,
            userId: effectiveUserId,
            sessionId: normalizeSessionId(sessionId),
          });
          return res.status(504).json({
            success: false,
            error: 'Сервис временно не ответил. Попробуйте ещё раз через минуту.',
          });
        }
        throw error;
      }

      clearTimeout(upstreamTimeoutId);

      const { contentType, bodyText, json } = await readUpstreamJsonResponse(response);

      if (!response.ok) {
        const errorData = json && typeof json === 'object' ? json : {};
        const friendlyError = buildChatProxyFriendlyError(response.status, contentType, bodyText);
        const snippet = String(bodyText || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 240);
        console.error('AI Planner вернул ошибку в /api/chat/message', {
          status: response.status,
          contentType: contentType || 'unknown',
          bodyPreview: snippet || '[empty]',
          userId: effectiveUserId,
          sessionId: normalizeSessionId(sessionId),
        });
        return res.status(response.status).json({
          success: false,
          error: sanitizeUpstreamChatErrorMessage(errorData.error, friendlyError),
        });
      }

      if (!json || typeof json !== 'object') {
        const snippet = String(bodyText || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 240);
        console.error('AI Planner вернул некорректный не-JSON ответ в /api/chat/message', {
          status: response.status,
          contentType: contentType || 'unknown',
          bodyPreview: snippet || '[empty]',
          userId: effectiveUserId,
          sessionId: normalizeSessionId(sessionId),
        });
        return res.status(502).json({
          success: false,
          error: buildChatProxyFriendlyError(response.status, contentType, bodyText),
        });
      }

      const data = json;

      getDatabase()
        .then((db) => {
          const clientContextBaseDomain = normalizeAnalyticsDomain(clientContext?.baseDomain);
          const clientContextEmbeddingHost = extractHostname(clientContext?.embeddingHost);
          const pageDomain = detectBaseDomain(clientContext?.pageUrl);
          const analyticsDomain =
            clientContextBaseDomain ||
            pageDomain ||
            (clientContextEmbeddingHost ? detectBaseDomain(clientContextEmbeddingHost) : null);
          db.collection('widget_messages')
            .insertOne({
              userId: effectiveUserId,
              clientId: clientId || null,
              sessionId: data.sessionId || normalizeSessionId(sessionId) || null,
              message,
              timestamp: requestReceivedAt,
              page: clientContext?.pageUrl || null,
              embeddingHost: clientContextEmbeddingHost || null,
              baseDomain: analyticsDomain || null,
              domain: analyticsDomain || null,
              city: clientContext?.city || null,
            })
            .catch((e) => console.warn('analytics widget_messages:', e.message));
        })
        .catch(() => {});

      if (data.offer?.events && Array.isArray(data.offer.events) && data.offer.events.length > 0) {
        const eventsShownAt = new Date();
        recordServerEventsShown({
          userId: effectiveUserId,
          clientId,
          sessionId: data.sessionId || normalizeSessionId(sessionId),
          clientContext,
          offerEvents: data.offer.events,
          timestamp: eventsShownAt,
        }).catch((e) => console.warn('analytics server events_shown:', e?.message || e));
      }

      // AI Planner возвращает данные без success: true, добавляем его
      res.json({
        success: true,
        userId: effectiveUserId,
        clientId: clientId || null,
        sessionId: data.sessionId,
        message: data.message,
        buttons: data.buttons || [],
        offer: data.offer,
        requestId: data.requestId, // Передаем requestId для SSE
      });
    } catch (error) {
      console.error('Ошибка отправки сообщения:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Внутренняя ошибка сервера',
      });
    }
  });

  app.get('/api/chat/status/:requestId', async (req, res) => {
    try {
      const { requestId } = req.params;
      const apiKey = AI_PLANNER_API_KEY;

      if (!requestId) {
        return res.status(400).json({
          error: 'Параметр requestId обязателен',
        });
      }

      // Используем встроенный http/https модуль для проксирования SSE
      const url = new URL(`${AI_PLANNER_URL}/api/chat/status/${encodeURIComponent(requestId)}`);

      const isHttps = url.protocol === 'https:';
      const httpModule = isHttps ? await import('https') : await import('http');

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      };

      // Настраиваем SSE заголовки на ответ
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      // Создаем проксирующий запрос
      let clientClosed = false;
      const proxyReq = httpModule.request(options, (proxyRes) => {
        res.flushHeaders?.();

        // Проксируем поток данных
        proxyRes.on('data', (chunk) => {
          if (!res.writableEnded) {
            res.write(chunk);
          }
        });

        proxyRes.on('end', () => {
          if (!res.writableEnded) {
            res.end();
          }
        });

        proxyRes.on('error', (error) => {
          if (!clientClosed && !isExpectedSseAbort(error)) {
            console.error('Ошибка проксирования SSE:', error);
          }
          if (!res.writableEnded) {
            res.end();
          }
        });
      });

      proxyReq.on('error', (error) => {
        if (clientClosed || isExpectedSseAbort(error)) {
          return;
        }
        console.error('Ошибка запроса SSE:', error);
        if (!res.headersSent && !res.writableEnded) {
          res.status(500).json({
            error: 'Ошибка подключения к AI Planner',
          });
          return;
        }
        if (!res.writableEnded) {
          res.end();
        }
      });

      proxyReq.end();

      // Обработка закрытия соединения клиентом
      req.on('close', () => {
        clientClosed = true;
        if (!proxyReq.destroyed) {
          proxyReq.destroy();
        }
        if (!res.writableEnded) {
          res.end();
        }
      });
    } catch (error) {
      console.error('Ошибка проксирования SSE:', error);
      if (!res.headersSent) {
        res.status(500).json({
          error: error.message || 'Внутренняя ошибка сервера',
        });
        return;
      }
      if (!res.writableEnded) {
        res.end();
      }
    }
  });
}
