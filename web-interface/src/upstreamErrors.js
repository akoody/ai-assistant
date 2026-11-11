function isExpectedSseAbort(error) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();
  return (
    code === 'ECONNRESET' ||
    code === 'ECONNABORTED' ||
    code === 'ERR_STREAM_PREMATURE_CLOSE' ||
    message.includes('aborted') ||
    message.includes('socket hang up') ||
    message.includes('premature close')
  );
}

function isGatewayTimeoutLike(status = 0, contentType = '', bodyText = '') {
  const normalizedContentType = String(contentType || '').toLowerCase();
  const normalizedBody = String(bodyText || '').toLowerCase();
  return (
    Number(status) === 504 ||
    /text\/html/.test(normalizedContentType) ||
    /gateway time-?out/.test(normalizedBody) ||
    /<html/i.test(String(bodyText || ''))
  );
}

function buildChatProxyFriendlyError(status = 0, contentType = '', bodyText = '') {
  if (isGatewayTimeoutLike(status, contentType, bodyText)) {
    return 'Сервис временно не ответил. Попробуйте ещё раз через минуту.';
  }

  if (Number(status) === 502 || Number(status) === 503) {
    return 'Сервис временно недоступен. Попробуйте ещё раз чуть позже.';
  }

  return `Сервис временно недоступен. HTTP ${status || 500}.`;
}

function sanitizeUpstreamChatErrorMessage(
  rawMessage = '',
  fallbackMessage = 'Сервис временно недоступен. Попробуйте ещё раз позже.'
) {
  const message = String(rawMessage || '').trim();
  if (!message) {
    return fallbackMessage;
  }

  if (
    /gateway time-?out/i.test(message) ||
    /text\/html/i.test(message) ||
    /ожидали json/i.test(message) ||
    /ai gateway ошибка/i.test(message) ||
    /\bbody:/i.test(message) ||
    /<html/i.test(message)
  ) {
    return 'Сервис временно не ответил. Попробуйте ещё раз через минуту.';
  }

  return message;
}

async function readUpstreamJsonResponse(response) {
  const contentType = response?.headers?.get?.('content-type') || '';
  const bodyText = await response.text();
  let json = null;

  try {
    json = JSON.parse(bodyText);
  } catch (_error) {
    // ignore
  }

  return { contentType, bodyText, json };
}

export {
  isExpectedSseAbort,
  buildChatProxyFriendlyError,
  sanitizeUpstreamChatErrorMessage,
  readUpstreamJsonResponse,
};
