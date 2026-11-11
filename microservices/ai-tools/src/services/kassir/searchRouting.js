import { isVagueArtistDescriptor } from '../../../../../shared/vagueArtistUtils.js';

const CATEGORY_KEYWORD_PREFIXES = Object.freeze([
  'театр',
  'спектак',
  'выставк',
  'концерт',
  'стендап',
  'фестивал',
  'опера',
  'балет',
  'мюзикл',
  'цирк',
]);

const CATEGORY_KEYWORD_EXACT = new Set([
  'кино',
  'музей',
  'музеи',
  'экскурсия',
  'экскурсии',
  'шоу',
  'спорт',
]);

const ROOT_CATEGORY_SEARCH_SLUGS = Object.freeze({
  concerts: '/bilety-na-koncert/',
  theater: '/bilety-v-teatr/',
  exhibitions: '/bilety-na-vystavki/',
  museums: '/bilety-v-muzei/',
  standup: '/bilety-na-standup/',
  shows: '/bilety-na-shou/',
  festivals: '/bilety-na-festival/',
});

const DEFAULT_BROAD_SEARCH_SLUGS = Object.freeze([
  ROOT_CATEGORY_SEARCH_SLUGS.concerts,
  ROOT_CATEGORY_SEARCH_SLUGS.theater,
  ROOT_CATEGORY_SEARCH_SLUGS.exhibitions,
  ROOT_CATEGORY_SEARCH_SLUGS.museums,
  ROOT_CATEGORY_SEARCH_SLUGS.standup,
  ROOT_CATEGORY_SEARCH_SLUGS.shows,
  ROOT_CATEGORY_SEARCH_SLUGS.festivals,
]);

const CATEGORY_SLUG_RULES = Object.freeze([
  {
    slug: ROOT_CATEGORY_SEARCH_SLUGS.standup,
    patterns: [/(ст[эе]ндап|stand\s*-?\s*up|standup|комик|комедия\s+в\s+формате\s+стендап)/iu],
  },
  {
    slug: ROOT_CATEGORY_SEARCH_SLUGS.concerts,
    patterns: [/(концерт|концерты|филармон|жив\w*\s+музык|музыкальн\w+\s+вечер)/iu],
  },
  {
    slug: ROOT_CATEGORY_SEARCH_SLUGS.theater,
    patterns: [/(театр|театры|спектакл|пьес|драма|мюзикл|опера|балет|моноспект)/iu],
  },
  {
    slug: ROOT_CATEGORY_SEARCH_SLUGS.exhibitions,
    patterns: [/(выставк|экспозици|галере|биеннале|перформанс)/iu],
  },
  {
    slug: ROOT_CATEGORY_SEARCH_SLUGS.museums,
    patterns: [/(музе[йия]|музеи|музейн)/iu],
  },
  {
    slug: ROOT_CATEGORY_SEARCH_SLUGS.shows,
    patterns: [/(шоу|цирк|иммерсив|перфоманс)/iu],
  },
  {
    slug: ROOT_CATEGORY_SEARCH_SLUGS.festivals,
    patterns: [/(фестивал|open\s*air|опен-?эйр)/iu],
  },
]);

const BROAD_SEARCH_PAGE_SIZE = 72;

const SALE_SECTION_SLUG = '/sale/';

const DEFAULT_PAGE_KIT_SLUG = '/category/';

const CATEGORY_REFINEMENT_SLOT_NAMES = new Set([
  'жанр',
  'жанр_музыки',
  'предпочтения_жанры',
  'исполнитель',
  'название_мероприятия',
  'поисковый_запрос',
]);

const CATEGORY_REFINEMENT_PATTERNS = [
  /драм/u,
  /комед/u,
  /трагед/u,
  /мелодрам/u,
  /фарс/u,
  /детектив/u,
  /иммерсив/u,
  /моноспект/u,
  /экскурс/u,
  /сказк/u,
  /детск/u,
  /семейн/u,
  /кукольн/u,
  /музыкальн/u,
  /оперет/u,
  /рок-?опера/u,
];

