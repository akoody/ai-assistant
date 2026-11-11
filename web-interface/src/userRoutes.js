import { getDatabase } from './database.js';
import { normalizeUserId, normalizeClientId, pickClientId } from './identifiers.js';
import {
  buildWidgetAuthResponse,
  verifyWidgetTokenFromRequest,
  widgetAuth,
  assertWidgetUserAccess,
} from './widgetAuth.js';
import { resolveUserByClientId, upsertClientLink, createWidgetUser } from './widgetUsers.js';

export function registerUserRoutes(app) {
  app.post('/api/user/create', async (req, res) => {
    try {
      const db = await getDatabase();
      const authResult = verifyWidgetTokenFromRequest(req);
      if (!authResult.ok && !authResult.missing) {
        return res.status(authResult.status).json({ success: false, error: authResult.error });
      }
      const widgetUser = authResult.ok ? authResult.payload : null;
      const clientId = pickClientId(
        req.body?.clientId,
        req.body?.client_id,
        req.query?.clientId,
        req.query?.client_id
      );
      const forceNew = req.body?.forceNew === true || req.body?.forceNew === 'true';

      if (clientId && !forceNew) {
        const restored = await resolveUserByClientId(db, clientId);
        if (restored?.userId) {
          const tokenClientId = normalizeClientId(widgetUser?.clientId);
          const tokenUserId = normalizeUserId(widgetUser?.userId);
          if (tokenUserId !== restored.userId || tokenClientId !== clientId) {
            return res.status(401).json({
              success: false,
              error: 'Для восстановления пользователя по clientId нужен токен виджета',
            });
          }
          return res.json({
            success: true,
            restored: true,
            userId: restored.userId,
            sessionId: restored.sessionId || null,
            clientId,
            ...buildWidgetAuthResponse(restored.userId, clientId),
            message: 'Пользователь восстановлен по client_id',
          });
        }
      }

      if (clientId && forceNew) {
        const existingLink = await resolveUserByClientId(db, clientId);
        if (existingLink?.userId) {
          const tokenClientId = normalizeClientId(widgetUser?.clientId);
          const tokenUserId = normalizeUserId(widgetUser?.userId);
          if (tokenUserId !== existingLink.userId || tokenClientId !== clientId) {
            return res.status(409).json({
              success: false,
              error:
                'clientId уже привязан к пользователю. Для создания нового пользователя нужен текущий токен виджета.',
            });
          }
        }
      }

      const userId = await createWidgetUser(db);
      if (clientId) {
        await upsertClientLink(db, clientId, userId);
      }

      return res.json({
        success: true,
        restored: false,
        userId,
        sessionId: null,
        clientId: clientId || null,
        ...buildWidgetAuthResponse(userId, clientId || null),
        message: 'Пользователь создан успешно',
      });
    } catch (error) {
      console.error('Ошибка создания пользователя:', error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Внутренняя ошибка сервера',
      });
    }
  });

  app.get('/api/user/resolve', widgetAuth, async (req, res) => {
    try {
      const clientId = pickClientId(req.query?.clientId, req.query?.client_id);
      if (!clientId) {
        return res.status(400).json({
          success: false,
          error: 'Параметр clientId обязателен',
        });
      }

      if (!assertWidgetUserAccess(req, res, req.widgetUser?.userId, clientId)) {
        return;
      }

      const db = await getDatabase();
      const resolved = await resolveUserByClientId(db, clientId);
      if (!resolved?.userId) {
        return res.json({
          success: true,
          found: false,
          clientId,
        });
      }
      if (resolved.userId !== normalizeUserId(req.widgetUser?.userId)) {
        return res.status(403).json({
          success: false,
          error: 'Токен виджета не соответствует текущей привязке clientId',
        });
      }

      return res.json({
        success: true,
        found: true,
        clientId,
        userId: resolved.userId,
        sessionId: resolved.sessionId || null,
        ...buildWidgetAuthResponse(resolved.userId, clientId),
      });
    } catch (error) {
      console.error('Ошибка восстановления пользователя по client_id:', error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Внутренняя ошибка сервера',
      });
    }
  });
}
