import { parseBudgetValue } from './moneyUtils.js';

export const PREFERENCE_TYPES = Object.freeze({
  GENRE: 'genre',
  ARTIST: 'artist',
  EVENT_TYPE: 'event_type',
  PRICE_RANGE: 'price_range',
  CITY: 'city',
  EVENT_TITLE: 'event_title',
});

export const SLOT_TO_PREFERENCE_MAP = Object.freeze({
  жанр: PREFERENCE_TYPES.GENRE,
  жанр_музыки: PREFERENCE_TYPES.GENRE,
  предпочтения_жанры: PREFERENCE_TYPES.GENRE,
  исполнитель: PREFERENCE_TYPES.ARTIST,
  артист: PREFERENCE_TYPES.ARTIST,
  тип_события: PREFERENCE_TYPES.EVENT_TYPE,
  тип_мероприятия: PREFERENCE_TYPES.EVENT_TYPE,
  предпочтения_типы_событий: PREFERENCE_TYPES.EVENT_TYPE,
  бюджет: PREFERENCE_TYPES.PRICE_RANGE,
  цена_от: PREFERENCE_TYPES.PRICE_RANGE,
  цена_до: PREFERENCE_TYPES.PRICE_RANGE,
  город: PREFERENCE_TYPES.CITY,
});

const NON_GENRE_VALUES = new Set([
  'концерт',
  'концерты',
  'театр',
  'театры',
  'выставка',
  'выставки',
]);

const TASTE_PREFERENCE_TYPES = new Set([
  PREFERENCE_TYPES.GENRE,
  PREFERENCE_TYPES.ARTIST,
  PREFERENCE_TYPES.EVENT_TYPE,
]);

const ARTIST_PREFERENCE_MIN_CONFIDENCE = 0.8;

export function normalizePreferenceToken(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .trim();
}

function normalizeFreeText(value = '') {
  return normalizePreferenceToken(value).replace(/\s+/g, ' ');
}

export function normalizeEventTitleValue(value = '') {
  return normalizeFreeText(value);
}

function tokenizeUnicodeText(value = '') {
  const normalized = normalizeFreeText(value);
  if (!normalized) {
    return [];
  }

  try {
    return normalized.match(/[\p{L}\p{N}]+/gu) || [];
  } catch (_error) {
    return normalized.match(/[A-Za-zА-Яа-яЁё0-9]+/g) || [];
  }
}

const MEMORY_PREFERENCE_POSSESSIVE_TOKENS = new Set([
  'мой',
  'моя',
  'мое',
  'моё',
  'мои',
  'моим',
  'моими',
  'моих',
  'моему',
  'моей',
  'моем',
  'моём',
  'свой',
  'своя',
  'свое',
  'своё',
  'свои',
  'своим',
  'своими',
  'своих',
  'своему',
  'своей',
  'своем',
  'своём',
]);

const MEMORY_REQUEST_ACTION_TOKENS = new Set([
  'дай',
  'дайте',
  'покажи',
  'показать',
  'найди',
  'найти',
  'подбери',
  'подобрать',
  'посоветуй',
  'посоветовать',
  'предложи',
  'предложить',
  'подскажи',
  'подсказать',
  'хочу',
  'давай',
]);

const META_PREFERENCE_GENRE_ALLOWED_STEMS = new Set([
  'жанр',
  'любим',
  'нрав',
  'предпочт',
  'вкус',
  'мо',
  'сво',
  'что',
  'то',
  'мне',
  'я',
  'котор',
]);

