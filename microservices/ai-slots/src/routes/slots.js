import express from 'express';
import { authMiddleware } from '../utils/auth.js';
import { queueRequest } from '../services/queueService.js';
import { getSlots } from '../services/slotsService.js';
import { getUserSlots } from '../services/slotsStorageService.js';

const router = express.Router();

// Извлечение слотов из текста
router.post('/extract', authMiddleware, async (req, res) => {
  try {
    const { text, userId } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({
        error: 'Поле text обязательно и должно быть строкой',
      });
    }

    if (text.trim().length === 0) {
      return res.status(400).json({
        error: 'Текст не может быть пустым',
      });
    }

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({
        error: 'Поле userId обязательно и должно быть строкой',
      });
    }

    const requestData = {
      text: text.trim(),
      userId: userId.trim(),
    };
    const result = await queueRequest(requestData);

    res.json(result);
  } catch (error) {
    console.error('Ошибка обработки запроса:', error);
    res.status(500).json({
      error: error.message || 'Внутренняя ошибка сервера',
    });
  }
});

// Получение списка доступных слотов
router.get('/available', authMiddleware, (req, res) => {
  try {
    const slots = getSlots();

    const slotsInfo = slots.map((slot) => ({
      name: slot.name,
      description: slot.description,
      type: slot.type,
    }));

    res.json({
      total: slotsInfo.length,
      slots: slotsInfo,
    });
  } catch (error) {
    console.error('Ошибка получения слотов:', error);
    res.status(500).json({
      error: error.message || 'Внутренняя ошибка сервера',
    });
  }
});

// Получение истории извлеченных слотов пользователя
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const { userId, dateFrom, dateTo, slotName } = req.query;

    if (!userId) {
      return res.status(400).json({
        error: 'Параметр userId обязателен',
      });
    }

    const filters = {};
    if (dateFrom) {
      filters.dateFrom = new Date(dateFrom);
    }
    if (dateTo) {
      filters.dateTo = new Date(dateTo);
    }
    if (slotName) {
      filters.slotName = slotName;
    }

    const history = await getUserSlots(userId, filters);

    res.json({
      userId,
      total: history.length,
      slots: history,
    });
  } catch (error) {
    console.error('Ошибка получения истории:', error);
    res.status(500).json({
      error: error.message || 'Внутренняя ошибка сервера',
    });
  }
});

// Health check
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ai-slots',
    timestamp: new Date().toISOString(),
  });
});

export default router;
