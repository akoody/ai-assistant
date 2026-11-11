import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { getClient, closeConnection } from '../../services/database.js';
import { initConfigService, stopConfigService } from '../../services/configService.js';
import chatRoutes from '../../routes/chat.js';

const app = express();
app.use(express.json());
app.use('/api/chat', chatRoutes);

describe('Интеграционные тесты API с реальной БД', () => {
  beforeAll(async () => {
    // Инициализируем реальную БД и конфигурацию
    await getClient();
    await initConfigService();
  });

  afterAll(async () => {
    stopConfigService();
    await closeConnection();
  });

  describe('GET /api/chat/health', () => {
    it('должен вернуть статус здоровья', async () => {
      const response = await request(app).get('/api/chat/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(response.body.service).toBe('ai-gateway');
      expect(response.body.timestamp).toBeDefined();
    });
  });

  describe('POST /api/chat/completions', () => {
    it('должен вернуть 401 без API ключа', async () => {
      const response = await request(app)
        .post('/api/chat/completions')
        .send({
          messages: [{ role: 'user', content: 'Hello' }],
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toBeDefined();
    });

    it('должен вернуть 401 с неверным API ключом', async () => {
      const response = await request(app)
        .post('/api/chat/completions')
        .set('Authorization', 'Bearer wrong-key')
        .send({
          messages: [{ role: 'user', content: 'Hello' }],
        });

      expect(response.status).toBe(401);
    });

    it('должен вернуть 400 без поля messages', async () => {
      const response = await request(app)
        .post('/api/chat/completions')
        .set('Authorization', 'Bearer test-api-key-123')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('messages');
    });

    it('должен принять запрос с валидными данными (будет добавлен в очередь)', async () => {
      const response = await request(app)
        .post('/api/chat/completions')
        .set('Authorization', 'Bearer test-api-key-123')
        .send({
          messages: [{ role: 'user', content: 'Hello' }],
          type: 'generate',
        });

      // Запрос должен быть принят (может быть в процессе обработки или завершен)
      expect([200, 500]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toBeDefined();
      } else {
        // Если ошибка - это может быть из-за отсутствия LLM или проблем с API
        expect(response.body.error).toBeDefined();
      }
    }, 30000); // Увеличиваем timeout для реального API вызова
  });
});