function normalizePreferenceMemoryStem(token = '') {
  const normalized = normalizePreferenceToken(token);
  if (!normalized) {
    return '';
  }

  if (MEMORY_PREFERENCE_POSSESSIVE_TOKENS.has(normalized))
    return normalized.startsWith('мо') ? 'мо' : 'сво';
  if (normalized.startsWith('любим') || normalized.startsWith('любл')) return 'любим';
  if (normalized.startsWith('нрав')) return 'нрав';
  if (normalized.startsWith('предпочт')) return 'предпочт';
  if (normalized.startsWith('вкус')) return 'вкус';
  if (normalized.startsWith('жанр')) return 'жанр';
  if (normalized.startsWith('бюджет')) return 'бюджет';
  if (normalized.startsWith('ценов')) return 'ценов';
  if (normalized.startsWith('диапазон')) return 'диапазон';
  if (normalized.startsWith('сегмент')) return 'сегмент';
  if (normalized.startsWith('котор')) return 'котор';
  if (normalized.startsWith('основ')) return 'основ';
  if (normalized === 'что') return 'что';
  if (normalized === 'то') return 'то';
  if (normalized === 'мне') return 'мне';
  if (normalized === 'я') return 'я';

  return normalized;
}

function analyzePreferenceMemoryText(text = '') {
  const normalized = normalizeFreeText(text);
  const tokens = tokenizeUnicodeText(text);
  const stems = tokens.map(normalizePreferenceMemoryStem).filter(Boolean);
  const uniqueStems = new Set(stems);
  const hasAction = tokens.some((token) => MEMORY_REQUEST_ACTION_TOKENS.has(token));
  const hasPossessive = uniqueStems.has('мо') || uniqueStems.has('сво');
  const hasGenre = uniqueStems.has('жанр');
  const hasLikeCue =
    uniqueStems.has('любим') ||
    uniqueStems.has('нрав') ||
    uniqueStems.has('предпочт') ||
    uniqueStems.has('вкус');
  const hasBudgetCue =
    uniqueStems.has('бюджет') ||
    uniqueStems.has('ценов') ||
    uniqueStems.has('диапазон') ||
    uniqueStems.has('сегмент');
  const hasLikeMemoryPhrase =
    (uniqueStems.has('что') || uniqueStems.has('то') || uniqueStems.has('котор')) &&
    (uniqueStems.has('мне') || uniqueStems.has('я')) &&
    (uniqueStems.has('нрав') || uniqueStems.has('любим'));

  return {
    normalized,
    stems,
    uniqueStems,
    hasAction,
    hasPossessive,
    hasGenre,
    hasLikeCue,
    hasBudgetCue,
    hasLikeMemoryPhrase,
  };
}

export function isMetaPreferenceGenreValue(value = '') {
  const analysis = analyzePreferenceMemoryText(value);
  if (!analysis.normalized) {
    return false;
  }

  const hasOnlyMetaTokens = analysis.stems.every((stem) =>
    META_PREFERENCE_GENRE_ALLOWED_STEMS.has(stem)
  );
  if (!hasOnlyMetaTokens) {
    return false;
  }

  if (analysis.hasGenre && (analysis.hasPossessive || analysis.hasLikeCue)) {
    return true;
  }

  if (analysis.hasLikeMemoryPhrase) {
    return true;
  }

  return (
    analysis.stems.length > 0 &&
    analysis.stems.every((stem) => stem === 'любим' || stem === 'нрав' || stem === 'предпочт')
  );
}

export function detectPreferenceMemorySignals(text = '', { requireAction = true } = {}) {
  const analysis = analyzePreferenceMemoryText(text);
  if (!analysis.normalized) {
    return {
      wantsAnyPreferenceMemory: false,
      wantsGeneralPreferenceMemory: false,
      wantsTasteMemory: false,
      wantsGenreMemory: false,
      wantsBudgetMemory: false,
    };
  }

  const generalCue =
    (analysis.hasPossessive &&
      (analysis.uniqueStems.has('предпочт') || analysis.uniqueStems.has('вкус'))) ||
    analysis.hasLikeMemoryPhrase;
  const genreCue =
    isMetaPreferenceGenreValue(text) ||
    (analysis.hasGenre && (analysis.hasPossessive || analysis.hasLikeCue));
  const budgetCue =
    analysis.hasBudgetCue &&
    (analysis.hasPossessive || /(?:^|\s)(?:в|по|под)\s+/u.test(analysis.normalized));

  const canUseCue = !requireAction || analysis.hasAction || analysis.hasLikeMemoryPhrase;
  const wantsGeneralPreferenceMemory = generalCue && canUseCue;
  const wantsGenreMemory = genreCue && canUseCue;
  const wantsBudgetMemory = budgetCue && canUseCue;
  const wantsTasteMemory = wantsGeneralPreferenceMemory || wantsGenreMemory;
  const wantsAnyPreferenceMemory =
    wantsGeneralPreferenceMemory || wantsGenreMemory || wantsBudgetMemory;

  return {
    wantsAnyPreferenceMemory,
    wantsGeneralPreferenceMemory,
    wantsTasteMemory,
    wantsGenreMemory,
    wantsBudgetMemory,
  };
}

