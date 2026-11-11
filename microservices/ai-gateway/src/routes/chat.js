import express from 'express';
import { authMiddleware } from '../utils/auth.js';
import { queueRequest } from '../services/queueService.js';

const router = express.Router();

router.post('/completions', authMiddleware, async (req, res) => {
  try {
    const { messages, type, max_tokens, temperature, stream, no_cache, cache_ttl } = req.body;

    // Базовая валидация массива сообщений и содержимого
    const allowedRoles = new Set(['system', 'user', 'assistant', 'tool', 'function']);

    const isMessageValid = (msg) =>
      msg &&
      typeof msg === 'object' &&
      typeof msg.role === 'string' &&
      allowedRoles.has(msg.role) &&
      typeof msg.content === 'string' &&
      msg.content.trim().length > 0;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({
        error: 'Поле messages обязательно и должно быть массивом',
      });
    }

    if (messages.some((msg) => !isMessageValid(msg))) {
      return res.status(400).json({
        error:
          'Каждое сообщение должно содержать role (system|user|assistant|tool|function) и непустой content',
      });
    }

    const requestData = {
      messages,
      type,
      max_tokens,
      temperature,
      stream,
      no_cache: no_cache === true,
    };

    if (Number.isFinite(cache_ttl) && cache_ttl > 0) {
      requestData.cache_ttl = cache_ttl;
    }

    const result = await queueRequest(requestData);

    res.json(result);
  } catch (error) {
    console.error('Ошибка обработки запроса:', error);
    const status = error.statusCode && Number.isInteger(error.statusCode) ? error.statusCode : 500;
    res.status(status).json({
      error: error.message || 'Внутренняя ошибка сервера',
      details: error.rawBody || undefined,
    });
  }
});

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ai-gateway',
    timestamp: new Date().toISOString(),
  });
});

export default router;