function isCategoryKeywordToken(value) {
  const normalized = String(value || '')
    .toLowerCase()
    .trim();
  if (!normalized) {
    return false;
  }

  if (CATEGORY_KEYWORD_EXACT.has(normalized)) {
    return true;
  }

  return CATEGORY_KEYWORD_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function hasCategoryRefinementSlot(slots = []) {
  return Array.isArray(slots)
    ? slots.some(
        (slot) =>
          slot && CATEGORY_REFINEMENT_SLOT_NAMES.has(slot.name) && String(slot.value || '').trim()
      )
    : false;
}

function shouldPreserveCategoryPhrase({
  importantParts = [],
  categoryPart = '',
  slots = [],
  keywordSource = '',
}) {
  if (keywordSource !== 'params' || !categoryPart) {
    return false;
  }

  const normalizedCategoryPart = String(categoryPart).toLowerCase().trim();
  const supplementaryParts = importantParts.filter((part) => {
    const normalized = String(part || '')
      .toLowerCase()
      .trim();
    return normalized && normalized !== normalizedCategoryPart;
  });

  if (supplementaryParts.length === 0) {
    return false;
  }

  if (hasCategoryRefinementSlot(slots)) {
    return true;
  }

  return supplementaryParts.some((part) =>
    CATEGORY_REFINEMENT_PATTERNS.some((pattern) => pattern.test(String(part || '').toLowerCase()))
  );
}

function normalizePageKitSlug(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }
  const withoutSlashes = normalized.replace(/^\/+|\/+$/g, '');
  return withoutSlashes ? `/${withoutSlashes}/` : '/';
}

function shouldSkipGeneratedKeywordForSlug(slug = '', keyword = '') {
  const normalizedRequestedSlug = normalizePageKitSlug(slug);
  const requestedSlugSegments = normalizedRequestedSlug
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
  const hasKeywordFromParams = typeof keyword === 'string' && keyword.trim().length > 0;

  if (hasKeywordFromParams || normalizedRequestedSlug === '/category/') {
    return false;
  }

  // Если planner уже выбрал любой конкретный slug, дополнительный LLM keyword
  // чаще вредит: может сузить поиск случайным словом вроде "веселье".
  return requestedSlugSegments.length > 0 || normalizedRequestedSlug === SALE_SECTION_SLUG;
}

function shouldApplyMoodKeywordFallback({
  hasMoodSlot = false,
  moodValue = '',
  effectiveIntent = '',
  effectiveKeyword = '',
  keywordSource = '',
  allowParamMoodKeyword = false,
  shouldSkipGeneratedKeywordForSpecificSlug = false,
  isRomanticContext = false,
} = {}) {
  if (!hasMoodSlot || !String(moodValue || '').trim()) {
    return false;
  }

  if (shouldSkipGeneratedKeywordForSpecificSlug) {
    return false;
  }

  if (keywordSource === 'params' && !allowParamMoodKeyword) {
    return false;
  }

  if (isRomanticContext) {
    return true;
  }

  return !String(effectiveKeyword || '').trim() && effectiveIntent === 'mood';
}

function inferMoodValueFromText(value = '') {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .trim();
  if (!normalized) {
    return '';
  }

  if (/(романт|для\s*двоих|свидани|влюблен|любов)/i.test(normalized)) return 'романтика';
  if (
    /(поднят[а-я]*\s+настроен|поддерж[а-я]*\s+настроен|улучш[а-я]*\s+настроен|для\s+настроени[яе]|развея|отвлеч|взбодр|повесел|посмея|скучн)/i.test(
      normalized
    )
  )
    return 'веселье';
  if (/(грустн|тоск|хандр|печаль)/i.test(normalized)) return 'грустное';
  if (/(энерг|актив|драйв|динамич|заряд|тус|движ)/i.test(normalized)) return 'энергичный';
  if (/(спокой|расслаб|тих|уют|умиротвор|устал|выгорел|перегорел|отдохн)/i.test(normalized))
    return 'спокойный';
  if (/(интеллект|умн|позн|узнат|культур|образов|лекц|вдохнов)/i.test(normalized))
    return 'интеллектуальный';
  if (/(необыч|нов(ое|ый)?|нестандарт|эксперимент|иммерсив|перформ|удив)/i.test(normalized))
    return 'новое/необычное';
  // "по настроению" / "под настроение" — идиом "как придётся", конкретного mood нет.
  if (/(?:^|[^\p{L}\p{N}])(?:по|под)\s+настроени/u.test(normalized)) return '';
  // Позитивный контекст с упоминанием настроения: "хорошее настроение ... поддержать" и т.д.
  if (
    /(хорош|отличн|прекрасн|замечат|чудесн|позитив|весёл|велик)\S*\s+настроени/i.test(normalized) ||
    /настроени\S*\s+(?:\S+\s+){0,3}(?:поддерж|сохран|продолж)/i.test(normalized) ||
    /(?:поддерж|сохран)\S*\s+(?:\S+\s+){0,3}настроени/i.test(normalized)
  )
    return 'веселье';
  return '';
}