export function looksLikePreferenceMemoryReferenceText(text = '', { requireAction = false } = {}) {
  const analysis = analyzePreferenceMemoryText(text);
  if (!analysis.normalized) {
    return false;
  }

  const signals = detectPreferenceMemorySignals(text, { requireAction });
  if (signals.wantsAnyPreferenceMemory) {
    return true;
  }

  if (isMetaPreferenceGenreValue(text)) {
    return true;
  }

  return [
    /^из\s+любим(?:ого|ых)?$/u,
    /^по\s+мо(?:им|ему|ей|их)\s+предпочт/u,
    /^по\s+сво(?:им|ему|ей|их)\s+предпочт/u,
    /^по\s+мо(?:ему|им)\s+вкус/u,
    /^по\s+сво(?:ему|им)\s+вкус/u,
    /^(?:то,\s*)?что\s+мне\s+нрав/u,
    /^что\s+я\s+люблю$/u,
    /^мо(?:й|я|е|ё|и|его)\s+любим\p{L}*(?:\s+жанр\p{L}*)?$/u,
    /^сво(?:й|я|е|ё|и|его)\s+любим\p{L}*(?:\s+жанр\p{L}*)?$/u,
  ].some((pattern) => pattern.test(analysis.normalized));
}

function normalizeArtistValue(value = '') {
  return String(value || '').trim();
}

export function mapNonGenreToEventType(value = '') {
  const normalized = normalizePreferenceToken(value);
  if (normalized === 'концерт' || normalized === 'концерты') return 'концерты';
  if (normalized === 'театр' || normalized === 'театры') return 'театры';
  if (normalized === 'выставка' || normalized === 'выставки') return 'выставки';
  return null;
}

export function buildEmptyUserPreferences(userId) {
  return {
    userId,
    genres: [],
    artists: [],
    eventTypes: [],
    dislikedGenres: [],
    dislikedArtists: [],
    dislikedEventTypes: [],
    dislikedEventTitles: [],
    priceRange: null,
    city: null,
    createdAt: null,
    updatedAt: null,
  };
}

export function normalizeStoredPreferencesDocument(preferences = null, userId = null) {
  if (!preferences) {
    return buildEmptyUserPreferences(userId);
  }

  const normalizedGenres = Array.isArray(preferences.genres)
    ? preferences.genres
        .map((genre) => normalizePreferenceToken(genre))
        .filter((genre) => genre && !NON_GENRE_VALUES.has(genre))
    : [];

  const normalizedDislikedGenres = Array.isArray(preferences.dislikedGenres)
    ? preferences.dislikedGenres
        .map((genre) => normalizePreferenceToken(genre))
        .filter((genre) => genre && !NON_GENRE_VALUES.has(genre))
    : [];

  const normalizedEventTypes = Array.isArray(preferences.eventTypes)
    ? preferences.eventTypes.map((eventType) => normalizePreferenceToken(eventType)).filter(Boolean)
    : [];

  const normalizedDislikedEventTypes = Array.isArray(preferences.dislikedEventTypes)
    ? preferences.dislikedEventTypes
        .map((eventType) => normalizePreferenceToken(eventType))
        .filter(Boolean)
    : [];

  const normalizedArtists = Array.isArray(preferences.artists)
    ? preferences.artists.map((artist) => normalizeArtistValue(artist)).filter(Boolean)
    : [];

  const normalizedDislikedArtists = Array.isArray(preferences.dislikedArtists)
    ? preferences.dislikedArtists.map((artist) => normalizeArtistValue(artist)).filter(Boolean)
    : [];

  const normalizedDislikedEventTitles = Array.isArray(preferences.dislikedEventTitles)
    ? [
        ...new Set(
          preferences.dislikedEventTitles
            .map((title) => normalizeEventTitleValue(title))
            .filter(Boolean)
        ),
      ]
    : [];

  return {
    userId: preferences.userId || userId,
    genres: normalizedGenres,
    artists: normalizedArtists,
    eventTypes: normalizedEventTypes,
    dislikedGenres: normalizedDislikedGenres,
    dislikedArtists: normalizedDislikedArtists,
    dislikedEventTypes: normalizedDislikedEventTypes,
    dislikedEventTitles: normalizedDislikedEventTitles,
    priceRange: preferences.priceRange || null,
    city: normalizeArtistValue(preferences.city || '') || null,
    createdAt: preferences.createdAt || null,
    updatedAt: preferences.updatedAt || null,
  };
}

