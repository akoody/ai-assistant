import { getDatabase } from './database.js';
import { normalizeUserId, normalizeSessionId, normalizeClientId } from './identifiers.js';
import crypto from 'crypto';

async function ensureClientLinksIndexes() {
  try {
    const db = await getDatabase();
    await Promise.all([
      db
        .collection('client_links')
        .createIndex({ clientId: 1 }, { unique: true, name: 'client_id_unique_idx' }),
      db.collection('client_links').createIndex({ userId: 1 }, { name: 'client_link_user_idx' }),
    ]);
  } catch (error) {
    throw new Error('Ошибка создания индексов client_links', { cause: error });
  }
}

async function findLatestSessionId(db, userId) {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return null;

  try {
    const latestSession = await db
      .collection('sessions')
      .find({ userId: normalizedUserId, sessionId: { $nin: [null, ''] } })
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(1)
      .next();
    const fromSessions = normalizeSessionId(latestSession?.sessionId);
    if (fromSessions) {
      return fromSessions;
    }
  } catch (error) {
    console.warn('Не удалось получить последнюю сессию из sessions:', error?.message || error);
  }

  try {
    const latestMessage = await db
      .collection('messages')
      .find({ userId: normalizedUserId, sessionId: { $nin: [null, ''] } })
      .sort({ timestamp: -1, createdAt: -1 })
      .limit(1)
      .next();
    const fromMessages = normalizeSessionId(latestMessage?.sessionId);
    if (fromMessages) {
      return fromMessages;
    }
  } catch (error) {
    console.warn('Не удалось получить последнюю сессию из messages:', error?.message || error);
  }

  try {
    const latestWidgetMessage = await db
      .collection('widget_messages')
      .find({ userId: normalizedUserId, sessionId: { $nin: [null, ''] } })
      .sort({ timestamp: -1, createdAt: -1 })
      .limit(1)
      .next();
    return normalizeSessionId(latestWidgetMessage?.sessionId);
  } catch (error) {
    console.warn(
      'Не удалось получить последнюю сессию из widget_messages:',
      error?.message || error
    );
    return null;
  }
}

async function resolveUserByClientId(db, clientId) {
  const normalizedClientId = normalizeClientId(clientId);
  if (!normalizedClientId) return null;

  const link = await db
    .collection('client_links')
    .findOne({ clientId: normalizedClientId }, { projection: { _id: 0, userId: 1 } });
  const linkedUserId = normalizeUserId(link?.userId);
  if (!linkedUserId) return null;

  const user = await db
    .collection('users')
    .findOne({ userId: linkedUserId }, { projection: { _id: 1, userId: 1 } });
  if (!user) return null;

  const sessionId = await findLatestSessionId(db, linkedUserId);
  return {
    clientId: normalizedClientId,
    userId: linkedUserId,
    sessionId: sessionId || null,
  };
}

async function upsertClientLink(db, clientId, userId) {
  const normalizedClientId = normalizeClientId(clientId);
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedClientId || !normalizedUserId) return;

  const now = new Date();
  await db.collection('client_links').updateOne(
    { clientId: normalizedClientId },
    {
      $set: {
        userId: normalizedUserId,
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true }
  );
}

async function createWidgetUser(db) {
  const userId = `user-${crypto.randomUUID()}`;
  const now = new Date();
  await db.collection('users').insertOne({
    userId,
    slots: [],
    createdAt: now,
    updatedAt: now,
  });
  return userId;
}

export { ensureClientLinksIndexes, resolveUserByClientId, upsertClientLink, createWidgetUser };
