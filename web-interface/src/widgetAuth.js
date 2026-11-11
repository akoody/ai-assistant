import { WIDGET_JWT_SECRET, WIDGET_TOKEN_EXPIRES_IN } from './config.js';
import jwt from 'jsonwebtoken';
import { normalizeUserId, normalizeClientId, getBearerToken } from './identifiers.js';

function isWidgetAuthConfigured() {
  return Boolean(String(WIDGET_JWT_SECRET || '').trim());
}

function createWidgetAccessToken({ userId, clientId = null }) {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) {
    throw new Error('Невозможно выпустить токен виджета без userId');
  }
  if (!isWidgetAuthConfigured()) {
    throw new Error('Авторизация виджета не настроена');
  }

  return jwt.sign(
    {
      scope: 'widget-user',
      userId: normalizedUserId,
      clientId: normalizeClientId(clientId),
    },
    WIDGET_JWT_SECRET,
    { expiresIn: WIDGET_TOKEN_EXPIRES_IN }
  );
}

function buildWidgetAuthResponse(userId, clientId = null) {
  return {
    widgetToken: createWidgetAccessToken({ userId, clientId }),
    tokenType: 'Bearer',
    tokenExpiresIn: WIDGET_TOKEN_EXPIRES_IN,
  };
}

function verifyWidgetTokenFromRequest(req) {
  const token = getBearerToken(req);
  if (!token) {
    return { ok: false, missing: true, status: 401, error: 'Токен виджета отсутствует' };
  }
  if (!isWidgetAuthConfigured()) {
    return { ok: false, missing: false, status: 503, error: 'Авторизация виджета не настроена' };
  }

  try {
    const payload = jwt.verify(token, WIDGET_JWT_SECRET);
    if (payload?.scope !== 'widget-user' || !normalizeUserId(payload?.userId)) {
      return { ok: false, missing: false, status: 401, error: 'Неверный токен виджета' };
    }
    return {
      ok: true,
      missing: false,
      payload: {
        ...payload,
        userId: normalizeUserId(payload.userId),
        clientId: normalizeClientId(payload.clientId),
      },
    };
  } catch {
    return { ok: false, missing: false, status: 401, error: 'Неверный или истёкший токен виджета' };
  }
}

function widgetAuth(req, res, next) {
  const authResult = verifyWidgetTokenFromRequest(req);
  if (!authResult.ok) {
    return res.status(authResult.status).json({ success: false, error: authResult.error });
  }
  req.widgetUser = authResult.payload;
  next();
}

function assertWidgetUserAccess(req, res, requestedUserId, requestedClientId = null) {
  const tokenUserId = normalizeUserId(req.widgetUser?.userId);
  const normalizedRequestedUserId = normalizeUserId(requestedUserId);
  if (!tokenUserId || (normalizedRequestedUserId && normalizedRequestedUserId !== tokenUserId)) {
    res.status(403).json({ success: false, error: 'Нет доступа к данным пользователя' });
    return false;
  }

  const tokenClientId = normalizeClientId(req.widgetUser?.clientId);
  const normalizedRequestedClientId = normalizeClientId(requestedClientId);
  if (
    normalizedRequestedClientId &&
    tokenClientId &&
    normalizedRequestedClientId !== tokenClientId
  ) {
    res.status(403).json({ success: false, error: 'Нет доступа к указанному clientId' });
    return false;
  }
  if (normalizedRequestedClientId && !tokenClientId) {
    res
      .status(403)
      .json({ success: false, error: 'Токен виджета не привязан к указанному clientId' });
    return false;
  }

  return true;
}

export {
  buildWidgetAuthResponse,
  verifyWidgetTokenFromRequest,
  widgetAuth,
  assertWidgetUserAccess,
};