function isLetterOnly(value) {
  try {
    return /^[\p{L}]+$/u.test(String(value || '').trim());
  } catch (_error) {
    return /^[A-Za-zА-Яа-яЁё]+$/.test(String(value || '').trim());
  }
}

export function hasExplicitPreferenceSignal(text = '') {
  const normalized = normalizeFreeText(text);
  if (!normalized) return false;

  return (
    /любл|нрав|обожаю|предпочит|мой\s+любим|мне\s+заход|мне\s+близк/u.test(normalized) ||
    /хочу\s+еще\s+такое|хочу\s+что[-\s]?то\s+похож|еще\s+похож/u.test(normalized)
  );
}

const NEGATIVE_PREFERENCE_CUE_REGEX =
  /(?:^|[^\p{L}\p{N}_])(?:не\s+люб[\p{L}]*|не\s+нрав[\p{L}]*|больше\s+не\s+нрав[\p{L}]*|разонрав[\p{L}]*|не\s+хоч[\p{L}]*|надоел[\p{L}]*|устал[\p{L}]*\s+от)(?=$|[^\p{L}\p{N}_])/u;

const GENERIC_POSITIVE_TRANSITION_REGEX =
  /(?:^|[,.!?;:\s-])(?:(?:а|но|зато|однако|и)\s+)?(?:(?:теперь\s+)?(?:хоч[\p{L}]*|предпочит[\p{L}]*)|(?:по)?смотр[\p{L}]*|покаж[\p{L}]*|найд[\p{L}]*|подбер[\p{L}]*|предлож[\p{L}]*|переключ[\p{L}]*\s+на|интерес[\p{L}]*|лучше|вместо)(?=$|[^\p{L}\p{N}_])/u;

const PREFERENCE_CLAUSE_BOUNDARY_REGEX = /[,.!?;]+|\s+(?:а|но|зато|однако)\s+/gu;

export function hasNegativePreferenceCue(text = '') {
  const normalized = normalizeFreeText(text);
  if (!normalized) {
    return false;
  }

  return NEGATIVE_PREFERENCE_CUE_REGEX.test(normalized);
}

function hasGenericPositiveTransitionCue(text = '') {
  const normalized = normalizeFreeText(text);
  if (!normalized) {
    return false;
  }

  return GENERIC_POSITIVE_TRANSITION_REGEX.test(normalized);
}

function extractPreferenceClauses(text = '') {
  const normalized = normalizeFreeText(text);
  if (!normalized) {
    return [];
  }

  const clauses = [];
  let lastIndex = 0;

  for (const match of normalized.matchAll(PREFERENCE_CLAUSE_BOUNDARY_REGEX)) {
    const rawClause = normalized.slice(lastIndex, match.index);
    const trimmedClause = rawClause.trim();

    if (trimmedClause) {
      const leadingOffset = rawClause.search(/\S/u);
      const start = lastIndex + (leadingOffset >= 0 ? leadingOffset : 0);
      clauses.push({
        text: trimmedClause,
        start,
      });
    }

    lastIndex = match.index + match[0].length;
  }

  const tailClause = normalized.slice(lastIndex);
  const trimmedTailClause = tailClause.trim();
  if (trimmedTailClause) {
    const leadingOffset = tailClause.search(/\S/u);
    const start = lastIndex + (leadingOffset >= 0 ? leadingOffset : 0);
    clauses.push({
      text: trimmedTailClause,
      start,
    });
  }

  return clauses;
}

