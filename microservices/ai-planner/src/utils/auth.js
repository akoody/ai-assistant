import { getTestApiKey } from '../services/configService.js';

export function validateApiKey(apiKey) {
  if (!apiKey) {
    return false;
  }

  // Убираем префикс Bearer если есть
  const cleanKey = apiKey.replace(/^Bearer\s+/i, '').trim();
  const testKey = getTestApiKey();

  return cleanKey === testKey;
}

export function authMiddleware(req, res, next) {
  // Для SSE endpoint ключ может быть в query параметре (EventSource не поддерживает кастомные заголовки)
  const apiKey = req.headers.authorization || req.headers['x-api-key'] || req.query?.apiKey;

  if (!validateApiKey(apiKey)) {
    return res.status(401).json({
      error: 'Неверный или отсутствующий API ключ',
    });
  }

  next();
}
