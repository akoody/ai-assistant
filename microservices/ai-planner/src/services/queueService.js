import { getMaxConcurrentRequests } from './configService.js';

class RequestQueue {
  constructor() {
    this.queue = [];
    this.processing = 0;
    this.maxConcurrent = getMaxConcurrentRequests();
  }

  /**
   * Добавляет запрос в очередь
   * @param {Function} requestFunction - Функция для выполнения запроса
   * @returns {Promise} Промис с результатом выполнения
   */
  async enqueue(requestFunction) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        requestFunction,
        resolve,
        reject,
      });

      this.process();
    });
  }

  /**
   * Обрабатывает очередь
   */
  async process() {
    // Обновляем лимит из конфигурации
    this.maxConcurrent = getMaxConcurrentRequests();

    if (this.processing >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const { requestFunction, resolve, reject } = this.queue.shift();
    this.processing++;

    try {
      const result = await requestFunction();
      this.processing--;
      resolve(result);
      this.process();
    } catch (error) {
      this.processing--;
      reject(error);
      this.process();
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

const requestQueue = new RequestQueue();

export function queueRequest(requestFunction) {
  return requestQueue.enqueue(requestFunction);
}

export function getQueueStats() {
  return requestQueue.getStats();
}
