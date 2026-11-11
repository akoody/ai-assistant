import { getCollection } from './database.js';
import { getCache, setCache } from './cacheService.js';
import { isRussianCity } from './offerService.js';

const CACHE_TTL = 3600; // 1 час для кеша требований к слотам

// Список слотов, которые считаются валидным пользовательским запросом
const QUERY_SLOT_CANDIDATES = [
  'тип_события',
  'тип_мероприятия',
  'жанр',
  'жанр_музыки',
  'предпочтения_жанры',
  'предпочтения_типы_событий',
  'исполнитель',
  'название_мероприятия',
  'категория',
  'настроение',
  'поисковый_запрос',
];

/**
 * Получает обязательные слоты для типа запроса
 * @param {string} requestType - Тип запроса (концерт, спектакль, выставка и т.д.)
 */
export async function getRequiredSlots(requestType = 'default') {
  try {
    const cacheKey = `required_slots:${requestType}`;
    const cached = getCache(cacheKey);
    if (cached) {
      return cached;
    }

    const collection = await getCollection('slotRequirements');
    const requirements = await collection.findOne({ requestType });

    const rawRequiredSlots = requirements?.requiredSlots || [];

    // Удаляем дату из обязательных слотов и гарантируем наличие города
    const requiredSlots = rawRequiredSlots
      .filter((slot) => slot !== 'дата_события')
      .filter(Boolean);

    if (!requiredSlots.includes('город')) {
      requiredSlots.push('город');
    }

    // Кешируем результат
    setCache(cacheKey, requiredSlots, CACHE_TTL);

    return requiredSlots;
  } catch (error) {
    console.error('Ошибка получения обязательных слотов:', error);
    // Возвращаем базовые обязательные слоты по умолчанию
    return getDefaultRequiredSlots();
  }
}

/**
 * Получает все возможные слоты для типа запроса
 * @param {string} requestType - Тип запроса
 */
export async function getAllSlots(requestType = 'default') {
  try {
    const cacheKey = `all_slots:${requestType}`;
    const cached = getCache(cacheKey);
    if (cached) {
      return cached;
    }

    const collection = await getCollection('slotRequirements');
    const requirements = await collection.findOne({ requestType });

    const allSlots = requirements?.allSlots || [];

    // Кешируем результат
    setCache(cacheKey, allSlots, CACHE_TTL);

    return allSlots;
  } catch (error) {
    console.error('Ошибка получения всех слотов:', error);
    return [];
  }
}

/**
 * Проверяет, собраны ли все обязательные слоты
 * Все названия слотов должны быть уже нормализованы через getCurrentSessionSlots
 * @param {Array} userSlots - Слоты пользователя (уже нормализованные)
 * @param {string} requestType - Тип запроса
 * @param {Object} options - Дополнительные опции проверки
 * @param {boolean} options.allowEmptyQuery - Разрешить отсутствие поискового запроса
 */
export async function areRequiredSlotsCollected(userSlots, requestType = 'default', options = {}) {
  try {
    const { allowEmptyQuery = false } = options;
    const requiredSlots = await getRequiredSlots(requestType);
    const userSlotNames = new Set(userSlots.map((slot) => slot.name));

    console.log(`🔍 Проверка обязательных слотов для типа "${requestType}":`);
    console.log(`   - Требуемые слоты: ${JSON.stringify(requiredSlots)}`);
    console.log(`   - Слоты пользователя: ${JSON.stringify(Array.from(userSlotNames))}`);

    const missingSlotsSet = new Set();

    // КРИТИЧЕСКИ ВАЖНО: Проверяем валидность города, а не только его наличие
    // Если пользователь выбрал "Другой город", слот должен быть отфильтрован, но на всякий случай проверяем валидность
    const citySlot = userSlots.find((slot) => slot && slot.name === 'город');
    const hasValidCity = citySlot && citySlot.value && isRussianCity(String(citySlot.value).trim());

    for (const requiredSlot of requiredSlots) {
      if (requiredSlot === 'город') {
        // Для города проверяем не только наличие, но и валидность
        if (!hasValidCity) {
          missingSlotsSet.add(requiredSlot);
        }
      } else if (!userSlotNames.has(requiredSlot)) {
        missingSlotsSet.add(requiredSlot);
      }
    }

    // Проверяем наличие понятного поискового запроса
    // ИСКЛЮЧЕНИЕ: если есть валидный город и нет конкретного типа мероприятия (generic запрос типа "куда-нибудь сходить"),
    // то поисковый запрос не требуется - система покажет популярные события
    const hasQuerySlot = QUERY_SLOT_CANDIDATES.some((slotName) => userSlotNames.has(slotName));

    // Проверяем, есть ли конкретный тип мероприятия (концерт, театр, выставка и т.д.)
    const hasSpecificEventType = QUERY_SLOT_CANDIDATES.some(
      (slotName) =>
        userSlotNames.has(slotName) && slotName !== 'поисковый_запрос' && slotName !== 'настроение'
    );

    // Generic запрос: есть город, но нет конкретного типа мероприятия
    // Могут быть дополнительные фильтры (бюджет, возрастное_ограничение, настроение), но это все равно generic
    const isGenericCityRequest = hasValidCity && !hasSpecificEventType;

    if (!hasQuerySlot && !allowEmptyQuery && !isGenericCityRequest) {
      missingSlotsSet.add('поисковый_запрос');
    } else if (!hasQuerySlot && (allowEmptyQuery || isGenericCityRequest)) {
      if (isGenericCityRequest) {
        console.log(
          '   ℹ️ Generic запрос (город без конкретного типа мероприятия) - поисковый запрос не требуется, покажем популярные события'
        );
      } else {
        console.log(
          '   ℹ️ Поисковый запрос отсутствует, но разрешено пропустить (show-all intent)'
        );
      }
    }

    const missingSlots = Array.from(missingSlotsSet);

    const result = missingSlots.length === 0;
    if (!result) {
      console.log(`   ❌ Недостающие слоты: ${JSON.stringify(missingSlots)}`);
    } else {
      console.log(`   ✅ Все обязательные слоты собраны`);
    }

    return result;
  } catch (error) {
    console.error('Ошибка проверки обязательных слотов:', error);
    return false;
  }
}

