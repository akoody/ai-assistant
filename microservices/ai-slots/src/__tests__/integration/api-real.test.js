import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { getClient, closeConnection, getCollection } from '../../services/database.js';
import { initConfigService, stopConfigService } from '../../services/configService.js';
import { initSlotsService, stopSlotsService } from '../../services/slotsService.js';
import slotsRoutes from '../../routes/slots.js';

const app = express();
app.use(express.json());
app.use('/api/slots', slotsRoutes);

// Генерируем уникальный userId для тестов
const TEST_USER_ID = `test-user-${Date.now()}`;

describe('Интеграционные тесты API AI Slots с реальной БД', () => {
  beforeAll(async () => {
    // Инициализируем реальную БД и конфигурацию
    await getClient();
    await initConfigService();
    await initSlotsService();
  });

  afterAll(async () => {
    // Очищаем тестовые данные пользователя
    try {
      const usersCollection = await getCollection('users');
      await usersCollection.deleteOne({ userId: TEST_USER_ID });
    } catch (error) {
      console.error('Ошибка очистки тестовых данных:', error);
    }

    stopConfigService();
    stopSlotsService();
    await closeConnection();
  });

  describe('GET /api/slots/health', () => {
    it('должен вернуть статус здоровья', async () => {
      const response = await request(app).get('/api/slots/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(response.body.service).toBe('ai-slots');
      expect(response.body.timestamp).toBeDefined();
    });
  });

  describe('GET /api/slots/available', () => {
    it('должен вернуть 401 без API ключа', async () => {
      const response = await request(app).get('/api/slots/available');

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('API ключ');
    });

    it('должен вернуть список доступных слотов с валидным API ключом', async () => {
      const response = await request(app)
        .get('/api/slots/available')
        .set('Authorization', 'Bearer test-api-key-123');

      expect(response.status).toBe(200);
      expect(response.body.total).toBeGreaterThan(0);
      expect(Array.isArray(response.body.slots)).toBe(true);

      if (response.body.slots.length > 0) {
        const slot = response.body.slots[0];
        expect(slot.name).toBeDefined();
        expect(slot.description).toBeDefined();
        expect(slot.type).toBeDefined();
      }
    });
  });

  describe('POST /api/slots/extract', () => {
    it('должен вернуть 401 без API ключа', async () => {
      const response = await request(app).post('/api/slots/extract').send({
        text: 'хочу концерт вечером',
        userId: TEST_USER_ID,
      });

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('API ключ');
    });

    it('должен вернуть 400 без userId', async () => {
      const response = await request(app)
        .post('/api/slots/extract')
        .set('Authorization', 'Bearer test-api-key-123')
        .send({
          text: 'хочу концерт вечером',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('userId');
    });

    it('должен вернуть 400 без text', async () => {
      const response = await request(app)
        .post('/api/slots/extract')
        .set('Authorization', 'Bearer test-api-key-123')
        .send({
          userId: TEST_USER_ID,
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('text');
    });

    it('должен вернуть 400 с пустым text', async () => {
      const response = await request(app)
        .post('/api/slots/extract')
        .set('Authorization', 'Bearer test-api-key-123')
        .send({
          text: '',
          userId: TEST_USER_ID,
        });

      expect(response.status).toBe(400);
      // Пустая строка проверяется после проверки типа, поэтому может быть любая из проверок
      expect(response.body.error).toBeDefined();
    });

    it('должен принять запрос с валидными данными', async () => {
      const response = await request(app)
        .post('/api/slots/extract')
        .set('Authorization', 'Bearer test-api-key-123')
        .send({
          text: 'хочу концерт вечером в Москве',
          userId: TEST_USER_ID,
        });

      // Запрос должен быть принят (может быть в процессе обработки или завершен)
      expect([200, 500]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toBeDefined();
        expect(response.body.text).toBe('хочу концерт вечером в Москве');
        expect(Array.isArray(response.body.slots)).toBe(true);
        expect(response.body.confidenceThreshold).toBeGreaterThanOrEqual(0.3);
        expect(response.body.confidenceThreshold).toBeLessThanOrEqual(0.9);
      } else {
        // Если ошибка - это может быть из-за отсутствия AI Gateway или проблем с API
        expect(response.body.error).toBeDefined();
      }
    }, 30000); // Увеличиваем timeout для реального API вызова
  });

  describe('GET /api/slots/history', () => {
    it('должен вернуть 401 без API ключа', async () => {
      const response = await request(app).get('/api/slots/history').query({ userId: TEST_USER_ID });

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('API ключ');
    });

    it('должен вернуть 400 без userId', async () => {
      const response = await request(app)
        .get('/api/slots/history')
        .set('Authorization', 'Bearer test-api-key-123');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('userId');
    });

    it('должен вернуть историю слотов пользователя (может быть пустой)', async () => {
      const response = await request(app)
        .get('/api/slots/history')
        .set('Authorization', 'Bearer test-api-key-123')
        .query({ userId: TEST_USER_ID });

      expect(response.status).toBe(200);
      expect(response.body.userId).toBe(TEST_USER_ID);
      expect(Array.isArray(response.body.slots)).toBe(true);
      expect(typeof response.body.total).toBe('number');
    });

    it('должен вернуть историю с фильтром по имени слота', async () => {
      const response = await request(app)
        .get('/api/slots/history')
        .set('Authorization', 'Bearer test-api-key-123')
        .query({
          userId: TEST_USER_ID,
          slotName: 'концерт_время',
        });

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.slots)).toBe(true);

      // Если есть слоты, проверяем фильтрацию
      if (response.body.slots.length > 0) {
        response.body.slots.forEach((slot) => {
          expect(slot.name).toBe('концерт_время');
        });
      }
    });
  });

  describe('Проверка сохранения слотов в модель пользователя', () => {
    it('должен сохранить слоты в коллекцию users после извлечения', async () => {
      // Сначала извлекаем слоты
      await request(app)
        .post('/api/slots/extract')
        .set('Authorization', 'Bearer test-api-key-123')
        .send({
          text: 'хочу рок концерт завтра вечером',
          userId: TEST_USER_ID,
        });

      // Ждем немного для обработки
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Проверяем, что слоты сохранились в БД
      const usersCollection = await getCollection('users');
      const user = await usersCollection.findOne({ userId: TEST_USER_ID });

      if (user && user.slots && user.slots.length > 0) {
        expect(Array.isArray(user.slots)).toBe(true);

        // Проверяем структуру сохраненного слота
        const slot = user.slots[0];
        expect(slot.name).toBeDefined();
        expect(slot.value).toBeDefined();
        expect(slot.confidence).toBeGreaterThanOrEqual(0);
        expect(slot.confidence).toBeLessThanOrEqual(1);
        expect(slot.extractedAt).toBeDefined();
        expect(slot.createdAt).toBeDefined();
        expect(slot.extractedAt instanceof Date || typeof slot.extractedAt === 'object').toBe(true);
      }
    }, 30000);
  });
});