function isPositivePreferenceClause(text = '', hasPositiveTargetSignal = null) {
  const normalized = normalizeFreeText(text);
  if (!normalized || hasNegativePreferenceCue(normalized)) {
    return false;
  }

  if (typeof hasPositiveTargetSignal === 'function' && hasPositiveTargetSignal(normalized)) {
    return true;
  }

  return hasExplicitPreferenceSignal(normalized) || hasGenericPositiveTransitionCue(normalized);
}

function cleanNegativePreferencePart(text = '') {
  return normalizeFreeText(text)
    .replace(/[,.!?;:\s-]+$/u, '')
    .trim();
}

function cleanPositivePreferencePart(text = '') {
  return normalizeFreeText(text)
    .replace(/^(?:а|но|зато|однако|и)\s+/u, '')
    .trim();
}

export function splitPreferenceChangeText(text = '', { hasPositiveTargetSignal = null } = {}) {
  const normalized = normalizeFreeText(text);
  if (!normalized) {
    return {
      fullText: '',
      negativePart: '',
      positivePart: '',
    };
  }

  const hasNegativeCue = hasNegativePreferenceCue(normalized);
  if (!hasNegativeCue) {
    return {
      fullText: normalized,
      negativePart: '',
      positivePart: normalized,
    };
  }

  const clauses = extractPreferenceClauses(normalized);
  const negativeClauseIndexes = clauses
    .map((clause, index) => (hasNegativePreferenceCue(clause.text) ? index : -1))
    .filter((index) => index >= 0);

  const lastNegativeClauseIndex =
    negativeClauseIndexes.length > 0 ? negativeClauseIndexes[negativeClauseIndexes.length - 1] : -1;

  let positiveBoundaryIndex = -1;

  if (lastNegativeClauseIndex >= 0) {
    const followingPositiveClause = clauses
      .slice(lastNegativeClauseIndex + 1)
      .find((clause) => isPositivePreferenceClause(clause.text, hasPositiveTargetSignal));

    if (followingPositiveClause) {
      positiveBoundaryIndex = followingPositiveClause.start;
    } else {
      const negativeClause = clauses[lastNegativeClauseIndex];
      const transitionMatch = GENERIC_POSITIVE_TRANSITION_REGEX.exec(negativeClause?.text || '');
      if (transitionMatch) {
        const relativeIndex =
          transitionMatch.index + transitionMatch[0].length - transitionMatch[0].trimStart().length;
        const candidatePositivePart = negativeClause.text.slice(relativeIndex).trim();
        if (isPositivePreferenceClause(candidatePositivePart, hasPositiveTargetSignal)) {
          positiveBoundaryIndex = negativeClause.start + relativeIndex;
        }
      }
    }
  }

  if (positiveBoundaryIndex < 0) {
    return {
      fullText: normalized,
      negativePart: normalized,
      positivePart: '',
    };
  }

  return {
    fullText: normalized,
    negativePart:
      cleanNegativePreferencePart(normalized.slice(0, positiveBoundaryIndex)) || normalized,
    positivePart: cleanPositivePreferencePart(normalized.slice(positiveBoundaryIndex)),
  };
}

export function hasTransactionalSignal(text = '', intents = []) {
  const normalized = normalizeFreeText(text);
  const inputIntents = Array.isArray(intents) ? intents : [];

  if (inputIntents.some((intent) => intent?.name === 'buy_ticket')) {
    return true;
  }

  return (
    /купить\s+билет/u.test(normalized) ||
    /хочу\s+купить/u.test(normalized) ||
    /оформить\s+билет/u.test(normalized) ||
    /заказать\s+билет/u.test(normalized)
  );
}

