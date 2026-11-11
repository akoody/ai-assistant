import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { getCollection, closeConnection } from '../../services/database.js';

describe('Интеграционные тесты AI Slots с реальной БД', () => {
  beforeAll(async () => {
    // Подключаемся к реальной БД
    // Никаких моков!
  });

  afterAll(async () => {
    // Закрываем подключение
    await closeConnection();
  });

  it('должен получить конфигурацию ai-slots из БД', async () => {
    const collection = await getCollection('microserviceSettings');
    const config = await collection.findOne({ serviceName: 'ai-slots' });

    expect(config).toBeDefined();
    expect(config.serviceName).toBe('ai-slots');
    expect(config.maxConcurrentRequests).toBeGreaterThan(0);
    expect(config.testApiKey).toBeDefined();
    expect(config.confidenceThreshold).toBeGreaterThanOrEqual(0.3);
    expect(config.confidenceThreshold).toBeLessThanOrEqual(0.9);
    expect(config.aiGatewayUrl).toBeDefined();
    expect(config.slotExtractionPrompt).toBeDefined();
  });

  it('должен получить список слотов из БД', async () => {
    const collection = await getCollection('slots');
    const slots = await collection.find({}).toArray();

    expect(slots.length).toBeGreaterThan(0);

    // Проверяем структуру слотов
    slots.forEach((slot) => {
      expect(slot.name).toBeDefined();
      expect(slot.description).toBeDefined();
      expect(slot.type).toBeDefined();
      expect(typeof slot.name).toBe('string');
      expect(typeof slot.description).toBe('string');
    });
  });

  it('должен найти слот с типом date', async () => {
    const collection = await getCollection('slots');
    const dateSlot = await collection.findOne({ type: 'date' });

    expect(dateSlot).toBeDefined();
    expect(dateSlot.name).toBeDefined();
    expect(dateSlot.description.toLowerCase()).toContain('дата');
  });

  it('должен найти слот с типом time', async () => {
    const collection = await getCollection('slots');
    const timeSlot = await collection.findOne({ type: 'time' });

    expect(timeSlot).toBeDefined();
    expect(timeSlot.name).toBeDefined();
    expect(timeSlot.description.toLowerCase()).toContain('время');
  });

  it('должен найти слот "город"', async () => {
    const collection = await getCollection('slots');
    const citySlot = await collection.findOne({ name: 'город' });

    expect(citySlot).toBeDefined();
    expect(citySlot.name).toBe('город');
    expect(citySlot.type).toBe('location');
  });
});
