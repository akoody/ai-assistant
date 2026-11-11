import { getCollection } from './database.js';
import { savePreference, PREFERENCE_TYPES } from './userPreferencesService.js';
import { findMentionedEvents } from './eventMentionMatching.js';

/**
 * Сервис для обработки фидбека пользователя о событиях
 * Распознаёт позитивные отзывы и автоматически сохраняет предпочтения
 */

/**
 * Паттерны для распознавания позитивного фидбека
 */
const POSITIVE_FEEDBACK_PATTERNS = [
  // Прямые высказывания о том, что понравилось
  /понравил(ся|ось|ись|ась)/i,
  /(?:мне|нам)\s+(?:это|такое|вот\s+это)?\s*нрав/i,
  /(?:мне|нам)\s+зашл/i,
  /(?:мне|нам)\s+по\s+душе/i,
  /класс(но)?!?$/i,
  /круто!?$/i,
  /супер!?$/i,
  /отлично!?$/i,
  /прекрасно!?$/i,
  /замечательно!?$/i,
  /восхитительно!?$/i,
  /великолепно!?$/i,
  /потрясающе!?$/i,
  /шикарно!?$/i,

  // Фразы с упоминанием удовольствия
  /получил\s+(огромное\s+)?удовольствие/i,
  /было\s+(очень\s+)?здорово/i,
  /было\s+(очень\s+)?весело/i,
  /было\s+(очень\s+)?интересно/i,
  /было\s+(очень\s+)?круто/i,
  /был\s+восхищён/i,
  /была\s+восхищена/i,
  /были\s+восхищены/i,

  // Фразы с желанием повторить
  /хочу\s+(ещё|еще)\s+(раз\s+)?((по)?смотреть|сходить|посетить)/i,
  /хотел\s+бы\s+((по)?смотреть|сходить|посетить)\s+(ещё|еще)/i,
  /с\s+удовольствием\s+((по)?смотр(ю|ел|ела)|схож(у|ёл|ла))/i,
  /с\s+радостью\s+((по)?смотр(ю|ел|ела)|схож(у|ёл|ла))/i,

  // Фразы о впечатлении
  /произвёл\s+впечатление/i,
  /произвело\s+впечатление/i,
  /очень\s+впечатлил/i,
  /в\s+восторге/i,
  /под\s+впечатлением/i,

  // Рекомендации
  /рекомендую/i,
  /советую/i,
  /стоит\s+(посмотреть|сходить|посетить)/i,

  // Оценки
  /на\s+\d{1,2}\s+из\s+10/i, // будет проверяться отдельно на высокую оценку
];

const NEGATIVE_FEEDBACK_PATTERNS = [
  /не\s+понрав/i,
  /не\s+нрав/i,
  /не\s+заш[её]л/i,
  /не\s+подош/i,
  /не\s+устро/i,
  /не\s+то(?![A-Za-zА-Яа-яЁё0-9_])/i,
  /разочаров/i,
  /ужасн/i,
  /отврат/i,
  /кошмар/i,
  /мимо(?![A-Za-zА-Яа-яЁё0-9_])/i,
];

/**
 * Паттерны для извлечения упоминания событий в сообщении
 */
const EVENT_REFERENCE_PATTERNS = [
  // Прямое упоминание концерта/мероприятия
  /концерт\s+([\w\s\-«»""]+)/i,
  /на\s+концерте\s+([\w\s\-«»""]+)/i,
  /выступлени[еия]\s+([\w\s\-«»""]+)/i,
  /спектакл[еья]\s+[«""]?([\w\s\-]+)[»""]?/i,
  /выставк[еуи]\s+[«""]?([\w\s\-]+)[»""]?/i,
  /фестивал[еья]\s+[«""]?([\w\s\-]+)[»""]?/i,
  /шоу\s+[«""]?([\w\s\-]+)[»""]?/i,

  // Упоминание исполнителя/группы
  /у\s+([\w\s\-]+)/i,
  /группы\s+([\w\s\-]+)/i,
  /исполнител[яь]\s+([\w\s\-]+)/i,
  /артист[ао]в?\s+([\w\s\-]+)/i,

  // Общие паттерны для названий в кавычках
  /[«""]([^»""]+)[»""]/,
];