export function shouldSkipPreferenceSave({ slot, preferenceType, sourceText = '', intents = [] }) {
  if (!slot) return true;

  const rawValue = slot.value;
  if (rawValue === undefined || rawValue === null) return true;

  if (preferenceType === PREFERENCE_TYPES.ARTIST) {
    const normalizedArtist = normalizeArtistValue(rawValue);
    if (!normalizedArtist) return true;

    const confidence = typeof slot.confidence === 'number' ? slot.confidence : null;
    if (confidence !== null && confidence < ARTIST_PREFERENCE_MIN_CONFIDENCE) {
      console.log(
        `[userPreferencesService] ℹ️ Пропускаю сохранение предпочтения артиста из слота с низкой уверенностью: ` +
          `"${normalizedArtist}" (confidence: ${confidence}, min: ${ARTIST_PREFERENCE_MIN_CONFIDENCE})`
      );
      return true;
    }

    const hasDigit = /\d/.test(normalizedArtist);
    if (!hasDigit && normalizedArtist.length <= 2 && isLetterOnly(normalizedArtist)) {
      console.log(
        `[userPreferencesService] ℹ️ Пропускаю сохранение предпочтения артиста: слишком короткое значение "${normalizedArtist}"`
      );
      return true;
    }
  }

  const isTastePreference = TASTE_PREFERENCE_TYPES.has(preferenceType);
  const isNegativeTastePreference = isTastePreference && slot.isNegative;
  const isPositiveTastePreference = isTastePreference && !slot.isNegative;
  const hasChangePreferencesIntent =
    Array.isArray(intents) && intents.some((intent) => intent?.name === 'change_preferences');

  // Для НЕГАТИВНЫХ вкусовых слотов (жанр, исполнитель, тип события):
  // если значение слота не упоминается в тексте сообщения — LLM его выдумала из контекста.
  // Например, при "Генерал и его семья мне не нравится" LLM может придумать жанр "рок",
  // которого в сообщении нет. Такое галлюцинированное предпочтение не сохраняем.
  if (isNegativeTastePreference && sourceText) {
    const normalizedSource = normalizeFreeText(sourceText);
    const normalizedValue = normalizeFreeText(String(rawValue || ''));
    if (normalizedValue && normalizedValue.length >= 2) {
      const stem = normalizedValue.replace(
        /(?:иями|ями|ами|ого|ему|ому|ыми|ими|ая|ое|ые|ий|ый|ой|ей|ов|ев|ам|ям|ах|ях|ую|юю|а|я|у|ю|е|о|ы|и|ь)$/u,
        ''
      );
      const effectiveStem = stem.length >= 3 ? stem : normalizedValue;
      const appearsInText = normalizedSource.includes(effectiveStem);
      if (!appearsInText) {
        console.log(
          `[userPreferencesService] ℹ️ Пропускаю сохранение негативного предпочтения "${String(rawValue).trim()}" — ` +
            `значение слота не встречается в тексте сообщения "${sourceText.slice(0, 80)}"`
        );
        return true;
      }
    }
  }

  if (isTastePreference && hasChangePreferencesIntent) {
    console.log(
      `[userPreferencesService] ℹ️ Пропускаю сохранение вкусового предпочтения для change_preferences-сценария: ` +
        `${preferenceType}="${String(rawValue).trim()}"`
    );
    return true;
  }

  if (isPositiveTastePreference) {
    const explicitPreferenceSignal = hasExplicitPreferenceSignal(sourceText);
    const transactionalSignal = hasTransactionalSignal(sourceText, intents);

    if (transactionalSignal) {
      console.log(
        `[userPreferencesService] ℹ️ Пропускаю сохранение вкусового предпочтения из transactional-сценария: ` +
          `${preferenceType}="${String(rawValue).trim()}"`
      );
      return true;
    }

    if (!explicitPreferenceSignal) {
      console.log(
        `[userPreferencesService] ℹ️ Пропускаю сохранение вкусового предпочтения без явного сигнала симпатии: ` +
          `${preferenceType}="${String(rawValue).trim()}"`
      );
      return true;
    }
  }

  return false;
}

