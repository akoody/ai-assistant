import { getCollection } from '../database.js';

async function getLastAssistantButtons(userId, sessionId) {
  try {
    const collection = await getCollection('messages');
    const last = await collection.findOne(
      { userId, sessionId, role: 'assistant', 'metadata.buttons': { $exists: true, $ne: [] } },
      { sort: { createdAt: -1 }, projection: { 'metadata.buttons': 1 } }
    );
    const buttons = last?.metadata?.buttons;
    return Array.isArray(buttons) ? buttons : [];
  } catch (error) {
    console.warn(
      `⚠️ [${userId}][${sessionId}] Не удалось получить последние кнопки ассистента:`,
      error
    );
    return [];
  }
}

async function getLastEventsFromHistory(userId, sessionId) {
  try {
    const collection = await getCollection('messages');
    // Ищем последнее сообщение ассистента с событиями
    const message = await collection.findOne(
      {
        userId,
        sessionId,
        role: 'assistant',
        'metadata.offer.events': { $exists: true, $ne: [] },
        // offer.type="details" используется для карточки выбранного события и не должен
        // перезаписывать "последний список" событий (нужен для ссылок "1 событие", "2 событие" и т.д.).
        'metadata.offer.type': { $ne: 'details' },
      },
      { sort: { createdAt: -1 } }
    );

    if (message && message.metadata && message.metadata.offer && message.metadata.offer.events) {
      return {
        normalized: message.metadata.offer.events,
        original: message.metadata.offer.originalEvents || message.metadata.offer.events || null,
        usedPreferences: Boolean(message.metadata.offer.usedPreferences),
        popularSelectionUsed: Boolean(message.metadata.offer.popularSelectionUsed),
        type: message.metadata.offer.type || 'quick',
      };
    }
    return null;
  } catch (error) {
    console.error('Ошибка получения событий из истории:', error);
    return null;
  }
}

async function getShownEventsFromHistory(userId, sessionId) {
  try {
    const collection = await getCollection('messages');
    const cursor = collection
      .find(
        {
          userId,
          sessionId,
          role: 'assistant',
          'metadata.offer.events': { $exists: true, $ne: [] },
        },
        {
          projection: {
            'metadata.offer.events': 1,
          },
        }
      )
      .sort({ createdAt: 1 });

    const docs = await cursor.toArray();
    const events = [];

    docs.forEach((doc) => {
      const offerEvents = doc?.metadata?.offer?.events;
      if (Array.isArray(offerEvents)) {
        offerEvents.forEach((event) => {
          if (event) {
            events.push(event);
          }
        });
      }
    });

    return events;
  } catch (error) {
    console.error('Ошибка получения истории показанных событий:', error);
    return [];
  }
}

export { getLastAssistantButtons, getLastEventsFromHistory, getShownEventsFromHistory };
