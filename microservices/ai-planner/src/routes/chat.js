import express from 'express';
import { authMiddleware } from '../utils/auth.js';
import { queueRequest, getQueueStats } from '../services/queueService.js';
import { saveMessage, getUserMessageHistory } from '../services/messagesStorage.js';
import { generateResponse } from '../services/llmResponseService.js';
import { extractSlotsAsync, saveSlotToDatabase } from '../services/slotsService.js';
import { getOrCreateSession } from '../services/sessionService.js';
import {
  createStatus,
  updateStatus,
  removeStatus,
  addStatusListener,
} from '../services/statusService.js';
import { getCollection } from '../services/database.js';
import { isRussianCity } from '../services/offerService.js';

const router = express.Router();

function sanitizePlannerRouteErrorMessage(rawMessage = '') {
  const message = String(rawMessage || '').trim();
  if (!message) {
    return 'Внутренняя ошибка сервера';
  }

  if (
    /gateway time-?out/i.test(message) ||
    /text\/html/i.test(message) ||
    /\bbody:/i.test(message) ||
    /ai gateway ошибка/i.test(message) ||
    /ai gateway вернул некорректный json/i.test(message) ||
    /<html/i.test(message)
  ) {
    return 'Сервис временно не ответил. Попробуйте ещё раз через минуту.';
  }

  return message;
}

function findLatestCityValue(userSlots = []) {
  if (!Array.isArray(userSlots) || userSlots.length === 0) {
    return null;
  }

  for (let i = userSlots.length - 1; i >= 0; i -= 1) {
    const slot = userSlots[i];
    if (!slot) continue;
    const name = String(slot.name || '')
      .toLowerCase()
      .trim();
    if (name !== 'город' && name !== 'city') continue;
    const value = String(slot.value || '').trim();
    if (!value) continue;
    return value;
  }

  return null;
}

async function maybeApplyCityFromClientContext(userId, clientContext) {
  try {
    const city = typeof clientContext?.city === 'string' ? clientContext.city.trim() : '';
    if (!city) {
      return;
    }
    if (!isRussianCity(city)) {
      return;
    }

    const collection = await getCollection('users');
    const user = await collection.findOne({ userId }, { projection: { slots: 1 } });
    const latestCity = findLatestCityValue(user?.slots);
    if (latestCity && isRussianCity(latestCity)) {
      return;
    }

    await saveSlotToDatabase(userId, { name: 'город', value: city, confidence: 0.99 });
    console.log(`🏙️ [${userId}] Город установлен из домена: "${city}"`);
  } catch (error) {
    console.warn(`⚠️ [${userId}] Не удалось применить город из clientContext:`, error);
  }
}

async function maybeForceCityFromClientContext(userId, userMessage, clientContext) {
  try {
    const normalized = String(userMessage || '')
      .toLowerCase()
      .replace(/ё/g, 'е');
    if (!normalized) return;

    const wantsMyCity =
      normalized.includes('мой город') ||
      normalized.includes('в моем городе') ||
      normalized.includes('в своeм городе') ||
      normalized.includes('в своем городе') ||
      normalized.includes('в нашем городе') ||
      normalized.includes('у нас в городе') ||
      normalized.includes('в родном городе') ||
      normalized.includes('в моем город') ||
      normalized.includes('в своём городе') ||
      normalized.includes('в моём городе');
    if (!wantsMyCity) return;

    const city = typeof clientContext?.city === 'string' ? clientContext.city.trim() : '';
    if (!city) return;
    if (!isRussianCity(city)) return;

    await saveSlotToDatabase(userId, { name: 'город', value: city, confidence: 0.99 });
    console.log(
      `🏙️ [${userId}] Город принудительно установлен как текущий (из clientContext): "${city}"`
    );
  } catch (error) {
    console.warn(
      `⚠️ [${userId}] Не удалось принудительно применить город из clientContext:`,
      error
    );
  }
}