export function buildPreferenceUpdateDescriptor({
  userId,
  preferenceType,
  value,
  isNegative = false,
  now = new Date(),
}) {
  switch (preferenceType) {
    case PREFERENCE_TYPES.GENRE: {
      const normalizedGenre = normalizePreferenceToken(value);
      if (!normalizedGenre) {
        return null;
      }

      const mappedEventType = mapNonGenreToEventType(normalizedGenre);
      if (mappedEventType) {
        return {
          storedPreferenceType: PREFERENCE_TYPES.EVENT_TYPE,
          normalizedValue: mappedEventType,
          updateOperation: isNegative
            ? {
                $addToSet: { dislikedEventTypes: mappedEventType },
                $pull: { eventTypes: mappedEventType },
                $set: { updatedAt: now },
                $setOnInsert: { userId, createdAt: now },
              }
            : {
                $addToSet: { eventTypes: mappedEventType },
                $pull: { dislikedEventTypes: mappedEventType },
                $set: { updatedAt: now },
                $setOnInsert: { userId, createdAt: now },
              },
        };
      }

      return {
        storedPreferenceType: preferenceType,
        normalizedValue: normalizedGenre,
        updateOperation: isNegative
          ? {
              $addToSet: { dislikedGenres: normalizedGenre },
              $pull: { genres: normalizedGenre },
              $set: { updatedAt: now },
              $setOnInsert: { userId, createdAt: now },
            }
          : {
              $addToSet: { genres: normalizedGenre },
              $pull: { dislikedGenres: normalizedGenre },
              $set: { updatedAt: now },
              $setOnInsert: { userId, createdAt: now },
            },
      };
    }

    case PREFERENCE_TYPES.ARTIST: {
      const normalizedArtist = normalizeArtistValue(value);
      if (!normalizedArtist) {
        return null;
      }

      return {
        storedPreferenceType: preferenceType,
        normalizedValue: normalizedArtist,
        updateOperation: isNegative
          ? {
              $addToSet: { dislikedArtists: normalizedArtist },
              $pull: { artists: normalizedArtist },
              $set: { updatedAt: now },
              $setOnInsert: { userId, createdAt: now },
            }
          : {
              $addToSet: { artists: normalizedArtist },
              $pull: { dislikedArtists: normalizedArtist },
              $set: { updatedAt: now },
              $setOnInsert: { userId, createdAt: now },
            },
      };
    }

    case PREFERENCE_TYPES.EVENT_TYPE: {
      const normalizedEventType = normalizePreferenceToken(value);
      if (!normalizedEventType) {
        return null;
      }

      return {
        storedPreferenceType: preferenceType,
        normalizedValue: normalizedEventType,
        updateOperation: isNegative
          ? {
              $addToSet: { dislikedEventTypes: normalizedEventType },
              $pull: { eventTypes: normalizedEventType },
              $set: { updatedAt: now },
              $setOnInsert: { userId, createdAt: now },
            }
          : {
              $addToSet: { eventTypes: normalizedEventType },
              $pull: { dislikedEventTypes: normalizedEventType },
              $set: { updatedAt: now },
              $setOnInsert: { userId, createdAt: now },
            },
      };
    }

    case PREFERENCE_TYPES.PRICE_RANGE:
      return {
        storedPreferenceType: preferenceType,
        normalizedValue: value,
        updateOperation: {
          $set: {
            priceRange: value,
            updatedAt: now,
          },
          $setOnInsert: { userId, createdAt: now },
        },
      };

    case PREFERENCE_TYPES.CITY: {
      const normalizedCity = normalizeArtistValue(value);
      if (!normalizedCity) {
        return null;
      }

      return {
        storedPreferenceType: preferenceType,
        normalizedValue: normalizedCity,
        updateOperation: {
          $set: {
            city: normalizedCity,
            updatedAt: now,
          },
          $setOnInsert: { userId, createdAt: now },
        },
      };
    }

    case PREFERENCE_TYPES.EVENT_TITLE: {
      const normalizedTitle = normalizeEventTitleValue(value);
      if (!normalizedTitle) {
        return null;
      }

      return {
        storedPreferenceType: preferenceType,
        normalizedValue: normalizedTitle,
        updateOperation: isNegative
          ? {
              $addToSet: { dislikedEventTitles: normalizedTitle },
              $set: { updatedAt: now },
              $setOnInsert: { userId, createdAt: now },
            }
          : {
              $pull: { dislikedEventTitles: normalizedTitle },
              $set: { updatedAt: now },
              $setOnInsert: { userId, createdAt: now },
            },
      };
    }

    default:
      return null;
  }
}

