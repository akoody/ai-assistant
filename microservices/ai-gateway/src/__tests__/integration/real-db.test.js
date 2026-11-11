import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { getCollection, closeConnection } from '../../services/database.js';

describe('Интеграционные тесты с реальной БД', () => {
  beforeAll(async () => {
    // Подключаемся к реальной БД
    // Никаких моков!
  });

  afterAll(async () => {
    // Закрываем подключение
    await closeConnection();
  });

  it('должен получить конфигурацию ai-gateway из БД', async () => {
    const collection = await getCollection('microserviceSettings');
    const config = await collection.findOne({ serviceName: 'ai-gateway' });

    expect(config).toBeDefined();
    expect(config.serviceName).toBe('ai-gateway');
    expect(config.maxConcurrentRequests).toBeGreaterThan(0);
    expect(Array.isArray(config.llms)).toBe(true);
  });

  it('должен получить список LLM из конфигурации', async () => {
    const collection = await getCollection('microserviceSettings');
    const config = await collection.findOne({ serviceName: 'ai-gateway' });

    expect(config.llms.length).toBeGreaterThan(0);

    const enabledLLMs = config.llms.filter((llm) => llm.enabled === true);
    expect(enabledLLMs.length).toBeGreaterThan(0);

    // Проверяем, что есть хотя бы одна активная LLM
    enabledLLMs.forEach((llm) => {
      expect(llm.modelId).toBeDefined();

      if (llm.provider !== 'ollama') {
        expect(llm.apiKey).toBeDefined();
      }
    });
  });
});
