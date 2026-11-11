import express from 'express';
import { authMiddleware } from '../utils/auth.js';
import { queueRequest, getQueueStats } from '../services/queueService.js';

const router = express.Router();

/**
 * API Кассир.ру - Поиск событий
 * POST /api/tools/kassir-api/search
 * Обязательные поля: нет (но желательно указать хотя бы один фильтр)
 */
router.post('/kassir-api/search', authMiddleware, async (req, res) => {
  try {
    const params = req.body;

    const result = await queueRequest({
      tool: 'kassir-api',
      operation: 'search',
      params,
    });

    res.json({
      success: true,
      tool: 'kassir-api',
      operation: 'search',
      data: result,
    });
  } catch (error) {
    console.error('Ошибка поиска событий:', error);
    res.status(500).json({
      error: error.message || 'Внутренняя ошибка сервера',
    });
  }
});

/**
 * API Кассир.ру - Единый LLM-фильтр кандидатов
 * POST /api/tools/kassir-api/filter-events
 * Обязательные поля: events[]
 */
router.post('/kassir-api/filter-events', authMiddleware, async (req, res) => {
  try {
    const params = req.body || {};

    const result = await queueRequest({
      tool: 'kassir-api',
      operation: 'filter',
      params,
    });

    res.json({
      success: true,
      tool: 'kassir-api',
      operation: 'filter',
      data: result,
    });
  } catch (error) {
    console.error('Ошибка единого фильтра событий:', error);
    res.status(500).json({
      error: error.message || 'Внутренняя ошибка сервера',
    });
  }
});

/**
 * API Кассир.ру - Получение события по ID (детали/описание)
 * POST /api/tools/kassir-api/event
 * Обязательные поля: id
 */
router.post('/kassir-api/event', authMiddleware, async (req, res) => {
  try {
    const { id, ...params } = req.body || {};

    if (!id) {
      return res.status(400).json({
        error: 'Поле id обязательно',
      });
    }

    const result = await queueRequest({
      tool: 'kassir-api',
      operation: 'event',
      params: { id, ...params },
    });

    res.json({
      success: true,
      tool: 'kassir-api',
      operation: 'event',
      data: result,
    });
  } catch (error) {
    console.error('Ошибка получения события:', error);
    res.status(500).json({
      error: error.message || 'Внутренняя ошибка сервера',
    });
  }
});

/**
 * API Кассир.ру - Получение категорий
 * POST /api/tools/kassir-api/categories
 * Обязательные поля: нет
 */
router.post('/kassir-api/categories', authMiddleware, async (req, res) => {
  try {
    const params = req.body || {};

    const result = await queueRequest({
      tool: 'kassir-api',
      operation: 'categories',
      params,
    });

    res.json({
      success: true,
      tool: 'kassir-api',
      operation: 'categories',
      data: result,
    });
  } catch (error) {
    console.error('Ошибка получения категорий:', error);
    res.status(500).json({
      error: error.message || 'Внутренняя ошибка сервера',
    });
  }
});

/**
 * API Кассир.ру - Получение категории по ID
 * POST /api/tools/kassir-api/category
 * Обязательные поля: id
 */
router.post('/kassir-api/category', authMiddleware, async (req, res) => {
  try {
    const { id, ...params } = req.body;

    if (!id) {
      return res.status(400).json({
        error: 'Поле id обязательно',
      });
    }

    const result = await queueRequest({
      tool: 'kassir-api',
      operation: 'category',
      params: { id, ...params },
    });

    res.json({
      success: true,
      tool: 'kassir-api',
      operation: 'category',
      data: result,
    });
  } catch (error) {
    console.error('Ошибка получения категории:', error);
    res.status(500).json({
      error: error.message || 'Внутренняя ошибка сервера',
    });
  }
});

/**
 * API Кассир.ру - Получение корневых категорий
 * POST /api/tools/kassir-api/root-categories
 * Обязательные поля: нет
 */
router.post('/kassir-api/root-categories', authMiddleware, async (req, res) => {
  try {
    const params = req.body || {};

    const result = await queueRequest({
      tool: 'kassir-api',
      operation: 'rootCategories',
      params,
    });

    res.json({
      success: true,
      tool: 'kassir-api',
      operation: 'rootCategories',
      data: result,
    });
  } catch (error) {
    console.error('Ошибка получения корневых категорий:', error);
    res.status(500).json({
      error: error.message || 'Внутренняя ошибка сервера',
    });
  }
});