function detectCategorySearchSlugs({
  effectiveKeyword = '',
  querySuggestion = null,
  slots = [],
  lastUserMessage = '',
}) {
  const categorySlotValue = getFirstSlotValue(slots, [
    'тип_мероприятия',
    'тип_события',
    'категория',
  ]);
  const texts = [
    effectiveKeyword,
    querySuggestion?.searchQuery,
    querySuggestion?.category,
    categorySlotValue,
    lastUserMessage,
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());

  if (texts.length === 0) {
    return [];
  }

  const detectedSlugs = [];
  const seen = new Set();

  for (const rule of CATEGORY_SLUG_RULES) {
    if (texts.some((text) => rule.patterns.some((pattern) => pattern.test(text)))) {
      if (!seen.has(rule.slug)) {
        detectedSlugs.push(rule.slug);
        seen.add(rule.slug);
      }
    }
  }

  return detectedSlugs;
}

function resolveSearchSlugStrategy({
  slug = '/category/',
  effectiveKeyword = '',
  querySuggestion = null,
  slots = [],
  lastUserMessage = '',
  isBroadSearch = false,
}) {
  const normalizedSlug = normalizePageKitSlug(slug);
  if (normalizedSlug !== '/category/') {
    return {
      slugs: [normalizedSlug || slug],
      reason: 'custom-slug',
      broadSearch: false,
    };
  }

  // Если явно запрошен широкий поиск, не пытаемся сужать до категорий
  if (isBroadSearch) {
    return {
      slugs: [DEFAULT_PAGE_KIT_SLUG],
      reason: 'forced-broad-search',
      broadSearch: true,
    };
  }

  const namedTarget = getFirstSlotValue(slots, ['исполнитель', 'артист', 'название_мероприятия']);
  const detectedCategorySlugs = detectCategorySearchSlugs({
    effectiveKeyword,
    querySuggestion,
    slots,
    lastUserMessage,
  });

  if (detectedCategorySlugs.length > 0) {
    return {
      slugs: detectedCategorySlugs,
      reason: 'detected-category-slugs',
      broadSearch: detectedCategorySlugs.length > 1,
    };
  }

  const hasKeyword = typeof effectiveKeyword === 'string' && effectiveKeyword.trim().length > 0;
  const intent = String(querySuggestion?.intent || '').trim() || 'unknown';
  const canUseBroadFallback =
    !namedTarget && !hasKeyword && ['generic', 'unknown', 'category'].includes(intent);

  if (canUseBroadFallback) {
    return {
      slugs: DEFAULT_BROAD_SEARCH_SLUGS.slice(),
      reason: 'broad-empty-keyword-root-search',
      broadSearch: true,
    };
  }

  return {
    slugs: [normalizedSlug || '/category/'],
    reason: 'default-root-slug',
    broadSearch: false,
  };
}

function getFirstSlotValue(slots = [], slotNames = []) {
  if (
    !Array.isArray(slots) ||
    slots.length === 0 ||
    !Array.isArray(slotNames) ||
    slotNames.length === 0
  ) {
    return '';
  }

  const slotNameSet = new Set(slotNames);
  const matchedSlot = slots.find((slot) => {
    if (!slot || !slotNameSet.has(slot.name)) {
      return false;
    }

    const slotValue = String(slot.value || '').trim();
    if (!slotValue) {
      return false;
    }

    if (
      (slot.name === 'исполнитель' || slot.name === 'артист') &&
      isVagueArtistDescriptor(slotValue)
    ) {
      return false;
    }

    return true;
  });
  return matchedSlot ? String(matchedSlot.value || '').trim() : '';
}