/**
 * Типы событий и их синонимы для классификации
 */
const EVENT_TYPE_KEYWORDS = {
  концерты: [
    'концерт',
    'выступление',
    'музыка',
    'группа',
    'исполнитель',
    'артист',
    'певец',
    'певица',
    'музыкант',
  ],
  театры: [
    'спектакль',
    'постановка',
    'театр',
    'пьеса',
    'представление',
    'опера',
    'балет',
    'мюзикл',
  ],
  стэндап: ['стэндап', 'стендап', 'комик', 'юморист', 'юмор', 'комедия', 'stand-up', 'standup'],
  выставки: ['выставка', 'экспозиция', 'галерея'],
  фестивали: ['фестиваль'],
  кино: ['фильм', 'кино', 'кинотеатр', 'премьера'],
  шоу: ['шоу'],
};

/**
 * Географические маркеры для извлечения города
 */
const CITY_PATTERNS = [
  /в\s+([А-ЯЁ][а-яё\-]+(?:\s+[А-ЯЁ][а-яё\-]+)?)/,
  /город[ае]\s+([А-ЯЁ][а-яё\-]+(?:\s+[А-ЯЁ][а-яё\-]+)?)/,
];

/**
 * Жанры музыки для автоматического распознавания
 */
const KNOWN_GENRES = [
  'рок',
  'поп',
  'джаз',
  'классика',
  'классическая музыка',
  'электронная музыка',
  'хип-хоп',
  'рэп',
  'панк',
  'метал',
  'инди',
  'альтернатива',
  'регги',
  'блюз',
  'кантри',
  'фолк',
  'шансон',
  'авторская песня',
  'русский рок',
  'эстрада',
  'ретро',
  'диско',
  'фанк',
  'соул',
  'r&b',
  'опера',
  'балет',
  'мюзикл',
  'драма',
  'комедия',
  'мелодрама',
  'трагикомедия',
];

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Проверяет, содержит ли сообщение позитивный фидбек
 * @param {string} message - Текст сообщения
 * @returns {boolean}
 */
export function hasPositiveFeedback(message) {
  if (!message || typeof message !== 'string') {
    return false;
  }

  if (hasNegativeFeedback(message)) {
    return false;
  }

  // Проверяем паттерны позитивного фидбека
  const hasPositivePattern = POSITIVE_FEEDBACK_PATTERNS.some((pattern) => pattern.test(message));

  // Проверяем оценки (8-10 из 10 считаем позитивными)
  const ratingMatch = message.match(/(\d{1,2})\s+из\s+10/i);
  const hasHighRating = ratingMatch !== null && Number.parseInt(ratingMatch[1], 10) >= 8;

  return hasPositivePattern || hasHighRating;
}