/**
 * API Кассир.ру - Получение подборки
 * POST /api/tools/kassir-api/compilation
 * Обязательные поля: id
 */
router.post('/kassir-api/compilation', authMiddleware, async (req, res) => {
  try {
    const { id, ...params } = req.body;

    if (!id) {
      return res.status(400).json({
        error: 'Поле id обязательно',
      });
    }

    const result = await queueRequest({
      tool: 'kassir-api',
      operation: 'compilation',
      params: { id, ...params },
    });

    res.json({
      success: true,
      tool: 'kassir-api',
      operation: 'compilation',
      data: result,
    });
  } catch (error) {
    console.error('Ошибка получения подборки:', error);
    res.status(500).json({
      error: error.message || 'Внутренняя ошибка сервера',
    });
  }
});

/**
 * API Кассир.ру - Получение подборки для главной
 * POST /api/tools/kassir-api/homepage-compilation
 * Обязательные поля: нет (platformStateValue опционально, по умолчанию 'website')
 */
router.post('/kassir-api/homepage-compilation', authMiddleware, async (req, res) => {
  try {
    const params = req.body || {};

    const result = await queueRequest({
      tool: 'kassir-api',
      operation: 'homepageCompilation',
      params,
    });

    res.json({
      success: true,
      tool: 'kassir-api',
      operation: 'homepageCompilation',
      data: result,
    });
  } catch (error) {
    console.error('Ошибка получения подборки для главной:', error);
    res.status(500).json({
      error: error.message || 'Внутренняя ошибка сервера',
    });
  }
});

/**
 * API Кассир.ру - Быстрый поиск
 * POST /api/tools/kassir-api/quick-search
 * Обязательные поля: q
 */
router.post('/kassir-api/quick-search', authMiddleware, async (req, res) => {
  try {
    const { q, ...params } = req.body;

    if (!q || typeof q !== 'string') {
      return res.status(400).json({
        error: 'Поле q (поисковый запрос) обязательно и должно быть строкой',
      });
    }

    const result = await queueRequest({
      tool: 'kassir-api',
      operation: 'quickSearch',
      params: { q, ...params },
    });

    res.json({
      success: true,
      tool: 'kassir-api',
      operation: 'quickSearch',
      data: result,
    });
  } catch (error) {
    console.error('Ошибка быстрого поиска:', error);
    res.status(500).json({
      error: error.message || 'Внутренняя ошибка сервера',
    });
  }
});

/**
 * API Кассир.ру - Получение списка городов
 * POST /api/tools/kassir-api/cities
 * Обязательные поля: нет
 */
router.post('/kassir-api/cities', authMiddleware, async (req, res) => {
  try {
    const params = req.body || {};

    const result = await queueRequest({
      tool: 'kassir-api',
      operation: 'cities',
      params,
    });

    res.json({
      success: true,
      tool: 'kassir-api',
      operation: 'cities',
      data: result,
    });
  } catch (error) {
    console.error('Ошибка получения городов:', error);
    res.status(500).json({
      error: error.message || 'Внутренняя ошибка сервера',
    });
  }
});

/**
 * API Кассир.ру - Получение города по slug
 * POST /api/tools/kassir-api/city
 * Обязательные поля: slug
 */
router.post('/kassir-api/city', authMiddleware, async (req, res) => {
  try {
    const { slug, ...params } = req.body;

    if (!slug || typeof slug !== 'string') {
      return res.status(400).json({
        error: 'Поле slug обязательно и должно быть строкой',
      });
    }

    const result = await queueRequest({
      tool: 'kassir-api',
      operation: 'city',
      params: { slug, ...params },
    });

    res.json({
      success: true,
      tool: 'kassir-api',
      operation: 'city',
      data: result,
    });
  } catch (error) {
    console.error('Ошибка получения города:', error);
    res.status(500).json({
      error: error.message || 'Внутренняя ошибка сервера',
    });
  }
});

/**
 * Статистика очереди
 * GET /api/tools/queue-stats
 */
router.get('/queue-stats', authMiddleware, (req, res) => {
  try {
    const stats = getQueueStats();
    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error('Ошибка получения статистики очереди:', error);
    res.status(500).json({
      error: error.message || 'Внутренняя ошибка сервера',
    });
  }
});

/**
 * Health check
 * GET /api/tools/health
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ai-tools',
    timestamp: new Date().toISOString(),
  });
});

export default router;