function buildStrictSearchResolution({ slots = [], effectiveKeyword = '', originalKeyword = '' }) {
  const artistValue = getFirstSlotValue(slots, ['исполнитель', 'артист']);
  const eventNameValue = getFirstSlotValue(slots, ['название_мероприятия']);

  const strictSource = artistValue ? 'artist' : eventNameValue ? 'event_name' : null;
  const strictValue = artistValue || eventNameValue || '';

  if (!strictSource || !strictValue) {
    return {
      strictSource: null,
      strictValue: '',
      strictQuerySuppressed: false,
      suppressionReason: null,
    };
  }

  const normalizedStrictValue = String(strictValue).toLowerCase().trim();
  const normalizedAppliedKeyword = String(effectiveKeyword || '')
    .toLowerCase()
    .trim();
  const normalizedOriginalKeyword = String(originalKeyword || '')
    .toLowerCase()
    .trim();

  let strictQuerySuppressed = false;
  let suppressionReason = null;

  if (!normalizedAppliedKeyword) {
    strictQuerySuppressed = true;
    suppressionReason = 'applied-keyword-empty';
  } else if (!normalizedAppliedKeyword.includes(normalizedStrictValue)) {
    strictQuerySuppressed = true;
    suppressionReason = 'applied-keyword-no-longer-contains-strict-query';
  }

  return {
    strictSource,
    strictValue,
    strictQuerySuppressed,
    suppressionReason,
    originalKeyword: normalizedOriginalKeyword,
    appliedKeyword: normalizedAppliedKeyword,
  };
}

function buildQuerySuggestionFromParams({ keyword = '', slots = [], lastUserMessage = '' }) {
  const normalizedKeyword = String(keyword || '').trim();
  const artistValue = getFirstSlotValue(slots, ['исполнитель', 'артист']);
  const eventNameValue = getFirstSlotValue(slots, ['название_мероприятия']);
  const categoryValue = getFirstSlotValue(slots, ['тип_мероприятия', 'тип_события', 'категория']);
  const moodValue = getFirstSlotValue(slots, ['настроение']);
  const contextValue = getFirstSlotValue(slots, ['контекст_события']);

  let inferredIntent = 'generic';
  if (artistValue) {
    inferredIntent = 'artist';
  } else if (categoryValue) {
    inferredIntent = 'category';
  } else if (moodValue && !normalizedKeyword) {
    inferredIntent = 'mood';
  } else if (!normalizedKeyword && !lastUserMessage) {
    inferredIntent = 'unknown';
  }

  return {
    intent: inferredIntent,
    searchQuery: normalizedKeyword,
    category: categoryValue || null,
    context: contextValue || null,
    reason: artistValue
      ? 'params-keyword-with-artist-slot'
      : eventNameValue
        ? 'params-keyword-with-event-slot'
        : categoryValue
          ? 'params-keyword-with-category-slot'
          : 'params-keyword',
    raw: null,
  };
}

function shouldPreserveFullKeywordForNamedTarget(querySuggestion = null, slots = []) {
  const intent = String(querySuggestion?.intent || '').trim();
  if (intent === 'artist') {
    return true;
  }

  return Boolean(getFirstSlotValue(slots, ['название_мероприятия']));
}

function hasExplicitDateConstraint(slots = []) {
  if (!Array.isArray(slots) || slots.length === 0) {
    return false;
  }

  return slots.some((slot) => {
    if (!slot || slot.name !== 'дата_события') {
      return false;
    }

    return Boolean(
      slot.parsedDate ||
      (slot.dateRange && (slot.dateRange.startDate || slot.dateRange.endDate)) ||
      String(slot.value || '').trim()
    );
  });
}

export {
  ROOT_CATEGORY_SEARCH_SLUGS,
  BROAD_SEARCH_PAGE_SIZE,
  DEFAULT_PAGE_KIT_SLUG,
  isCategoryKeywordToken,
  shouldPreserveCategoryPhrase,
  normalizePageKitSlug,
  shouldSkipGeneratedKeywordForSlug,
  shouldApplyMoodKeywordFallback,
  inferMoodValueFromText,
  detectCategorySearchSlugs,
  resolveSearchSlugStrategy,
  getFirstSlotValue,
  buildStrictSearchResolution,
  buildQuerySuggestionFromParams,
  shouldPreserveFullKeywordForNamedTarget,
  hasExplicitDateConstraint,
};