/**
 * Определяет тип запроса на основе слотов пользователя
 * @param {Array} userSlots - Слоты пользователя
 */
export function detectRequestType(userSlots) {
  const slotNames = userSlots.map((slot) => slot.name);

  // Определяем тип на основе типа события или предпочтений
  if (slotNames.includes('тип_события')) {
    const eventTypeSlot = userSlots.find((slot) => slot.name === 'тип_события');
    if (eventTypeSlot && eventTypeSlot.value) {
      const value = eventTypeSlot.value.toLowerCase();
      if (value.includes('концерт') || value.includes('концерты')) {
        return 'концерт';
      }
      if (value.includes('спектакль') || value.includes('театр')) {
        return 'спектакль';
      }
      if (value.includes('выставка') || value.includes('выставки')) {
        return 'выставка';
      }
    }
  }

  // Проверяем предпочтения
  if (slotNames.includes('предпочтения_типы_событий')) {
    const preferencesSlot = userSlots.find((slot) => slot.name === 'предпочтения_типы_событий');
    if (preferencesSlot && preferencesSlot.value) {
      const value = preferencesSlot.value.toLowerCase();
      if (value.includes('концерт')) {
        return 'концерт';
      }
      if (value.includes('спектакль') || value.includes('театр')) {
        return 'спектакль';
      }
      if (value.includes('выставка')) {
        return 'выставка';
      }
    }
  }

  return 'default';
}

/**
 * Базовые обязательные слоты по умолчанию
 */
function getDefaultRequiredSlots() {
  return ['город'];
}

// Слоты, которые делают запрос более конкретным (не расплывчатым)
const SPECIFICITY_SLOTS = new Set([
  'жанр',
  'жанр_музыки',
  'предпочтения_жанры',
  'исполнитель',
  'название_мероприятия',
  'бюджет',
  'цена_от',
  'цена_до',
  'время_события',
  'концерт_время',
]);

// Слоты, которые определяют тип мероприятия (концерт, театр и т.д.)
const EVENT_TYPE_SLOTS = new Set([
  'тип_события',
  'тип_мероприятия',
  'предпочтения_типы_событий',
  'категория',
]);

/**
 * Проверяет, является ли запрос "расплывчатым" - когда есть город, но не хватает
 * конкретики для качественного подбора (тип мероприятия, жанр, время, бюджет).
 * Такие запросы требуют уточняющих вопросов перед показом событий.
 *
 * @param {Array} userSlots - Слоты пользователя
 * @returns {Object} - { isVague: boolean, missingDetails: string[] }
 */