export function buildPreferenceRemoveDescriptor({ preferenceType, value, now = new Date() }) {
  switch (preferenceType) {
    case PREFERENCE_TYPES.GENRE: {
      const normalizedGenre = normalizePreferenceToken(value);
      if (!normalizedGenre) {
        return null;
      }

      const mappedEventType = mapNonGenreToEventType(normalizedGenre);
      return {
        normalizedValue: mappedEventType || normalizedGenre,
        updateOperation: mappedEventType
          ? {
              $pull: { eventTypes: mappedEventType },
              $set: { updatedAt: now },
            }
          : {
              $pull: { genres: normalizedGenre },
              $set: { updatedAt: now },
            },
      };
    }

    case PREFERENCE_TYPES.ARTIST: {
      const normalizedArtist = normalizeArtistValue(value);
      if (!normalizedArtist) {
        return null;
      }

      return {
        normalizedValue: normalizedArtist,
        updateOperation: {
          $pull: { artists: normalizedArtist },
          $set: { updatedAt: now },
        },
      };
    }

    case PREFERENCE_TYPES.EVENT_TYPE: {
      const normalizedEventType = normalizePreferenceToken(value);
      if (!normalizedEventType) {
        return null;
      }

      return {
        normalizedValue: normalizedEventType,
        updateOperation: {
          $pull: { eventTypes: normalizedEventType },
          $set: { updatedAt: now },
        },
      };
    }

    default:
      return null;
  }
}

export function buildPreferenceClearDescriptor({ preferenceType, now = new Date() }) {
  switch (preferenceType) {
    case PREFERENCE_TYPES.GENRE:
      return { updateOperation: { $set: { genres: [], updatedAt: now } } };
    case PREFERENCE_TYPES.ARTIST:
      return { updateOperation: { $set: { artists: [], updatedAt: now } } };
    case PREFERENCE_TYPES.EVENT_TYPE:
      return { updateOperation: { $set: { eventTypes: [], updatedAt: now } } };
    case PREFERENCE_TYPES.PRICE_RANGE:
      return { updateOperation: { $set: { priceRange: null, updatedAt: now } } };
    case PREFERENCE_TYPES.CITY:
      return { updateOperation: { $set: { city: null, updatedAt: now } } };
    default:
      return null;
  }
}

export function isBudgetPreferenceSlotName(slotName = '') {
  const normalized = String(slotName || '').trim();
  return normalized === 'бюджет' || normalized === 'цена_от' || normalized === 'цена_до';
}

export function mergePriceRangeWithSlot(currentPriceRange = {}, slot = null) {
  const nextPriceRange = { ...(currentPriceRange || {}) };
  const slotName = String(slot?.name || '').trim();
  const rawValue = slot?.value;

  if (!isBudgetPreferenceSlotName(slotName) || rawValue === undefined || rawValue === null) {
    return nextPriceRange;
  }

  const parsedValue = parseBudgetValue(rawValue);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return nextPriceRange;
  }

  if (slotName === 'цена_от') {
    nextPriceRange.min = parsedValue;
  } else {
    nextPriceRange.max = parsedValue;
  }

  return nextPriceRange;
}
