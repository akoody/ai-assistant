import { extractChildAgeFromText } from '../../../../../shared/childAgeUtils.js';
import { normalizeSearchFacetValue, hasFamilyContextSignal } from './searchRouting.js';

function getRequestedChildAge(slots = []) {
  const childAgeSlot = (Array.isArray(slots) ? slots : []).find(
    (slot) => slot?.name === 'возраст_ребенка'
  );
  const parsed = Number.parseInt(String(childAgeSlot?.value || '').replace(/[^0-9]/g, ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 17) {
    return null;
  }
  return parsed;
}

function inferChildAgeSlotFromConversation(
  slots = [],
  { userMessage = '', fallbackQuery = '', history = [] } = {}
) {
  const list = Array.isArray(slots) ? slots : [];
  if (getRequestedChildAge(list) !== null) {
    return list;
  }

  const candidates = [];
  if (userMessage) {
    candidates.push(String(userMessage));
  }
  if (fallbackQuery) {
    candidates.push(String(fallbackQuery));
  }
  if (Array.isArray(history)) {
    const recentUserMessages = [...history]
      .reverse()
      .filter((item) => item?.role === 'user' && item?.content)
      .map((item) => String(item.content))
      .slice(0, 8);
    candidates.push(...recentUserMessages);
  }

  for (const candidateText of candidates) {
    const childAge = extractChildAgeFromText(candidateText);
    if (!Number.isFinite(childAge)) {
      continue;
    }

    console.log(
      `🧒 [inferChildAgeSlotFromConversation] Восстанавливаю возраст ребёнка ${childAge} из текста: "${candidateText}"`
    );
    return [
      ...list,
      {
        name: 'возраст_ребенка',
        value: String(childAge),
        confidence: 0.88,
        source: 'heuristic_child_age_context',
      },
    ];
  }

  return list;
}

function hasSeniorFriendlyConversationSignalText(text = '') {
  const normalized = normalizeSearchFacetValue(text);
  if (!normalized) {
    return false;
  }

  return /(?:^|[^\p{L}])(?:бабушк\w*|бабк\w*|бабул\w*|дедушк\w*|дедул\w*|дед(?:а|у|ом|е)?|пенсионер\w*|пожил\w*|старш\w*\s+поколени\w*)(?=$|[^\p{L}])/u.test(
    normalized
  );
}

function buildSeniorFriendlyConversationSlots() {
  return [
    {
      name: 'аудитория_спутник',
      value: 'пожилой',
      confidence: 0.96,
      source: 'offer_conversation_senior_context',
    },
    {
      name: 'контекст_события',
      value: 'семейный',
      confidence: 0.96,
      source: 'offer_conversation_senior_context',
    },
    {
      name: 'возрастное_ограничение',
      value: 'взрослые',
      confidence: 0.96,
      source: 'offer_conversation_senior_context',
    },
  ];
}

function inferSeniorFriendlySlotsFromConversation(
  slots = [],
  { userMessage = '', fallbackQuery = '', history = [] } = {}
) {
  const list = Array.isArray(slots) ? slots.filter(Boolean) : [];

  const candidates = [];
  if (userMessage) {
    candidates.push(String(userMessage));
  }
  if (fallbackQuery) {
    candidates.push(String(fallbackQuery));
  }
  if (Array.isArray(history)) {
    const recentUserMessages = [...history]
      .reverse()
      .filter((item) => item?.role === 'user' && item?.content)
      .map((item) => String(item.content))
      .slice(0, 8);
    candidates.push(...recentUserMessages);
  }

  const matchedText = candidates.find((candidateText) =>
    hasSeniorFriendlyConversationSignalText(candidateText)
  );
  if (!matchedText) {
    return list;
  }

  const replacementSlotNames = new Set([
    'аудитория_спутник',
    'контекст_события',
    'возрастное_ограничение',
  ]);
  console.log(
    `👵 [inferSeniorFriendlySlotsFromConversation] Восстанавливаю senior-friendly контекст из текста: "${matchedText}"`
  );

  return [
    ...list.filter((slot) => !replacementSlotNames.has(slot?.name)),
    ...buildSeniorFriendlyConversationSlots(),
  ];
}

function getEventMinimumAge(event) {
  const rawAgeRestriction = [
    event?.ageRestriction,
    event?.ageLimit,
    event?.ageGroup?.name,
    event?.ageGroup?.code,
    event?.ageGroup?.value,
  ].find(Boolean);

  const normalized = String(rawAgeRestriction || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .trim();

  if (!normalized) {
    return null;
  }

  const plusMatch = normalized.match(/(\d{1,2})\s*\+/u);
  if (plusMatch) {
    const parsed = Number.parseInt(plusMatch[1], 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const digitsMatch = normalized.match(/\b(\d{1,2})\b/u);
  if (digitsMatch) {
    const parsed = Number.parseInt(digitsMatch[1], 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function filterEventsByChildAge(events, slots) {
  if (!Array.isArray(events) || events.length === 0) {
    return events;
  }

  const requestedChildAge = getRequestedChildAge(slots);
  if (!Number.isFinite(requestedChildAge)) {
    return events;
  }

  const filtered = events.filter((event) => {
    const minimumAge = getEventMinimumAge(event);
    if (!Number.isFinite(minimumAge)) {
      return true;
    }

    if (minimumAge > requestedChildAge) {
      console.log(
        `🧒 [filterEventsByChildAge] Исключаю "${event.title}" - возрастное ограничение ${minimumAge}+ не подходит для ребёнка ${requestedChildAge} лет`
      );
      return false;
    }

    return true;
  });

  if (filtered.length < events.length) {
    console.log(
      `🧒 [filterEventsByChildAge] Оставлено ${filtered.length} из ${events.length} событий для ребёнка ${requestedChildAge} лет`
    );
  }

  return filtered;
}

function filterEventsByFamilyFriendlyAge(events, slots) {
  if (!Array.isArray(events) || events.length === 0) {
    return events;
  }

  if (!hasFamilyContextSignal(slots)) {
    return events;
  }

  const filtered = events.filter((event) => {
    const minimumAge = getEventMinimumAge(event);
    if (!Number.isFinite(minimumAge)) {
      return true;
    }

    if (minimumAge >= 18) {
      console.log(
        `👪 [filterEventsByFamilyFriendlyAge] Исключаю "${event.title}" - возрастное ограничение ${minimumAge}+ не подходит для семейного подбора`
      );
      return false;
    }

    return true;
  });

  if (filtered.length < events.length) {
    console.log(
      `👪 [filterEventsByFamilyFriendlyAge] Оставлено ${filtered.length} из ${events.length} событий после family age-фильтра`
    );
  }

  return filtered;
}

function filterEventsByDislikedPreferences(events, userPreferences) {
  if (!Array.isArray(events) || events.length === 0) {
    return events;
  }

  if (!userPreferences) {
    return events;
  }

  const {
    dislikedGenres = [],
    dislikedArtists = [],
    dislikedEventTypes = [],
    dislikedEventTitles = [],
  } = userPreferences;

  // Если нет негативных предпочтений, возвращаем все события
  if (
    dislikedGenres.length === 0 &&
    dislikedArtists.length === 0 &&
    dislikedEventTypes.length === 0 &&
    dislikedEventTitles.length === 0
  ) {
    return events;
  }

  console.log(`🚫 [filterEventsByDislikedPreferences] Фильтрация по негативным предпочтениям:`);
  if (dislikedGenres.length > 0) {
    console.log(`   - Не любит жанры: ${dislikedGenres.join(', ')}`);
  }
  if (dislikedArtists.length > 0) {
    console.log(`   - Не любит исполнителей: ${dislikedArtists.join(', ')}`);
  }
  if (dislikedEventTypes.length > 0) {
    console.log(`   - Не любит типы событий: ${dislikedEventTypes.join(', ')}`);
  }
  if (dislikedEventTitles.length > 0) {
    console.log(`   - Не любит конкретные события: ${dislikedEventTitles.join(', ')}`);
  }

  const normalizeDislikedText = (value) =>
    String(value || '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/\s+/g, ' ')
      .trim();

  const DISLIKED_GENRE_VARIANTS = {
    классика: [
      'классик',
      'симфони',
      'оркестр',
      'камерн',
      'опера',
      'балет',
      'фортепиано',
      'скрипк',
      'вивальди',
      'моцарт',
      'бах',
      'чайковск',
    ],
    джаз: ['джаз', 'jazz'],
    рок: ['рок', 'rock'],
  };

  const getDislikedPatterns = (value) => {
    const normalized = normalizeDislikedText(value);
    if (!normalized) return [];

    const variants = DISLIKED_GENRE_VARIANTS[normalized] || [normalized];
    return [...new Set(variants.map(normalizeDislikedText).filter(Boolean))];
  };

  const escapePattern = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const getDislikedRegexes = (value) =>
    getDislikedPatterns(value).map((pattern) => {
      if (pattern.includes(' ')) {
        const parts = pattern.split(/\s+/u).filter(Boolean).map(escapePattern);
        return new RegExp(`(^|[^\\p{L}\\p{N}])${parts.join('\\s+')}(?=$|[^\\p{L}\\p{N}])`, 'iu');
      }

      return new RegExp(
        `(^|[^\\p{L}\\p{N}])${escapePattern(pattern)}[\\p{L}-]*(?=$|[^\\p{L}\\p{N}])`,
        'iu'
      );
    });

  const buildEventSearchText = (event) =>
    [
      event?.title,
      event?.description,
      event?.venue,
      event?.address,
      event?.category,
      Array.isArray(event?.extraCategories)
        ? event.extraCategories.join(' ')
        : event?.extraCategories,
      event?.activityTitle,
    ]
      .map(normalizeDislikedText)
      .filter(Boolean)
      .join(' ');

  const filtered = events.filter((event) => {
    const eventCombined = buildEventSearchText(event);

    // Проверяем нежелательные конкретные названия событий (точное совпадение по заголовку)
    if (dislikedEventTitles.length > 0) {
      const eventTitleNorm = normalizeDislikedText(event?.title || '');
      for (const dislikedTitle of dislikedEventTitles) {
        const dislikedTitleNorm = normalizeDislikedText(dislikedTitle);
        if (dislikedTitleNorm && eventTitleNorm === dislikedTitleNorm) {
          console.log(
            `   ❌ Исключаем "${event.title}" - пользователь ранее отметил это событие как нежелательное`
          );
          return false;
        }
      }
    }

    // Проверяем нежелательные жанры
    for (const dislikedGenre of dislikedGenres) {
      const dislikedRegexes = getDislikedRegexes(dislikedGenre);
      if (dislikedRegexes.some((pattern) => pattern.test(eventCombined))) {
        console.log(
          `   ❌ Исключаем "${event.title}" - содержит нежелательный жанр "${dislikedGenre}"`
        );
        return false;
      }
    }

    // Проверяем нежелательных исполнителей
    for (const dislikedArtist of dislikedArtists) {
      const artistLower = normalizeDislikedText(dislikedArtist);
      if (eventCombined.includes(artistLower)) {
        console.log(
          `   ❌ Исключаем "${event.title}" - содержит нежелательного исполнителя "${dislikedArtist}"`
        );
        return false;
      }
    }

    // Проверяем нежелательные типы событий
    for (const dislikedType of dislikedEventTypes) {
      const typeLower = normalizeDislikedText(dislikedType);
      if (eventCombined.includes(typeLower)) {
        console.log(
          `   ❌ Исключаем "${event.title}" - содержит нежелательный тип события "${dislikedType}"`
        );
        return false;
      }
    }

    return true;
  });

  if (filtered.length < events.length) {
    console.log(
      `🚫 [filterEventsByDislikedPreferences] Отфильтровано ${events.length - filtered.length} событий (осталось ${filtered.length})`
    );
  } else {
    console.log(
      `✅ [filterEventsByDislikedPreferences] Все события прошли фильтр по негативным предпочтениям`
    );
  }

  return filtered;
}

export {
  inferChildAgeSlotFromConversation,
  inferSeniorFriendlySlotsFromConversation,
  filterEventsByChildAge,
  filterEventsByFamilyFriendlyAge,
  filterEventsByDislikedPreferences,
};