export function isVagueRequest(userSlots) {
  const userSlotNames = new Set(userSlots.map((slot) => slot.name));

  // Проверяем наличие валидного города
  const citySlot = userSlots.find((slot) => slot && slot.name === 'город');
  const hasValidCity = citySlot && citySlot.value && isRussianCity(String(citySlot.value).trim());

  if (!hasValidCity) {
    return { isVague: false, missingDetails: [] };
  }

  const isSpecificSearchQuery = (value) => {
    if (!value || typeof value !== 'string') return false;
    const normalized = value.toLowerCase().trim().replace(/ё/g, 'е');
    if (!normalized) return false;

    if (normalized === 'все') return false;

    const genericWords = new Set([
      'мероприятия',
      'мероприятие',
      'события',
      'событие',
      'афиша',
      'досуг',
      'концерт',
      'концерты',
      'театр',
      'театры',
      'спектакль',
      'спектакли',
      'выставка',
      'выставки',
      'музей',
      'музеи',
      'шоу',
      'фестиваль',
      'фестивали',
      'кино',
      'фильм',
      'фильмы',
      'спорт',
      'матч',
      'матчи',
    ]);
    if (genericWords.has(normalized)) return false;

    if (normalized.length < 4) return false;

    const genericSearchWords = new Set([
      'ищу',
      'найди',
      'найти',
      'хочу',
      'хотим',
      'хотел',
      'хотела',
      'куда',
      'сходить',
      'пойти',
      'что',
      'чтонибудь',
      'чтото',
      'какоенибудь',
      'какойто',
      'на',
      'в',
      'во',
      'по',
      'для',
      'можно',
      'моем',
      'мой',
      'городе',
      'город',
      'есть',
      'ли',
      'посоветуй',
      'посоветуйте',
      // Слово "настроение" во всех падежах — описание желания, не конкретный поисковый запрос.
      // "настроению" появляется как fallback из фраз "по настроению" → не считаем специфичным.
      'настроение',
      'настроению',
      'настроения',
      'настроением',
      'настроении',
      'настрой',
      'настроя',
      'настрою',
    ]);
    const nonSpecificWords = new Set([
      'интересное',
      'интересный',
      'интересную',
      'интересные',
      'интересно',
      'классное',
      'классный',
      'классную',
      'классные',
      'хорошее',
      'хороший',
      'хорошую',
      'хорошие',
      'прикольное',
      'прикольный',
      'лучшее',
      'лучший',
      'знаю',
      'хочется',
    ]);
    const nonSpecificPatterns = [
      /(?<![A-Za-zА-Яа-яЁё0-9_])не\s+знаю(?![A-Za-zА-Яа-яЁё0-9_])/u,
      /(?<![A-Za-zА-Яа-яЁё0-9_])что[-\s]?нибудь(?![A-Za-zА-Яа-яЁё0-9_])/u,
      /(?<![A-Za-zА-Яа-яЁё0-9_])что[-\s]?то(?![A-Za-zА-Яа-яЁё0-9_])/u,
      /(?<![A-Za-zА-Яа-яЁё0-9_])куда[-\s]?нибудь(?![A-Za-zА-Яа-яЁё0-9_])/u,
      /(?<![A-Za-zА-Яа-яЁё0-9_])посовет(уй|уйте|овать)(?![A-Za-zА-Яа-яЁё0-9_])/u,
    ];

    if (nonSpecificPatterns.some((pattern) => pattern.test(normalized))) {
      return false;
    }

    const isTemporalWord = (word) => {
      if (!word) return false;
      if (/^\d{1,2}:\d{2}$/u.test(word)) return true;
      if (/^\d{1,2}\.\d{1,2}(?:\.\d{2,4})?$/u.test(word)) return true;
      return /(сегодн|завтр|послезавтр|выходн|уикенд|понедель|вторник|сред|четверг|пятниц|суббот|воскрес|утр|дн[её]м|вечер|ноч|недел|месяц|январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)/u.test(
        word
      );
    };

    const nonSearchablePatterns = [
      /девушк/u,
      /парн/u,
      /половинк/u,
      /свидан/u,
      /друз/u,
      /компан/u,
      /семь/u,
      /корпоратив/u,
      /(?<![A-Za-zА-Яа-яЁё0-9_])один(ому)?(?:(?<=[A-Za-zА-Яа-яЁё0-9_])(?![A-Za-zА-Яа-яЁё0-9_])|(?<![A-Za-zА-Яа-яЁё0-9_])(?=[A-Za-zА-Яа-яЁё0-9_]))/u,
    ];

    const words = normalized
      .split(/\s+/)
      .map((word) => word.replace(/[^a-zа-я0-9:.-]/giu, ''))
      .filter(Boolean);
    if (words.length <= 2 && nonSearchablePatterns.some((p) => p.test(normalized))) {
      return false;
    }

    const meaningfulWords = words.filter(
      (word) => !genericSearchWords.has(word) && !nonSpecificWords.has(word)
    );
    if (meaningfulWords.length === 0) return false;

    // "ищу субботу", "куда сходить вечером" и подобные временные формулировки
    // не считаем специфичным запросом без категории.
    const hasOnlyTemporalMeaning = meaningfulWords.every(isTemporalWord);
    if (hasOnlyTemporalMeaning) return false;

    if (meaningfulWords.length >= 2) return true;

    return meaningfulWords[0].length >= 5 && !isTemporalWord(meaningfulWords[0]);
  };

  // Проверяем, есть ли тип мероприятия
  const hasEventType = Array.from(EVENT_TYPE_SLOTS).some((slotName) => userSlotNames.has(slotName));

  // Проверяем, есть ли конкретика (жанр, время, бюджет, исполнитель)
  const hasSpecificity = Array.from(SPECIFICITY_SLOTS).some((slotName) => {
    if (!userSlotNames.has(slotName)) return false;
    // "концерт/театр/выставки" в жанрах — не считаем конкретикой (это тип мероприятия).
    if (slotName === 'жанр' || slotName === 'жанр_музыки') {
      const genreSlot = userSlots.find((slot) => slot && slot.name === slotName);
      const v = String(genreSlot?.value || '')
        .toLowerCase()
        .trim()
        .replace(/ё/g, 'е');
      if (
        v === 'концерт' ||
        v === 'концерты' ||
        v === 'театр' ||
        v === 'театры' ||
        v === 'выставка' ||
        v === 'выставки'
      ) {
        return false;
      }
    }
    return true;
  });
  const hasExplicitTime = userSlots.some((slot) => {
    if (!slot) return false;
    const slotName = String(slot.name || '').toLowerCase();
    if (slotName.includes('время')) return true;
    if (slot.timeRange) return true;

    const parsedDate = slot.parsedDate ? new Date(slot.parsedDate) : null;
    if (!parsedDate || Number.isNaN(parsedDate.getTime())) return false;

    return (
      parsedDate.getUTCHours() !== 0 ||
      parsedDate.getUTCMinutes() !== 0 ||
      parsedDate.getUTCSeconds() !== 0
    );
  });
  const hasSpecificityWithTime = hasSpecificity || hasExplicitTime;

  // Определяем, какие детали можно уточнить
  const missingDetails = [];

  if (!hasEventType) {
    // Если пользователь указал конкретный запрос (исполнитель/название события),
    // не считаем это расплывчатым и не требуем уточнения типа мероприятия.
    // Пример: "хочу Егора Крида" — подразумевается поиск концертов.
    const hasNamedTarget =
      userSlotNames.has('исполнитель') || userSlotNames.has('название_мероприятия');
    if (hasNamedTarget) {
      return { isVague: false, missingDetails: [] };
    }

    const searchQuerySlot = userSlots.find((slot) => slot && slot.name === 'поисковый_запрос');
    if (searchQuerySlot && isSpecificSearchQuery(String(searchQuerySlot.value || ''))) {
      return { isVague: false, missingDetails: [] };
    }

    // Нет типа мероприятия - это generic запрос ("куда-то сходить")
    // Нужно спросить тип мероприятия в первую очередь
    missingDetails.push('тип_мероприятия');

    // Также можно уточнить бюджет, если не указан
    if (!hasSpecificityWithTime) {
      missingDetails.push('бюджет');
    }

    return {
      isVague: true,
      missingDetails: missingDetails.slice(0, 2), // Максимум 2 уточнения
    };
  }

  // Есть тип мероприятия - проверяем наличие конкретики
  if (hasSpecificityWithTime) {
    // Есть конкретика - запрос не расплывчатый
    return { isVague: false, missingDetails: [] };
  }

  // Есть тип, но нет конкретики - запрос расплывчатый
  // Определяем тип события для выбора нужных уточнений
  const eventTypeSlot = userSlots.find((slot) => EVENT_TYPE_SLOTS.has(slot.name));
  const eventTypeValue = eventTypeSlot?.value?.toLowerCase() || '';

  // Для концертов и театров в первую очередь спрашиваем жанр
  if (
    eventTypeValue.includes('концерт') ||
    eventTypeValue.includes('музык') ||
    eventTypeValue.includes('фестив') ||
    eventTypeValue.includes('театр') ||
    eventTypeValue.includes('спектак')
  ) {
    missingDetails.push('жанр');
  }

  const hasDate = userSlotNames.has('дата_события');
  if (!hasDate) {
    missingDetails.push('дата');
  }

  const hasBudget =
    userSlotNames.has('бюджет') || userSlotNames.has('цена_до') || userSlotNames.has('цена_от');
  if (!hasBudget) {
    missingDetails.push('бюджет');
  }

  if (!hasExplicitTime) {
    missingDetails.push('время');
  }

  return {
    isVague: true,
    missingDetails: missingDetails.slice(0, 4), // Держим несколько вариантов, чтобы не зацикливаться на одном уточнении
  };
}