/**
 * GET /api/chat/history
 * Получение истории сообщений пользователя
 */
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const { userId, limit } = req.query;

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Параметр userId обязателен и должен быть строкой',
      });
    }

    const historyLimit = limit ? Number(limit) : 100;
    const parsedLimit =
      Number.isFinite(historyLimit) && historyLimit > 0 ? Math.min(historyLimit, 500) : 100;

    const messages = await getUserMessageHistory(userId, parsedLimit);

    return res.json({
      success: true,
      messages,
    });
  } catch (error) {
    console.error('Ошибка получения истории сообщений пользователя:', error);
    return res.status(500).json({
      success: false,
      error: 'Не удалось получить историю сообщений',
    });
  }
});

/**
 * POST /api/chat/message
 * Обработка сообщения пользователя
 */
router.post('/message', authMiddleware, async (req, res) => {
  // Используем requestId из запроса или создаем новый
  const requestId = req.body.requestId || `${req.body.userId}_${Date.now()}`;
  let statusCleaned = false;

  try {
    const { userId, sessionId, message, clientContext } = req.body;

    // Валидация
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({
        error: 'Поле userId обязательно и должно быть строкой',
      });
    }

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({
        error: 'Поле message обязательно и должно быть непустой строкой',
      });
    }

    await maybeApplyCityFromClientContext(userId, clientContext);
    await maybeForceCityFromClientContext(userId, message, clientContext);

    // Создаем статус для отслеживания
    createStatus(requestId, 'Анализируем запрос...');

    // Получаем или создаем сессию
    const session = await getOrCreateSession(userId, sessionId);
    const finalSessionId = session.sessionId;

    // Сохраняем сообщение пользователя в историю
    await saveMessage(userId, finalSessionId, message.trim(), 'user');

    // Обновляем статус: извлечение слотов
    updateStatus(requestId, 'Анализируем запрос...');

    // Синхронно извлекаем слоты и ждем их сохранения перед проверкой предложений
    // Это необходимо для правильной работы быстрых предложений
    const slotExtractionResult = await extractSlotsAsync(message.trim(), userId);

    // Небольшая задержка для гарантии сохранения слотов в БД
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Обрабатываем запрос через очередь
    console.log(`🔄 [${userId}][${finalSessionId}] Начало обработки запроса через очередь...`);
    updateStatus(requestId, 'Ищем мероприятия...');

    const result = await queueRequest(async () => {
      console.log(`🔄 [${userId}][${finalSessionId}] Внутри очереди, генерация ответа...`);
      // Генерируем ответ LLM (внутри generateResponse будут обновляться статусы)
      const response = await generateResponse(
        userId,
        finalSessionId,
        message.trim(),
        slotExtractionResult || undefined,
        requestId // Передаем requestId для обновления статусов
      );
      console.log(`✅ [${userId}][${finalSessionId}] generateResponse завершен`);

      const responsePreview = (response.message || '').substring(0, 100);
      console.log(`📤 [${userId}][${finalSessionId}] Ответ сгенерирован:`);
      console.log(`   - Сообщение: ${responsePreview}...`);
      console.log(`   - Кнопок: ${Array.isArray(response.buttons) ? response.buttons.length : 0}`);
      console.log(`   - Предложение: ${response.offer ? 'да' : 'нет'}`);
      if (response.offer && response.offer.events) {
        console.log(`   - Событий в предложении: ${response.offer.events.length}`);
        console.log(`   - Тип предложения: ${response.offer.type}`);
        // Логируем первые 2 события для отладки
        if (response.offer.events.length > 0) {
          console.log(
            `   - Первое событие:`,
            JSON.stringify({
              id: response.offer.events[0].id,
              title: response.offer.events[0].title,
              date: response.offer.events[0].date,
              venue: response.offer.events[0].venue,
            })
          );
        }
      } else {
        console.log(`   ⚠️ Предложение отсутствует или пустое`);
      }

      // Сохраняем ответ ассистента в историю
      console.log(`💾 [${userId}][${finalSessionId}] Сохранение ответа в историю...`);
      await saveMessage(userId, finalSessionId, response.message, 'assistant', {
        offer: response.offer,
        buttons: response.buttons || [],
      });
      console.log(`✅ [${userId}][${finalSessionId}] Ответ сохранен в историю`);

      return response;
    });
    console.log(`✅ [${userId}][${finalSessionId}] Очередь завершена, получен результат`);

    // Формируем ответ: события должны отображаться всегда, если они были сгенерированы
    // независимо от текста LLM
    const responseData = {
      success: true,
      sessionId: finalSessionId,
      message: result.message,
      buttons: Array.isArray(result.buttons) ? result.buttons : [],
    };

    // ВАЖНО: Если есть события, они ДОЛЖНЫ быть включены в ответ для отображения карточек
    if (
      result.offer &&
      result.offer.events &&
      Array.isArray(result.offer.events) &&
      result.offer.events.length > 0
    ) {
      responseData.offer = {
        events: result.offer.events,
        type: result.offer.type || 'quick',
      };
      console.log(
        `✅ [${userId}][${finalSessionId}] События включены в ответ для отображения карточек`
      );
    } else {
      console.log(`⚠️ [${userId}][${finalSessionId}] События отсутствуют в результате`);
    }

    console.log(`📤 [${userId}][${finalSessionId}] Отправка ответа клиенту:`);
    const preview = (result.message || '').substring(0, 50);
    console.log(`   - Сообщение: ${preview}...`);
    console.log(`   - Кнопок в ответе: ${responseData.buttons.length}`);
    console.log(`   - Offer включен: ${!!responseData.offer}`);
    console.log(`   - Количество событий в ответе: ${responseData.offer?.events?.length || 0}`);
    if (responseData.offer && responseData.offer.events) {
      console.log(`   - Первые 3 события для отправки:`);
      responseData.offer.events.slice(0, 3).forEach((event, idx) => {
        console.log(`     ${idx + 1}. ${event.title || 'Без названия'} (id: ${event.id || 'нет'})`);
      });
      // Логируем полную структуру первого события для отладки
      console.log(
        `   - Структура первого события:`,
        JSON.stringify(responseData.offer.events[0], null, 2)
      );
    }

    // Логируем полный JSON ответ (первые 1000 символов)
    const jsonResponse = JSON.stringify(responseData, null, 2);
    console.log(`   - Полный JSON ответ (первые 1000 символов):`, jsonResponse.substring(0, 1000));

    // Добавляем requestId в ответ для подключения к SSE
    responseData.requestId = requestId;

    res.json(responseData);
  } catch (error) {
    console.error('Ошибка обработки сообщения:', error);
    if (!statusCleaned) {
      removeStatus(requestId);
      statusCleaned = true;
    }
    res.status(500).json({
      error: sanitizePlannerRouteErrorMessage(error.message),
    });
  } finally {
    // Удаляем статус после небольшой задержки, чтобы клиент успел получить финальный статус
    setTimeout(() => {
      if (!statusCleaned) {
        removeStatus(requestId);
        statusCleaned = true;
      }
    }, 2000);
  }
});

/**
 * GET /api/chat/queue-stats
 * Статистика очереди
 */
router.get('/queue-stats', authMiddleware, (req, res) => {
  try {
    const stats = getQueueStats();
    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error('Ошибка получения статистики:', error);
    res.status(500).json({
      error: sanitizePlannerRouteErrorMessage(error.message),
    });
  }
});

/**
 * GET /api/chat/status/:requestId
 * Server-Sent Events endpoint для получения статусов обработки
 */
router.get('/status/:requestId', authMiddleware, (req, res) => {
  const { requestId } = req.params;

  if (!requestId) {
    return res.status(400).json({
      error: 'Параметр requestId обязателен',
    });
  }

  // Настраиваем SSE заголовки
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Отключаем буферизацию в nginx

  // Добавляем слушателя для статуса
  addStatusListener(requestId, res);

  // Отправляем начальное сообщение
  res.write(`: connected\n\n`);

  // Обработка закрытия соединения
  req.on('close', () => {
    console.log(`🔌 SSE соединение закрыто для requestId: ${requestId}`);
    res.end();
  });
});

/**
 * GET /api/chat/health
 * Health check
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ai-planner',
    timestamp: new Date().toISOString(),
  });
});

export default router;
