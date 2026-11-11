import { getCollection } from './database.js';

/**
 * Сохраняет сообщение пользователя в историю
 * @param {string} userId - ID пользователя
 * @param {string} sessionId - ID сессии
 * @param {string} message - Текст сообщения
 * @param {string} role - Роль (user/assistant)
 * @param {Object} metadata - Дополнительные данные
 */
export async function saveMessage(userId, sessionId, message, role = 'user', metadata = {}) {
  try {
    const collection = await getCollection('messages');
    const messageDoc = {
      userId,
      sessionId,
      message,
      role,
      metadata,
      createdAt: new Date(),
    };

    const result = await collection.insertOne(messageDoc);
    return result.insertedId;
  } catch (error) {
    console.error('Ошибка сохранения сообщения:', error);
    throw error;
  }
}

/**
 * Получает историю сообщений для сессии
 * @param {string} userId - ID пользователя
 * @param {string} sessionId - ID сессии
 * @param {number} limit - Лимит сообщений
 */
export async function getMessageHistory(userId, sessionId, limit = 50) {
  try {
    const collection = await getCollection('messages');
    const messages = await collection
      .find({ userId, sessionId })
      .sort({ createdAt: 1 })
      .limit(limit)
      .toArray();

    return messages.map((msg) => ({
      role: msg.role,
      content: msg.message,
      metadata: msg.metadata || {},
    }));
  } catch (error) {
    console.error('Ошибка получения истории сообщений:', error);
    throw error;
  }
}

export async function getUserMessageHistory(userId, limit = 100) {
  try {
    const collection = await getCollection('messages');
    const messages = await collection
      .find({ userId })
      .sort({ createdAt: 1 })
      .limit(limit)
      .toArray();

    return messages.map((msg) => ({
      role: msg.role,
      content: msg.message,
      metadata: msg.metadata || {},
      sessionId: msg.sessionId,
      createdAt: msg.createdAt,
    }));
  } catch (error) {
    console.error('Ошибка получения истории пользователя:', error);
    throw error;
  }
}

/**
 * Получает последнее сообщение пользователя в сессии
 * @param {string} userId - ID пользователя
 * @param {string} sessionId - ID сессии
 */
export async function getLastUserMessage(userId, sessionId) {
  try {
    const collection = await getCollection('messages');
    const message = await collection.findOne(
      { userId, sessionId, role: 'user' },
      { sort: { createdAt: -1 } }
    );

    return message;
  } catch (error) {
    console.error('Ошибка получения последнего сообщения:', error);
    throw error;
  }
}
