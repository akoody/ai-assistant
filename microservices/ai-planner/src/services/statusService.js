/**
 * Сервис для управления статусами обработки запросов
 * Используется для отправки статусов клиенту через SSE
 */

// Хранилище статусов по requestId
const statusStore = new Map();
const closeListenerAttachedResponses = new WeakSet();

function attachCloseListener(requestId, statusData, res) {
  if (!res || typeof res.on !== 'function') {
    return;
  }

  if (closeListenerAttachedResponses.has(res)) {
    return;
  }

  closeListenerAttachedResponses.add(res);
  res.on('close', () => {
    statusData.listeners.delete(res);
    console.log(
      `🔌 [${requestId}] SSE соединение закрыто, осталось слушателей: ${statusData.listeners.size}`
    );
  });
}

/**
 * Создает новый статус для запроса
 * @param {string} requestId - Уникальный ID запроса (userId + timestamp)
 * @param {string} initialStatus - Начальный статус
 */
export function createStatus(requestId, initialStatus = 'Анализируем запрос...') {
  const existingStatusData = statusStore.get(requestId);
  if (existingStatusData) {
    existingStatusData.status = initialStatus;
    existingStatusData.timestamp = Date.now();
    return requestId;
  }

  statusStore.set(requestId, {
    status: initialStatus,
    timestamp: Date.now(),
    listeners: new Set(),
  });
  return requestId;
}

/**
 * Обновляет статус для запроса
 * @param {string} requestId - ID запроса
 * @param {string} status - Новый статус
 */
export function updateStatus(requestId, status) {
  const statusData = statusStore.get(requestId);
  if (!statusData) {
    console.warn(`⚠️ Попытка обновить статус для несуществующего requestId: ${requestId}`);
    return;
  }

  statusData.status = status;
  statusData.timestamp = Date.now();

  // Отправляем статус всем подключенным слушателям
  statusData.listeners.forEach((res) => {
    try {
      res.write(`data: ${JSON.stringify({ status, timestamp: statusData.timestamp })}\n\n`);
    } catch (error) {
      console.error('Ошибка отправки статуса через SSE:', error);
      statusData.listeners.delete(res);
    }
  });

  console.log(`📊 [${requestId}] Статус обновлен: "${status}"`);
}

/**
 * Удаляет статус и закрывает все соединения
 * @param {string} requestId - ID запроса
 */
export function removeStatus(requestId) {
  const statusData = statusStore.get(requestId);
  if (statusData) {
    // Закрываем все SSE соединения
    statusData.listeners.forEach((res) => {
      try {
        res.write(`data: ${JSON.stringify({ status: 'completed', timestamp: Date.now() })}\n\n`);
        res.end();
      } catch (error) {
        console.error('Ошибка закрытия SSE соединения:', error);
      }
    });
    statusStore.delete(requestId);
  }
}

/**
 * Добавляет слушателя для статуса (SSE соединение)
 * @param {string} requestId - ID запроса
 * @param {Object} res - Express response объект для SSE
 */
export function addStatusListener(requestId, res) {
  if (!statusStore.has(requestId)) {
    createStatus(requestId);
  }

  const statusData = statusStore.get(requestId);
  statusData.listeners.add(res);
  attachCloseListener(requestId, statusData, res);

  // Отправляем текущий статус сразу
  res.write(
    `data: ${JSON.stringify({ status: statusData.status, timestamp: statusData.timestamp })}\n\n`
  );
}

/**
 * Получает текущий статус для запроса
 * @param {string} requestId - ID запроса
 * @returns {string|null} - Текущий статус или null
 */
export function getStatus(requestId) {
  const statusData = statusStore.get(requestId);
  return statusData ? statusData.status : null;
}

/**
 * Очищает старые статусы (старше 5 минут)
 */
export function cleanupOldStatuses() {
  const now = Date.now();
  const maxAge = 5 * 60 * 1000; // 5 минут

  for (const [requestId, statusData] of statusStore.entries()) {
    if (now - statusData.timestamp > maxAge) {
      removeStatus(requestId);
      console.log(`🧹 Удален старый статус: ${requestId}`);
    }
  }
}

// Периодическая очистка старых статусов
setInterval(cleanupOldStatuses, 60 * 1000).unref(); // Каждую минуту
