import {
  isCalendarSchedulingSearchNoiseToken,
  isCalendarSchedulingOnlySearchString,
} from '../dateParsingUtils.js';
import { isAnyDateSelectionSlot, isShowAllSearchQueryValue, hasQuerySlot } from './slotUtils.js';
import {
  STOP_WORDS,
  TRIVIAL_WORDS,
  NON_SPECIFIC_QUERY_WORDS,
  MONTH_WORDS,
  DOMAIN_LIKE_FALLBACK_QUERY_RULES,
} from './searchVocabulary.js';
import { normalizeText } from './textUtils.js';
import { CATEGORY_KEYWORD_MAP } from './categoryDefinitions.js';

function normalizeForComparison(value = '') {
  if (!value || typeof value !== 'string') {
    return '';
  }
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]/gi, '')
    .trim();
}

function isCityToken(token, citySlots = []) {
  if (!token || !citySlots || citySlots.length === 0) {
    return false;
  }

  const normalizedToken = normalizeForComparison(token);
  if (!normalizedToken || normalizedToken.length < 3) {
    return false;
  }

  const isRootMatch = (cityVariant) => {
    if (!cityVariant) {
      return false;
    }

    if (normalizedToken === cityVariant) {
      return true;
    }

    const minLength = Math.min(4, cityVariant.length, normalizedToken.length);
    if (minLength < 4) {
      return false;
    }
    const cityRoot = cityVariant.substring(0, minLength);
    const tokenRoot = normalizedToken.substring(0, minLength);
    return cityRoot === tokenRoot;
  };

  // Проверяем каждый слот города
  for (const citySlot of citySlots) {
    const cityValue = String(citySlot.value || '').trim();
    if (!cityValue) {
      continue;
    }

    const normalizedCity = normalizeForComparison(cityValue);
    if (!normalizedCity) {
      continue;
    }

    // Для составных городов (например Нижний Новгород, Санкт-Петербург)
    // отдельно проверяем каждую часть, чтобы новгород/петербург не становились fallback-query
    const cityWordVariants = cityValue
      .split(/[\s/-]+/u)
      .map((part) => normalizeForComparison(part))
      .filter((part) => part.length >= 3);

    const allVariants = Array.from(new Set([normalizedCity, ...cityWordVariants]));
    for (const variant of allVariants) {
      if (isRootMatch(variant)) {
        return true;
      }
    }
  }

  return false;
}

