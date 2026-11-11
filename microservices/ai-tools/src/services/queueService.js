import crypto from 'node:crypto';
import { getMaxConcurrentRequests } from './configService.js';
import * as kassirApiTool from './tools/kassirApiTool.js';

class RequestQueue {
  constructor() {
    this.queue = [];
    this.processing = 0;
    this.maxConcurrent = getMaxConcurrentRequests();
  }

  /**
   * Добавляет запрос в очередь
   */
  async addRequest(requestData) {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const request = {
        id: requestId,
        data: requestData,
        resolve,
        reject,
        timestamp: new Date(),
      };

      this.queue.push(request);
      this.process();
    });
  }

  /**
   * Обрабатывает очередь
   */
  async process() {
    // Проверяем количество активных потоков
    const currentMax = getMaxConcurrentRequests();
    if (this.maxConcurrent !== currentMax) {
      console.log(
        `[queueService] Обновлено количество потоков: ${this.maxConcurrent} -> ${currentMax}`
      );
      this.maxConcurrent = currentMax;
    }

    if (this.processing >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const request = this.queue.shift();
    this.processing++;

    try {
      const result = await this.executeRequest(request.data);
      request.resolve(result);
    } catch (error) {
      request.reject(error);
    } finally {
      this.processing--;
      // Продолжаем обработку очереди
      this.process();
    }
  }

  /**
   * Выполняет запрос к инструменту
   */
  async executeRequest(requestData) {
    const { tool, operation, params } = requestData;

    switch (tool) {
      case 'kassir-api':
        return await this.executeKassirApiOperation(operation, params);

      default:
        throw new Error(`Неизвестный инструмент: ${tool}`);
    }
  }

  /**
   * Выполняет операцию API Кассир.ру
   */
  async executeKassirApiOperation(operation, params) {
    switch (operation) {
      case 'search':
        return await kassirApiTool.searchEvents(params);

      case 'filter':
        return await kassirApiTool.filterEvents(params);

      case 'event':
        return await kassirApiTool.getEventById(params);

      case 'categories':
        return await kassirApiTool.getCategories(params);

      case 'category':
        return await kassirApiTool.getCategoryById(params);

      case 'rootCategories':
        return await kassirApiTool.getRootCategories(params);

      case 'compilation':
        return await kassirApiTool.getCompilation(params);

      case 'homepageCompilation':
        return await kassirApiTool.getHomepageCompilation(params);

      case 'quickSearch':
        return await kassirApiTool.quickSearch(params);

      case 'cities':
        return await kassirApiTool.getCities(params);

      case 'city':
        return await kassirApiTool.getCityBySlug(params);

      default:
        throw new Error(`Неизвестная операция API Кассир.ру: ${operation}`);
    }
  }

  /**
   * Получает статистику очереди
   */
  getStats() {
    return {
      queueLength: this.queue.length,
      processing: this.processing,
      maxConcurrent: this.maxConcurrent,
    };
  }
}

// Создаем единственный экземпляр очереди
const requestQueue = new RequestQueue();

/**
 * Добавляет запрос в очередь
 */
export function queueRequest(requestData) {
  return requestQueue.addRequest(requestData);
}

/**
 * Получает статистику очереди
 */
export function getQueueStats() {
  return requestQueue.getStats();
}
