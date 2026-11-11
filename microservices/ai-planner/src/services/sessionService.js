import { getCollection } from './database.js';

/**
 * Получает или создает сессию пользователя
 * @param {string} userId - ID пользователя
 * @param {string} sessionId - ID сессии (опционально, если не указан - создается новая)
 */
export async function getOrCreateSession(userId, sessionId = null) {
  try {
    const collection = await getCollection('sessions');

    if (sessionId) {
      // Проверяем существующую сессию
      const session = await collection.findOne({ userId, sessionId });
      if (session) {
        return session;
      }
    }

    // Создаем новую сессию
    const newSessionId =
      sessionId || `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const sessionDoc = {
      userId,
      sessionId: newSessionId,
      quickOfferSent: false,
      finalOfferSent: false,
      clarificationAsked: false, // Флаг: задавались ли уточняющие вопросы для расплывчатого запроса
      offTopicContextResetPending: false,
      complaintFlow: null,
      slotsSnapshot: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await collection.insertOne(sessionDoc);
    return sessionDoc;
  } catch (error) {
    console.error('Ошибка создания/получения сессии:', error);
    throw error;
  }
}

/**
 * Обновляет флаг отправки быстрого предложения
 * @param {string} userId - ID пользователя
 * @param {string} sessionId - ID сессии
 */
export async function markQuickOfferSent(userId, sessionId) {
  try {
    const collection = await getCollection('sessions');
    await collection.updateOne(
      { userId, sessionId },
      { $set: { quickOfferSent: true, updatedAt: new Date() } }
    );
  } catch (error) {
    console.error('Ошибка обновления флага быстрого предложения:', error);
    throw error;
  }
}

/**
 * Обновляет флаг отправки финального предложения
 * @param {string} userId - ID пользователя
 * @param {string} sessionId - ID сессии
 */
export async function markFinalOfferSent(userId, sessionId) {
  try {
    const collection = await getCollection('sessions');
    await collection.updateOne(
      { userId, sessionId },
      { $set: { finalOfferSent: true, updatedAt: new Date() } }
    );
  } catch (error) {
    console.error('Ошибка обновления флага финального предложения:', error);
    throw error;
  }
}

export async function resetOfferFlags(userId, sessionId) {
  try {
    const collection = await getCollection('sessions');
    await collection.updateOne(
      { userId, sessionId },
      {
        $set: {
          quickOfferSent: false,
          finalOfferSent: false,
          clarificationAsked: false,
          updatedAt: new Date(),
        },
      }
    );
  } catch (error) {
    console.error('Ошибка сброса флагов предложений:', error);
    throw error;
  }
}

/**
 * Отмечает, что уточняющие вопросы были заданы для расплывчатого запроса
 * @param {string} userId - ID пользователя
 * @param {string} sessionId - ID сессии
 */
export async function markClarificationAsked(userId, sessionId) {
  try {
    const collection = await getCollection('sessions');
    await collection.updateOne(
      { userId, sessionId },
      { $set: { clarificationAsked: true, updatedAt: new Date() } }
    );
  } catch (error) {
    console.error('Ошибка обновления флага уточняющих вопросов:', error);
    throw error;
  }
}

export async function updateOffTopicContextResetPending(userId, sessionId, isPending) {
  try {
    const collection = await getCollection('sessions');
    await collection.updateOne(
      { userId, sessionId },
      { $set: { offTopicContextResetPending: Boolean(isPending), updatedAt: new Date() } }
    );
  } catch (error) {
    console.error('Ошибка обновления флага сброса off-topic контекста:', error);
    throw error;
  }
}

/**
 * Обновляет снимок слотов для сессии
 * @param {string} userId - ID пользователя
 * @param {string} sessionId - ID сессии
 * @param {Array} slots - Массив слотов
 */
export async function updateSessionSlotsSnapshot(userId, sessionId, slots) {
  try {
    const collection = await getCollection('sessions');
    await collection.updateOne(
      { userId, sessionId },
      {
        $set: {
          slotsSnapshot: slots,
          updatedAt: new Date(),
        },
      }
    );
  } catch (error) {
    console.error('Ошибка обновления снимка слотов:', error);
    throw error;
  }
}

/**
 * сохр выбранное пользователем событие (для сценариев "детали" или "купить билеты")
 * @param {string} userId
 * @param {string} sessionId
 * @param {Object|null} event
 */
export async function updateSessionSelectedEvent(userId, sessionId, event) {
  try {
    const collection = await getCollection('sessions');
    const hasEvent = event && typeof event === 'object';

    if (!hasEvent) {
      await collection.updateOne(
        { userId, sessionId },
        { $unset: { selectedEvent: '' }, $set: { updatedAt: new Date() } }
      );
      return;
    }

    await collection.updateOne(
      { userId, sessionId },
      { $set: { selectedEvent: event, updatedAt: new Date() } }
    );
  } catch (error) {
    console.error('Ошибка обновления выбранного события:', error);
    throw error;
  }
}

export async function updateComplaintFlowState(userId, sessionId, complaintFlow) {
  try {
    const collection = await getCollection('sessions');

    if (!complaintFlow) {
      await collection.updateOne(
        { userId, sessionId },
        { $unset: { complaintFlow: '' }, $set: { updatedAt: new Date() } }
      );
      return;
    }

    await collection.updateOne(
      { userId, sessionId },
      { $set: { complaintFlow, updatedAt: new Date() } }
    );
  } catch (error) {
    console.error('Ошибка обновления complaint-flow:', error);
    throw error;
  }
}

/**
 * Проверяет, изменились ли слоты с последнего снимка
 * @param {string} userId - ID пользователя
 * @param {string} sessionId - ID сессии
 * @param {Array} currentSlots - Текущие слоты
 */
export async function hasSlotsChanged(userId, sessionId, currentSlots) {
  try {
    const collection = await getCollection('sessions');
    const session = await collection.findOne({ userId, sessionId });

    if (!session || !session.slotsSnapshot) {
      return true; // Первый раз
    }

    const oldSlots = session.slotsSnapshot || [];

    // Значимые слоты для поиска (изменение которых должно привести к перегенерации предложения)
    // Включаем все варианты названий жанров и других важных слотов
    const significantSlots = [
      'город',
      'дата_события',
      'время_события',
      'концерт_время',
      'жанр',
      'жанр_музыки',
      'предпочтения_жанры',
      'тип_события',
      'тип_мероприятия',
      'предпочтения_типы_событий',
      'название_мероприятия',
      'исполнитель',
      'поисковый_запрос',
      'бюджет',
      'цена_от',
      'цена_до',
      'возрастное_ограничение',
      'настроение', // фильтр настроения должен триггерить перегенерацию
    ];

    // Нормализуем названия слотов для сравнения (приводим к единому виду)
    const normalizeSlotName = (name) => {
      if (name === 'жанр_музыки' || name === 'предпочтения_жанры') return 'жанр';
      if (name === 'тип_мероприятия' || name === 'тип_события') return 'тип_события';
      if (name === 'время_события' || name === 'концерт_время') return 'время_события';
      return name;
    };

    // Получаем старые и новые значимые слоты с нормализацией
    const oldSignificantSlots = oldSlots
      .filter((s) => significantSlots.includes(s.name))
      .map((s) => ({ ...s, normalizedName: normalizeSlotName(s.name) }));
    const currentSignificantSlots = currentSlots
      .filter((s) => significantSlots.includes(s.name))
      .map((s) => ({ ...s, normalizedName: normalizeSlotName(s.name) }));

    // Сравниваем количество значимых слотов
    if (oldSignificantSlots.length !== currentSignificantSlots.length) {
      return true;
    }

    // Сравниваем по нормализованным названиям
    const oldSlotNames = new Set(oldSignificantSlots.map((s) => s.normalizedName));
    const currentSlotNames = new Set(currentSignificantSlots.map((s) => s.normalizedName));

    if (oldSlotNames.size !== currentSlotNames.size) {
      console.log(
        `🔍 [${userId}][${sessionId}] Количество значимых слотов изменилось: ${oldSlotNames.size} -> ${currentSlotNames.size}`
      );
      return true;
    }

    // Проверяем, изменились ли значения существующих значимых слотов (по нормализованным названиям)
    for (const currentSlot of currentSignificantSlots) {
      const oldSlot = oldSignificantSlots.find(
        (s) => s.normalizedName === currentSlot.normalizedName
      );
      if (!oldSlot) {
        console.log(
          `🔍 [${userId}][${sessionId}] Добавлен новый значимый слот: ${currentSlot.name} (${currentSlot.normalizedName})`
        );
        return true;
      }
      if (oldSlot.value !== currentSlot.value) {
        console.log(
          `🔍 [${userId}][${sessionId}] Значение слота изменилось: ${currentSlot.name} = "${oldSlot.value}" -> "${currentSlot.value}"`
        );
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error('Ошибка проверки изменения слотов:', error);
    return true; // В случае ошибки считаем, что изменились
  }
}