function deriveFallbackQuery(userMessage, slots = []) {
  if (!userMessage || typeof userMessage !== 'string') {
    return '';
  }

  const normalizedMessage = normalizeText(userMessage);
  // Ответы на уточняющие вопросы (бюджет/дата/и т.п.) не должны превращаться в поисковый запрос.
  // Иначе "Любой" или "До 3000₽" ломает контекст и приводит к выдаче "популярных" событий не по теме.
  const isBudgetOnlyMessage =
    normalizedMessage === 'любой' ||
    normalizedMessage === 'любой бюджет' ||
    normalizedMessage === 'любая цена' ||
    normalizedMessage === 'не важно' ||
    normalizedMessage === 'неважно' ||
    /^до\s*\d+/u.test(normalizedMessage) ||
    /^\d+\s*₽?$/u.test(normalizedMessage);
  const hasAnyDateSlot = Array.isArray(slots) && slots.some((slot) => isAnyDateSelectionSlot(slot));
  const isDateOnlyMessage =
    hasAnyDateSlot ||
    normalizedMessage === 'любая дата' ||
    normalizedMessage === 'любую дату' ||
    normalizedMessage === 'любая' ||
    /(?:^|\s)люб(?:ая|ую)\s+дат/u.test(normalizedMessage) ||
    /без\s+разниц[ыи]\s+по\s+дат/u.test(normalizedMessage) ||
    /не\s+важно\s+по\s+дат/u.test(normalizedMessage) ||
    /когда\s+угодно/u.test(normalizedMessage);
  if (isBudgetOnlyMessage || isDateOnlyMessage) {
    return '';
  }

  const keywords = new Set();
  CATEGORY_KEYWORD_MAP.forEach(({ regex, value }) => {
    if (regex.test(userMessage)) {
      keywords.add(value);
    }
  });

  if (keywords.size > 0) {
    return Array.from(keywords).join(' ');
  }

  const sanitized = userMessage
    .toLowerCase()
    .replace(/[.,!?()\-–—"'«»]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Получаем все значения слотов для фильтрации
  const slotValues = new Set(
    (slots || [])
      .map((slot) =>
        String(slot.value || '')
          .toLowerCase()
          .trim()
      )
      .filter(Boolean)
  );

  // Получаем слоты городов отдельно для специальной проверки
  const citySlots = (slots || []).filter((slot) => {
    const slotName = String(slot.name || '')
      .toLowerCase()
      .trim();
    return slotName === 'город' && slot.value;
  });

  // Извлекаем части значений контекстных слотов (например, "с_мамой" → "мамой")
  // чтобы не дублировать уже захваченный контекст в поисковый запрос.
  // Применяем только к слотам, которые НЕ участвуют в формировании keyword напрямую
  // (контекст события, настроение, возрастные ограничения).
  const CONTEXT_SLOT_NAMES_FOR_PART_FILTER = new Set([
    'контекст_события',
    'настроение',
    'возрастное_ограничение',
    'возраст_ребенка',
  ]);
  const slotValueParts = new Set();
  (slots || []).forEach((slot) => {
    if (!slot || !CONTEXT_SLOT_NAMES_FOR_PART_FILTER.has(slot.name)) return;
    const value = String(slot.value || '')
      .toLowerCase()
      .trim();
    if (!value) return;
    value.split(/[_\s]+/).forEach((part) => {
      if (part.length > 2) slotValueParts.add(part);
    });
  });

  const tokens = sanitized.split(' ');
  const filteredTokens = tokens.filter((token) => {
    if (!token || token.length <= 2) {
      return false;
    }
    if (STOP_WORDS.has(token)) {
      return false;
    }
    if (TRIVIAL_WORDS.has(token)) {
      return false;
    }
    if (NON_SPECIFIC_QUERY_WORDS.has(token)) {
      return false;
    }
    // Слова месяцев сами по себе — это не поисковый запрос (это часть даты)
    if (MONTH_WORDS.has(token)) {
      return false;
    }
    // Проверяем точное совпадение со значениями слотов
    if (slotValues.has(token)) {
      return false;
    }
    // Фильтруем части контекстных слотов (например, "мамой" из "с_мамой")
    if (slotValueParts.has(token)) {
      return false;
    }
    // Универсальная проверка на города через слоты (работает для всех городов)
    if (isCityToken(token, citySlots)) {
      return false;
    }
    if (isCalendarSchedulingSearchNoiseToken(token)) {
      return false;
    }
    return true;
  });

  if (filteredTokens.length > 0) {
    const fallback = filteredTokens.slice(0, 6).join(' ').trim();
    // Финальная проверка: если fallback содержит только тривиальные слова, возвращаем пустую строку
    const fallbackWords = fallback.split(/\s+/);
    const hasNonTrivialWords = fallbackWords.some(
      (word) =>
        word.length > 2 &&
        !TRIVIAL_WORDS.has(word) &&
        !STOP_WORDS.has(word) &&
        !NON_SPECIFIC_QUERY_WORDS.has(word)
    );
    if (hasNonTrivialWords) {
      return fallback;
    }
  }

  // Не возвращаем 'мероприятия' по умолчанию - это слишком общее слово
  return '';
}

function resolveDomainLikeSearchQueryFromMessage(message = '') {
  const normalized = normalizeText(message);
  if (!normalized) {
    return null;
  }

  const compact = normalized
    .replace(/[.,!?;:()[\]{}"'`«»]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!compact) {
    return null;
  }

  const tokens = compact.split(' ').filter(Boolean);
  if (tokens.length === 0 || tokens.length > 4) {
    return null;
  }

  for (const rule of DOMAIN_LIKE_FALLBACK_QUERY_RULES) {
    if (rule.pattern.test(compact)) {
      return rule.value;
    }
  }

  return null;
}

function normalizeFallbackSearchQuery(rawQuery = '') {
  const normalized = normalizeText(rawQuery);
  if (!normalized) {
    return null;
  }

  if (isShowAllSearchQueryValue(normalized)) {
    return null;
  }

  const compact = normalized
    .replace(/[.,!?;:()[\]{}"'`«»]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!compact) {
    return null;
  }

  const tokens = compact.split(' ').filter(Boolean);
  const meaningfulTokens = tokens.filter(
    (token) =>
      token.length > 2 &&
      !TRIVIAL_WORDS.has(token) &&
      !STOP_WORDS.has(token) &&
      !NON_SPECIFIC_QUERY_WORDS.has(token)
  );

  if (meaningfulTokens.length === 0) {
    return null;
  }

  for (const rule of DOMAIN_LIKE_FALLBACK_QUERY_RULES) {
    if (rule.pattern.test(compact)) {
      return rule.value;
    }
  }

  if (isCalendarSchedulingOnlySearchString(compact)) {
    return null;
  }

  const withoutCalendarNoise = meaningfulTokens.filter(
    (token) => !isCalendarSchedulingSearchNoiseToken(token)
  );
  if (withoutCalendarNoise.length === 0) {
    return null;
  }

  return withoutCalendarNoise.slice(0, 6).join(' ');
}

function augmentSlotsWithQuery(
  slots = [],
  fallbackQuery = '',
  { userMessage = '', offTopicIntent = null } = {}
) {
  const baseSlots = Array.isArray(slots) ? [...slots] : [];

  // Если уже есть конкретные слоты с информацией о запросе, ничего не добавляем.
  if (hasQuerySlot(baseSlots)) {
    return baseSlots;
  }

  if (offTopicIntent) {
    return baseSlots;
  }

  // КРИТИЧЕСКИ ВАЖНО:
  // Не генерируем поисковый_запрос эвристически внутри planner.
  // Поисковый keyword должен формироваться только через LLM-извлечение слотов/интентов,
  // иначе в слот попадают шумовые фразы вроде "с отцом", "ему 56" и т.п.
  // Здесь сознательно "гасим" fallback-канал и оставляем только уже извлеченные LLM слоты.
  const fallbackSearchQuery = normalizeFallbackSearchQuery(fallbackQuery);
  const domainLikeQuery = resolveDomainLikeSearchQueryFromMessage(userMessage);
  if (fallbackSearchQuery || domainLikeQuery) {
    console.log(
      `🛑 [augmentSlotsWithQuery] Эвристический fallback keyword подавлен: ` +
        `fallback="${fallbackSearchQuery || ''}", domainLike="${domainLikeQuery || ''}". ` +
        'Ожидаю keyword только от LLM.'
    );
  }

  return baseSlots;
}

export {
  deriveFallbackQuery,
  resolveDomainLikeSearchQueryFromMessage,
  normalizeFallbackSearchQuery,
  augmentSlotsWithQuery,
};