export function hasNegativeFeedback(message) {
  if (!message || typeof message !== 'string') {
    return false;
  }

  return NEGATIVE_FEEDBACK_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Извлекает упоминание события из сообщения
 * @param {string} message - Текст сообщения
 * @returns {string|null} - Название события или null
 */
function extractEventMention(message) {
  if (!message || typeof message !== 'string') {
    return null;
  }

  for (const pattern of EVENT_REFERENCE_PATTERNS) {
    const match = message.match(pattern);
    if (match && match[1]) {
      // Очищаем от кавычек и лишних пробелов
      return match[1].replace(/[«»""]/g, '').trim();
    }
  }

  return null;
}

/**
 * Определяет тип события по ключевым словам в сообщении
 * @param {string} message - Текст сообщения
 * @returns {string|null} - Тип события или null
 */
function detectEventType(message) {
  if (!message || typeof message !== 'string') {
    return null;
  }

  const messageLower = normalizeText(message);

  for (const [eventType, keywords] of Object.entries(EVENT_TYPE_KEYWORDS)) {
    if (keywords.some((keyword) => messageLower.includes(keyword))) {
      return eventType;
    }
  }

  return null;
}

/**
 * Извлекает жанр музыки из сообщения
 * @param {string} message - Текст сообщения
 * @returns {string|null} - Жанр или null
 */
function extractGenre(message) {
  if (!message || typeof message !== 'string') {
    return null;
  }

  const messageLower = normalizeText(message);

  for (const genre of KNOWN_GENRES) {
    if (messageLower.includes(genre)) {
      return genre;
    }
  }

  return null;
}

/**
 * Извлекает упоминание города из сообщения
 * @param {string} message - Текст сообщения
 * @returns {string|null} - Город или null
 */
function extractCity(message) {
  if (!message || typeof message !== 'string') {
    return null;
  }

  for (const pattern of CITY_PATTERNS) {
    const match = message.match(pattern);
    if (match && match[1]) {
      const city = match[1].trim();
      // Проверяем, что это не служебное слово
      if (city.length > 2 && !['Том', 'Раз', 'Два'].includes(city)) {
        return city;
      }
    }
  }

  return null;
}

/**
 * Получает последние показанные события из истории
 * @param {string} userId - ID пользователя
 * @param {string} sessionId - ID сессии
 * @returns {Promise<Array>} - Массив событий
 */
async function getRecentEventsFromHistory(userId, sessionId) {
  try {
    const collection = await getCollection('messages');
    const message = await collection.findOne(
      {
        userId,
        sessionId,
        role: 'assistant',
        'metadata.offer.events': { $exists: true, $ne: [] },
      },
      { sort: { createdAt: -1 } }
    );

    const events = message?.metadata?.offer?.events;
    return Array.isArray(events) ? events : [];
  } catch (error) {
    console.error('[feedbackService] Ошибка при получении событий из истории:', error);
    return [];
  }
}

async function getRecentSessionMessages(userId, sessionId, limit = 12) {
  try {
    const collection = await getCollection('messages');
    const messages = await collection
      .find({ userId, sessionId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    return Array.isArray(messages) ? messages : [];
  } catch (error) {
    console.error('[feedbackService] Ошибка при получении сообщений сессии:', error);
    return [];
  }
}

function getPreviousUserQuery(messages = [], currentUserMessage = '') {
  const normalizedCurrent = normalizeText(currentUserMessage);
  return (
    (Array.isArray(messages) ? messages : []).find((message) => {
      if (message?.role !== 'user' || typeof message?.message !== 'string') {
        return false;
      }

      const normalizedMessage = normalizeText(message.message);
      return normalizedMessage && normalizedMessage !== normalizedCurrent;
    })?.message || null
  );
}

function extractPositiveFeedbackDetails(
  slotExtractionResult = null,
  positiveFeedbackIntent = null
) {
  const detailsFromIntent =
    positiveFeedbackIntent && typeof positiveFeedbackIntent === 'object'
      ? positiveFeedbackIntent.eventDetails || positiveFeedbackIntent.details || null
      : null;

  const detailsFromSlot = Array.isArray(slotExtractionResult?.slots)
    ? slotExtractionResult.slots.find((slot) => slot && slot.name === 'positive_feedback')
        ?.eventDetails
    : null;

  const details = detailsFromIntent || detailsFromSlot || null;
  if (!details || typeof details !== 'object') {
    return null;
  }

  return {
    eventName: typeof details.eventName === 'string' ? details.eventName.trim() : null,
    eventType: typeof details.eventType === 'string' ? details.eventType.trim() : null,
    genre: typeof details.genre === 'string' ? details.genre.trim() : null,
  };
}

export function inferFeedbackPreferencesFromContext({
  userMessage = '',
  previousUserQuery = '',
  slotExtractionResult = null,
  positiveFeedbackIntent = null,
} = {}) {
  const details = extractPositiveFeedbackDetails(slotExtractionResult, positiveFeedbackIntent);

  const explicitEventType = detectEventType(userMessage);
  const explicitGenre = extractGenre(userMessage);
  if (
    details?.eventName ||
    details?.eventType ||
    details?.genre ||
    explicitEventType ||
    explicitGenre
  ) {
    return {
      eventMention: details?.eventName || extractEventMention(userMessage),
      eventType: details?.eventType || explicitEventType || null,
      genre: details?.genre || explicitGenre || null,
    };
  }

  const fallbackQuery = String(previousUserQuery || '').trim();
  return {
    eventMention: null,
    eventType: fallbackQuery ? detectEventType(fallbackQuery) : null,
    genre: fallbackQuery ? extractGenre(fallbackQuery) : null,
  };
}

/**
 * Сопоставляет упоминание события с реальным событием из истории
 * @param {string} mention - Упоминание события
 * @param {Array} events - События из истории
 * @returns {Object|null} - Найденное событие или null
 */
function matchEventByMention(mention, events) {
  if (!mention || !Array.isArray(events) || events.length === 0) {
    return null;
  }

  const mentionLower = mention.toLowerCase();

  // Пытаемся найти событие по названию
  for (const event of events) {
    if (!event || !event.title) continue;

    const titleLower = event.title.toLowerCase();

    // Точное совпадение
    if (titleLower === mentionLower) {
      return event;
    }

    // Частичное совпадение (упоминание содержится в названии или наоборот)
    if (titleLower.includes(mentionLower) || mentionLower.includes(titleLower)) {
      return event;
    }

    // Совпадение по словам (если совпадает 70% слов)
    const mentionWords = mentionLower.split(/\s+/).filter((w) => w.length > 2);
    const titleWords = titleLower.split(/\s+/).filter((w) => w.length > 2);

    if (mentionWords.length > 0 && titleWords.length > 0) {
      const matchingWords = mentionWords.filter((word) =>
        titleWords.some((titleWord) => titleWord.includes(word) || word.includes(titleWord))
      );

      const matchRatio = matchingWords.length / Math.min(mentionWords.length, titleWords.length);
      if (matchRatio >= 0.7) {
        return event;
      }
    }
  }

  return null;
}

function appendSavedPreference(result, type, value) {
  if (!result || !type || value === undefined || value === null || value === '') {
    return;
  }

  const alreadyExists = Array.isArray(result.savedPreferences)
    ? result.savedPreferences.some(
        (item) => item && item.type === type && JSON.stringify(item.value) === JSON.stringify(value)
      )
    : false;

  if (!alreadyExists) {
    result.savedPreferences.push({ type, value });
  }
}

/**
 * Анализирует фидбек и сохраняет предпочтения
 * @param {string} userId - ID пользователя
 * @param {string} sessionId - ID сессии
 * @param {string} userMessage - Сообщение пользователя
 * @returns {Promise<Object>} - Результат анализа
 */
export async function analyzeFeedbackAndSavePreferences(
  userId,
  sessionId,
  userMessage,
  options = {}
) {
  try {
    if (!userMessage || typeof userMessage !== 'string') {
      return { feedbackDetected: false };
    }

    // Проверяем, есть ли позитивный фидбек
    const isPositive = Boolean(options?.forcePositive) || hasPositiveFeedback(userMessage);

    if (!isPositive) {
      return { feedbackDetected: false };
    }

    console.log(
      `💚 [feedbackService] Обнаружен позитивный фидбек от ${userId} в сессии ${sessionId}`
    );

    const result = {
      feedbackDetected: true,
      savedPreferences: [],
    };

    // Получаем последние показанные события
    const recentEvents = await getRecentEventsFromHistory(userId, sessionId);
    const recentMessages = await getRecentSessionMessages(userId, sessionId);
    const previousUserQuery = getPreviousUserQuery(recentMessages, userMessage);

    // Извлекаем информацию из сообщения и ближайшего контекста
    const inferredContext = inferFeedbackPreferencesFromContext({
      userMessage,
      previousUserQuery,
      slotExtractionResult: options?.slotExtractionResult || null,
      positiveFeedbackIntent: options?.positiveFeedbackIntent || null,
    });
    const eventMention = inferredContext.eventMention;
    const eventType = inferredContext.eventType;
    const genre = inferredContext.genre;
    const city = extractCity(userMessage);

    if (previousUserQuery && (eventType || genre)) {
      console.log(
        `🧭 [feedbackService] Восстанавливаю предпочтения из предыдущего запроса: "${previousUserQuery}"`
      );
    }

    // Если есть упоминание события, пытаемся найти его в истории
    const matchedEvents =
      recentEvents.length > 0
        ? findMentionedEvents(recentEvents, userMessage, options?.slotExtractionResult || null)
        : [];

    if (matchedEvents.length === 0 && eventMention && recentEvents.length > 0) {
      const singleMatchedEvent = matchEventByMention(eventMention, recentEvents);
      if (singleMatchedEvent) {
        matchedEvents.push(singleMatchedEvent);
      }
    }

    if (matchedEvents.length > 0) {
      console.log(
        `🎯 [feedbackService] Сопоставлены события: ${matchedEvents.map((event) => `"${event.title}"`).join(', ')}`
      );

      for (const matchedEvent of matchedEvents) {
        if (!matchedEvent) continue;

        if (matchedEvent.category) {
          await savePreference(userId, PREFERENCE_TYPES.EVENT_TYPE, matchedEvent.category);
          appendSavedPreference(result, 'event_type', matchedEvent.category);
        }

        if (matchedEvent.genre) {
          await savePreference(userId, PREFERENCE_TYPES.GENRE, matchedEvent.genre);
          appendSavedPreference(result, 'genre', matchedEvent.genre);
        }

        if (matchedEvent.artist || matchedEvent.performer) {
          const artist = matchedEvent.artist || matchedEvent.performer;
          await savePreference(userId, PREFERENCE_TYPES.ARTIST, artist);
          appendSavedPreference(result, 'artist', artist);
        }
      }
    }

    // Если событие не сопоставлено, используем извлечённую информацию из текста
    if (matchedEvents.length === 0) {
      // Сохраняем тип события
      if (eventType) {
        await savePreference(userId, PREFERENCE_TYPES.EVENT_TYPE, eventType);
        appendSavedPreference(result, 'event_type', eventType);
        console.log(`📌 [feedbackService] Сохранен тип события: ${eventType}`);
      }

      // Сохраняем жанр
      if (genre) {
        await savePreference(userId, PREFERENCE_TYPES.GENRE, genre);
        appendSavedPreference(result, 'genre', genre);
        console.log(`📌 [feedbackService] Сохранен жанр: ${genre}`);
      }

      // Если упоминание события есть, но не сопоставлено, сохраняем как артиста (возможно, это группа/исполнитель)
      if (eventMention && eventType === 'концерты') {
        await savePreference(userId, PREFERENCE_TYPES.ARTIST, eventMention);
        appendSavedPreference(result, 'artist', eventMention);
        console.log(`📌 [feedbackService] Сохранен артист: ${eventMention}`);
      }
    }

    // Сохраняем город, если упомянут
    if (city) {
      await savePreference(userId, PREFERENCE_TYPES.CITY, city);
      appendSavedPreference(result, 'city', city);
      console.log(`📌 [feedbackService] Сохранен город: ${city}`);
    }

    if (result.savedPreferences.length > 0) {
      console.log(
        `✅ [feedbackService] Сохранено ${result.savedPreferences.length} предпочтений на основе фидбека`
      );
    } else {
      console.log(`ℹ️ [feedbackService] Позитивный фидбек обнаружен, но предпочтения не извлечены`);
    }

    return result;
  } catch (error) {
    console.error('[feedbackService] Ошибка при анализе фидбека:', error);
    return { feedbackDetected: false, error: error.message };
  }
}

export { findMentionedEvents as findMentionedFeedbackEvents };
