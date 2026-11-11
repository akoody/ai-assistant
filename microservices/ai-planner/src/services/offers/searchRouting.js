import {
  MOOD_SEARCH_PROFILES,
  SEARCH_FACET_NORMALIZATION_RULES,
  GENERIC_POPULAR_REQUEST_TOKENS,
  GENERIC_MOOD_QUERY_STOP_TOKENS,
  CATEGORY_SLUG_CONFIGS,
  CHILD_AUDIENCE_OVERRIDE_CATEGORY_KEYS,
  DEFAULT_SLUG,
  MOOD_ROUTING_BLOCKING_SLOT_NAMES,
  FAMILY_FUN_ROUTE_PRIORITY,
  FUN_MOOD_RELAXED_CATEGORY_KEYS,
  ALLOWED_POPULAR_SELECTION_SLOT_NAMES,
} from './searchDefinitions.js';
import { isCalendarSchedulingOnlySearchString } from '../dateParsingUtils.js';
import { isKnownEventTaxonomyValue } from '../../../../../shared/eventTaxonomy.js';
import { looksLikePreferenceMemoryReferenceText } from '../../../../../shared/preferenceRules.js';
import {
  isVagueArtistDescriptor,
  looksLikeUnknownArtistDiscoveryText,
} from '../../../../../shared/vagueArtistUtils.js';
import { normalizePageKitSlug, getPopularSelectionSlugForDomain } from './popularSelections.js';
import { normalizeCityValue, getDomainForCity } from './cityDomains.js';

function normalizeMoodSearchText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

function findMoodSearchProfile(value = '') {
  const normalized = normalizeMoodSearchText(value);
  if (!normalized) {
    return null;
  }

  return (
    MOOD_SEARCH_PROFILES.find((profile) =>
      profile.patterns.some((pattern) => pattern.test(normalized))
    ) || null
  );
}

function inferMoodValueFromContext(contextValue = '') {
  const normalized = normalizeMoodSearchText(contextValue);
  if (!normalized) {
    return '';
  }

  if (/(романт|свидан|для\s*двоих|влюблен|пара|вдво)/u.test(normalized)) {
    return 'романтика';
  }

  return '';
}

function resolveMoodSearchSignal({ slots = [], fallbackQuery = '', keywordOverride = null } = {}) {
  const effectiveSlots = Array.isArray(slots) ? slots.filter(Boolean) : [];

  const explicitMoodSlot = effectiveSlots.find(
    (slot) =>
      slot &&
      !slot.isNegative &&
      slot.name === 'настроение' &&
      String(slot.value || '').trim().length > 0
  );
  if (explicitMoodSlot) {
    const explicitMoodValue = String(explicitMoodSlot.value || '').trim();
    const explicitProfile = findMoodSearchProfile(explicitMoodValue);
    if (explicitProfile) {
      return {
        moodValue: explicitMoodValue,
        normalizedMoodValue: normalizeMoodSearchText(explicitMoodValue),
        profile: explicitProfile,
        source: 'slot',
      };
    }
  }

  const contextSlot = effectiveSlots.find(
    (slot) =>
      slot &&
      !slot.isNegative &&
      slot.name === 'контекст_события' &&
      String(slot.value || '').trim().length > 0
  );
  const contextMoodValue = inferMoodValueFromContext(contextSlot?.value || '');
  if (contextMoodValue) {
    const contextProfile = findMoodSearchProfile(contextMoodValue);
    if (contextProfile) {
      return {
        moodValue: contextMoodValue,
        normalizedMoodValue: normalizeMoodSearchText(contextMoodValue),
        profile: contextProfile,
        source: 'context',
      };
    }
  }

  const textCandidates = [keywordOverride, fallbackQuery]
    .filter((value) => typeof value === 'string')
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  for (const candidateText of textCandidates) {
    const textProfile = findMoodSearchProfile(candidateText);
    if (textProfile) {
      return {
        moodValue: candidateText,
        normalizedMoodValue: normalizeMoodSearchText(candidateText),
        profile: textProfile,
        source: 'text',
      };
    }
  }

  return null;
}

function normalizeSearchFacetValue(value = '') {
  let normalized = String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return normalized;
  }

  SEARCH_FACET_NORMALIZATION_RULES.forEach(({ pattern, replacement }) => {
    normalized = normalized.replace(pattern, replacement);
  });

  return normalized.replace(/\s+/g, ' ').trim();
}

function isGenericMoodSearchQueryValue(value = '') {
  const normalized = normalizeSearchFacetValue(value);
  if (!normalized) {
    return true;
  }

  // Любой запрос, содержащий слово "настроение" в любой падежной форме — это
  // mood-сигнал, а не строгий текстовый поиск по названию события.
  // Примеры: "такое настроение чтобы его поддержать", "поднять настроение",
  //          "улучшить настроение", "для настроения" и т.д.
  if (/(?:^|[^\p{L}\p{N}])настроени/u.test(normalized)) {
    return true;
  }

  if (findMoodSearchProfile(normalized)) {
    return true;
  }

  const compact = normalized.replace(/\s+/g, '');
  if (
    GENERIC_POPULAR_REQUEST_TOKENS.has(normalized) ||
    GENERIC_POPULAR_REQUEST_TOKENS.has(compact)
  ) {
    return true;
  }

  const tokens = normalized
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return true;
  }

  const meaningfulTokens = tokens.filter((token) => {
    const compactToken = token.replace(/\s+/g, '');
    if (GENERIC_MOOD_QUERY_STOP_TOKENS.has(token)) {
      return false;
    }
    if (
      GENERIC_POPULAR_REQUEST_TOKENS.has(token) ||
      GENERIC_POPULAR_REQUEST_TOKENS.has(compactToken)
    ) {
      return false;
    }
    if (isNeutralPopularSelectionToken(token)) {
      return false;
    }
    return token.length > 1;
  });

  return meaningfulTokens.length === 0;
}

function isPopularitySortOnlyValue(value = '') {
  const normalized = normalizeSearchFacetValue(value);
  if (!normalized) {
    return false;
  }

  return /^(?:популяр|лучш)/u.test(normalized);
}

function removePopularitySortOnlyTokens(value = '') {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  return raw
    .split(/\s+/u)
    .filter((token) => !isPopularitySortOnlyValue(token))
    .join(' ')
    .trim();
}

function isInvalidArtistSlotForStrictSearch(value = '') {
  const normalized = normalizeSearchFacetValue(value);
  if (!normalized) {
    return true;
  }

  if (looksLikePreferenceMemoryReferenceText(value, { requireAction: false })) {
    return true;
  }

  if (isKnownEventTaxonomyValue(normalized)) {
    return true;
  }

  if (isCalendarSchedulingOnlySearchString(normalized)) {
    return true;
  }

  if (isGenericMoodSearchQueryValue(normalized)) {
    return true;
  }

  if (isAgeOnlySearchFacetValue(normalized)) {
    return true;
  }

  if (
    /(?:^|[^\p{L}\p{N}])(?:сегодня|завтра|послезавтра|вчера|утром|днем|днем|вечером|ночью)(?:$|[^\p{L}\p{N}])/u.test(
      normalized
    ) ||
    /(?:^|[^\p{L}\p{N}])(?:(?:на\s+)?(?:следующ(?:ие|их|им)|будущ(?:ие|их|им)|ближайш(?:ие|их|им)|этих?)\s+выходн(?:ые|ых|ым))(?:$|[^\p{L}\p{N}])/u.test(
      normalized
    ) ||
    /(?:^|[^\p{L}\p{N}])(?:на\s+следующей\s+неделе|на\s+будущей\s+неделе|на\s+этой\s+неделе|через\s+\d+\s+(?:дн(?:я|ей)?|недел(?:ю|и|ь)|месяц(?:а|ев)?|год(?:а|ов)?))(?:$|[^\p{L}\p{N}])/u.test(
      normalized
    ) ||
    /(?:^|[^\p{L}\p{N}])(?:понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)(?:$|[^\p{L}\p{N}])/u.test(
      normalized
    ) ||
    /(?:^|[^\p{L}\p{N}])(?:в\s*)?\d{1,2}:\d{2}(?:$|[^\p{L}\p{N}])/u.test(normalized)
  ) {
    return true;
  }

  if (
    /(?:^|[^\p{L}\p{N}])(?:настроени|романт|весел|весель|энергич|спокойн|интеллектуал|необыч|грустн|тоск)(?:$|[^\p{L}\p{N}])/u.test(
      normalized
    ) ||
    /(?:^|[^\p{L}\p{N}])(?:развея|отвлеч|взбодр|повесел|посмея|рассмеш|расслаб|отдохн|оторваться|проораться|поорать)(?:$|[^\p{L}\p{N}])/u.test(
      normalized
    )
  ) {
    return true;
  }

  if (
    /^(?:концерт|концерты|театр|театры|спектакл(?:ь|и)?|опера|балет|мюзикл|выставк(?:а|и)?|музе(?:й|и)|стендап|шоу|кино|фильм|фильмы|спорт|матч|матчи|квест|экскурси(?:я|и)|цирк|клоунада)$/u.test(
      normalized
    ) ||
    /^(?:рок|поп|джаз|рэп|реп|хип[\s-]?хоп|классик(?:а)?|шансон|блюз|панк|инди|метал|техно|хаус|house|танец|танцы|танцев\p{L}*)$/u.test(
      normalized
    )
  ) {
    return true;
  }

  if (
    /(?:^|[^\p{L}\p{N}])(?:какой(?:-|\s)?нибудь|какая(?:-|\s)?нибудь|какое(?:-|\s)?нибудь|что(?:-|\s)?нибудь|куда(?:-|\s)?нибудь|любой|любая|любое)(?:$|[^\p{L}\p{N}])/u.test(
      normalized
    )
  ) {
    return true;
  }

  return false;
}

function isAgeOnlySearchFacetValue(value = '') {
  const normalized = normalizeSearchFacetValue(value);
  if (!normalized) {
    return false;
  }

  const hasAgeMarker =
    /(?:^|[^\p{L}\p{N}])\d{1,2}\s*(?:\+|плюс|лет|года|год|годиков)(?=$|[^\p{L}\p{N}])/u.test(
      normalized
    ) ||
    /(?:^|[^\p{L}\p{N}])(?:от|с|до|по|старше|младше)\s+\d{1,2}\s*(?:лет|года|год|годиков)?(?=$|[^\p{L}\p{N}])/u.test(
      normalized
    );

  if (!hasAgeMarker) {
    return false;
  }

  const residue = normalized
    .replace(/\d{1,2}\s*(?:\+|плюс|лет|года|год|годиков)?/gu, ' ')
    .replace(
      /(?:можно|возраст|возраста|от|с|до|по|старше|младше|лет|года|год|годиков|плюс|детям|детей|дети|ребенку|ребенок|ребенка)/gu,
      ' '
    )
    .replace(/[+.,;:!?()[\]{}"'`«»\s-]+/gu, '')
    .trim();

  return residue.length === 0;
}

function collectFacetCandidates(values = []) {
  const candidates = [];
  const seen = new Set();

  const pushCandidate = (value) => {
    const normalized = normalizeSearchFacetValue(value);
    if (!normalized || seen.has(normalized)) {
      return;
    }

    candidates.push(normalized);
    seen.add(normalized);
  };

  for (const value of Array.isArray(values) ? values : []) {
    const normalized = normalizeSearchFacetValue(value);
    if (!normalized) {
      continue;
    }

    pushCandidate(normalized);

    const tokens = normalized
      .split(/[^\p{L}\p{N}]+/u)
      .map((token) => token.trim())
      .filter(Boolean);

    tokens.forEach(pushCandidate);

    for (let index = 0; index < tokens.length - 1; index += 1) {
      pushCandidate(`${tokens[index]} ${tokens[index + 1]}`);
    }
  }

  return candidates;
}

function matchesCategoryType(categoryConfig, value = '') {
  const normalized = normalizeSearchFacetValue(value);
  if (!normalized) {
    return false;
  }

  if (
    Array.isArray(categoryConfig?.typeSimpleValues) &&
    categoryConfig.typeSimpleValues.includes(normalized)
  ) {
    return true;
  }

  return Array.isArray(categoryConfig?.typePatterns)
    ? categoryConfig.typePatterns.some((pattern) => pattern.test(normalized))
    : false;
}

function resolveCategoryGenreRule(categoryConfig, value = '') {
  const normalized = normalizeSearchFacetValue(value);
  if (!normalized || !Array.isArray(categoryConfig?.genreRules)) {
    return null;
  }

  return (
    categoryConfig.genreRules.find(
      (rule) =>
        rule.simpleValues.includes(normalized) ||
        rule.patterns.some((pattern) => pattern.test(normalized))
    ) || null
  );
}

function findCategoryConfigByType(values = []) {
  const candidates = collectFacetCandidates(values);
  if (candidates.length === 0) {
    return null;
  }

  for (const candidate of candidates) {
    const matchedConfig = CATEGORY_SLUG_CONFIGS.find((config) =>
      matchesCategoryType(config, candidate)
    );
    if (matchedConfig) {
      return matchedConfig;
    }
  }

  return null;
}

function getCategoryConfigByKey(key = '') {
  return CATEGORY_SLUG_CONFIGS.find((config) => config.key === key) || null;
}

const AMBIGUOUS_CATEGORY_SHOW_ALL_SLOT_NAME = 'режим_поиска';

const AMBIGUOUS_CATEGORY_SHOW_ALL_SLOT_VALUE = 'ambiguous_category_show_all';

const AMBIGUOUS_CATEGORY_ROUTE_LABELS = Object.freeze({
  theater: 'Театры',
  concerts: 'Концерты',
  shows: 'Шоу',
  children: 'Детям',
});

function getCategoryConfigBySlug(slug = '') {
  const normalizedSlug = String(slug || '').trim();
  if (!normalizedSlug) {
    return null;
  }

  return (
    CATEGORY_SLUG_CONFIGS.find(
      (config) =>
        config?.rootSlug === normalizedSlug ||
        (Array.isArray(config?.genreRules) &&
          config.genreRules.some((rule) => rule?.slug === normalizedSlug))
    ) || null
  );
}

function hasAmbiguousCategoryShowAllMode(slots = []) {
  return (Array.isArray(slots) ? slots : []).some(
    (slot) =>
      slot &&
      !slot.isNegative &&
      String(slot.name || '').trim() === AMBIGUOUS_CATEGORY_SHOW_ALL_SLOT_NAME &&
      String(slot.value || '').trim() === AMBIGUOUS_CATEGORY_SHOW_ALL_SLOT_VALUE
  );
}

function getAmbiguousCategoryRouteLabel(categoryConfig = null) {
  if (!categoryConfig?.key) {
    return null;
  }

  return AMBIGUOUS_CATEGORY_ROUTE_LABELS[categoryConfig.key] || null;
}

function getAmbiguousGenreShowAllRouteDefinitions(slots = []) {
  const effectiveSlots = Array.isArray(slots)
    ? slots.filter((slot) => slot && !slot.isNegative)
    : [];
  if (!hasAmbiguousCategoryShowAllMode(effectiveSlots)) {
    return [];
  }

  const typeValues = effectiveSlots
    .filter((slot) =>
      ['тип_события', 'тип_мероприятия', 'категория'].includes(String(slot?.name || '').trim())
    )
    .map((slot) => slot.value);
  if (findCategoryConfigByType(typeValues)) {
    return [];
  }

  const ambiguousGenreSlot = effectiveSlots.find(
    (slot) =>
      ['жанр', 'жанр_музыки', 'предпочтения_жанры'].includes(String(slot?.name || '').trim()) &&
      String(slot?.value || '').trim() &&
      String(slot?.source || '').trim() === 'ambiguous_genre_context'
  );
  if (!ambiguousGenreSlot) {
    return [];
  }

  const routeDefinitions = [];
  const seenSources = new Set();

  CATEGORY_SLUG_CONFIGS.forEach((categoryConfig) => {
    if (!Array.isArray(categoryConfig?.genreRules) || categoryConfig.genreRules.length === 0) {
      return;
    }

    const label = getAmbiguousCategoryRouteLabel(categoryConfig);
    if (!label) {
      return;
    }

    const matchedRule = resolveCategoryGenreRule(categoryConfig, ambiguousGenreSlot.value);
    if (!matchedRule?.slug) {
      return;
    }

    const source = `ambiguous_category:${categoryConfig.key}`;
    if (seenSources.has(source)) {
      return;
    }

    seenSources.add(source);
    routeDefinitions.push({
      categoryConfig,
      genreSlot: ambiguousGenreSlot,
      label,
      source,
    });
  });

  return routeDefinitions.length > 1 ? routeDefinitions : [];
}

function pruneBroadRootCandidatesWhenSpecificGenreSlugExists(candidates = []) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (list.length <= 1) {
    return list;
  }

  const categoryKeysWithSpecificSlug = new Set();

  list.forEach((candidate) => {
    const slug = String(candidate?.params?.slug || '').trim();
    const categoryConfig = getCategoryConfigBySlug(slug);
    if (!categoryConfig || slug === categoryConfig.rootSlug) {
      return;
    }

    categoryKeysWithSpecificSlug.add(categoryConfig.key);
  });

  if (categoryKeysWithSpecificSlug.size === 0) {
    return list;
  }

  return list.filter((candidate) => {
    const slug = String(candidate?.params?.slug || '').trim();
    const categoryConfig = getCategoryConfigBySlug(slug);
    if (!categoryConfig) {
      return true;
    }

    if (slug !== categoryConfig.rootSlug) {
      return true;
    }

    return !categoryKeysWithSpecificSlug.has(categoryConfig.key);
  });
}

function hasSaleRoutingSignal(values = []) {
  const saleCategoryConfig = getCategoryConfigByKey('sale');
  if (!saleCategoryConfig) {
    return false;
  }

  return collectFacetCandidates(values).some((candidate) =>
    matchesCategoryType(saleCategoryConfig, candidate)
  );
}

function resolveCategorySearchRouting({
  typeValues = [],
  genreValues = [],
  fallbackValues = [],
  isChildAudience = false,
}) {
  // Если запрос широкий и мульти-категорийный (напр. "мероприятия, концерты, спектакли"),
  // то не фиксируем одну категорию, а позволяем искать везде (DEFAULT_SLUG).
  const allTextValues = [...typeValues, ...genreValues, ...fallbackValues];
  if (allTextValues.some((text) => hasBroadMultiCategorySelectionText(text))) {
    console.log(
      '🌐 [resolveCategorySearchRouting] Обнаружен широкий мульти-категорийный запрос, использую общий поиск'
    );
    return null;
  }

  const saleSignalValues = [...typeValues, ...genreValues, ...fallbackValues];
  const hasSaleSignal = hasSaleRoutingSignal(saleSignalValues);

  const explicitCategory = hasSaleSignal ? null : findCategoryConfigByType(typeValues);
  const fallbackCategory =
    hasSaleSignal || explicitCategory ? null : findCategoryConfigByType(fallbackValues);
  let categoryConfig = hasSaleSignal
    ? getCategoryConfigByKey('sale')
    : explicitCategory || fallbackCategory;

  if (isChildAudience) {
    const childConfig = getCategoryConfigByKey('children');
    if (
      categoryConfig?.key !== 'sale' &&
      (!categoryConfig || CHILD_AUDIENCE_OVERRIDE_CATEGORY_KEYS.has(categoryConfig.key))
    ) {
      categoryConfig = childConfig;
    }
  }

  if (!categoryConfig) {
    return null;
  }

  const genreCandidates = collectFacetCandidates([
    ...typeValues,
    ...genreValues,
    ...fallbackValues,
  ]);

  for (const candidate of genreCandidates) {
    const matchedRule = resolveCategoryGenreRule(categoryConfig, candidate);
    if (matchedRule?.slug) {
      return {
        categoryConfig,
        slug: matchedRule.slug,
      };
    }
  }

  return {
    categoryConfig,
    slug: categoryConfig.rootSlug,
  };
}

function resolveChildAgeGenreSlug(age) {
  if (!Number.isFinite(age) || age < 0 || age > 17) {
    return null;
  }

  if (age <= 6) {
    return '/detskaya-afisha/for-kids-2-6/';
  }

  if (age <= 12) {
    return '/detskaya-afisha/midage-7-12/';
  }

  return '/detskaya-afisha/high-age-12/';
}

function shouldOmitCategoryFacetFromKeyword(value = '', routing = null) {
  const normalized = normalizeSearchFacetValue(value);
  if (!normalized || !routing?.categoryConfig) {
    return false;
  }

  // 1. Если это название текущей категории - убираем
  if (matchesCategoryType(routing.categoryConfig, normalized)) {
    return true;
  }

  // 2. Если это жанр текущей категории, который уже учтен в slug или корне категории - убираем
  const matchedRule = resolveCategoryGenreRule(routing.categoryConfig, normalized);
  if (matchedRule) {
    return matchedRule.slug === routing.slug || routing.slug === routing.categoryConfig.rootSlug;
  }

  // 3. Если это название или жанр ЛЮБОЙ ДРУГОЙ категории - убираем из keyword.
  // Поиск "чужой" категории внутри текущей в API Кассира обычно дает 0 результатов.
  const isOtherCategoryFacet = CATEGORY_SLUG_CONFIGS.some((config) => {
    if (config.key === routing.categoryConfig.key) return false;
    return matchesCategoryType(config, normalized) || resolveCategoryGenreRule(config, normalized);
  });

  if (isOtherCategoryFacet) {
    return true;
  }

  return false;
}

function buildEventCategorySearchText(event = {}) {
  const textParts = [
    event?.title,
    event?.description,
    event?.venue,
    event?.category,
    Array.isArray(event?.extraCategories) ? event.extraCategories.join(' ') : '',
    Array.isArray(event?.categories) ? event.categories.join(' ') : '',
    Array.isArray(event?.tags) ? event.tags.join(' ') : '',
  ];

  return normalizeSearchFacetValue(textParts.filter(Boolean).join(' '));
}

function isSeniorFriendlyTypeRequest(typeValue = '') {
  const normalized = normalizeSearchFacetValue(typeValue);
  if (!normalized) {
    return false;
  }

  return (
    /театр|спектак/u.test(normalized) ||
    /выставк/u.test(normalized) ||
    /музе/u.test(normalized) ||
    /экскурс/u.test(normalized) ||
    /концерт/u.test(normalized)
  );
}

function isSeniorFriendlyEventCandidate(event, slots = []) {
  const combinedText = buildEventCategorySearchText(event);
  if (!combinedText) {
    return false;
  }

  // Блокируем события с ограничением 18+ — они однозначно не подходят для пожилых
  const ageRestriction = event?.ageRestriction;
  if (ageRestriction) {
    const ageNum = parseInt(String(ageRestriction).replace(/[^0-9]/g, ''), 10);
    if (Number.isFinite(ageNum) && ageNum >= 18) {
      console.log(
        `👵 [isSeniorFriendlyEventCandidate] Блокирую событие с возрастным ограничением ${ageRestriction}: "${event?.title || ''}"`
      );
      return false;
    }
  }

  const typeSlot = (Array.isArray(slots) ? slots : []).find(
    (slot) =>
      slot &&
      (slot.name === 'тип_события' ||
        slot.name === 'тип_мероприятия' ||
        slot.name === 'категория') &&
      slot.value
  );
  const requestedType = normalizeSearchFacetValue(typeSlot?.value || '');

  const loudMarkers = [
    'рок',
    'rock',
    'рэп',
    'реп',
    'hip hop',
    'хип хоп',
    'хип-хоп',
    'trap',
    'трэп',
    'поп концерт',
    'поп-концерт',
    'поп-музык',
    'поп музыка',
    'эстрад',
    'клуб',
    'club',
    'рейв',
    'rave',
    'электрон',
    'техно',
    'панк',
    'metal',
    'метал',
    'стендап',
    'standup',
    'stand-up',
    'stand up',
    'стэнд ап',
    'комеди',
    'юмор',
    'слэм',
    'мма',
    'единобор',
    'футбол',
    'баскетбол',
    'автоспорт',
  ];
  const calmConcertMarkers = [
    'классик',
    'симфон',
    'оркестр',
    'джаз',
    'инструментальн',
    'камерн',
    'орган',
    'фортепиано',
    'струнн',
    'романс',
    'хор',
    'хоров',
    'творческ',
    'вокальн',
    'ретро',
    'неокласс',
    'опера',
    'балет',
    'филармон',
  ];
  const theaterMarkers = ['театр', 'спектак', 'постановк', 'опера', 'балет', 'мюзикл'];
  const exhibitionMarkers = ['выставк', 'экспозиц', 'галере', 'арт-простран', 'художествен'];
  const museumMarkers = ['музе', 'усадьб', 'историческ', 'мемориальн'];
  const excursionMarkers = ['экскурс', 'пешеходн', 'обзорн', 'театрализованн'];

  const hasLoudSignal = loudMarkers.some((marker) => combinedText.includes(marker));
  const hasTheaterSignal = theaterMarkers.some((marker) => combinedText.includes(marker));
  const hasExhibitionSignal = exhibitionMarkers.some((marker) => combinedText.includes(marker));
  const hasMuseumSignal = museumMarkers.some((marker) => combinedText.includes(marker));
  const hasExcursionSignal = excursionMarkers.some((marker) => combinedText.includes(marker));
  const hasCalmConcertSignal = calmConcertMarkers.some((marker) => combinedText.includes(marker));
  const hasSafeSignal =
    hasTheaterSignal ||
    hasExhibitionSignal ||
    hasMuseumSignal ||
    hasExcursionSignal ||
    hasCalmConcertSignal;

  if (/концерт/u.test(requestedType)) {
    return hasCalmConcertSignal && !hasLoudSignal;
  }

  if (/театр|спектак/u.test(requestedType)) {
    return hasTheaterSignal;
  }

  if (/выставк/u.test(requestedType)) {
    return hasExhibitionSignal;
  }

  if (/музе/u.test(requestedType)) {
    return hasMuseumSignal || hasExhibitionSignal;
  }

  if (/экскурс/u.test(requestedType)) {
    return hasExcursionSignal;
  }

  if (requestedType && !isSeniorFriendlyTypeRequest(requestedType)) {
    return !hasLoudSignal;
  }

  return hasSafeSignal && !hasLoudSignal;
}

function filterEventsBySeniorFriendlyContext(events, slots = []) {
  if (!Array.isArray(events) || events.length === 0) {
    return events;
  }

  if (!hasSeniorFriendlyContext(slots)) {
    return events;
  }

  const genreSlot = (Array.isArray(slots) ? slots : []).find(
    (slot) =>
      slot && ['жанр', 'жанр_музыки', 'предпочтения_жанры'].includes(slot.name) && slot.value
  );
  const strictNamedQuerySlot = (Array.isArray(slots) ? slots : []).find((slot) => {
    if (!slot || !['исполнитель', 'название_мероприятия'].includes(slot.name) || !slot.value) {
      return false;
    }
    if (slot.name === 'исполнитель' && isVagueArtistDescriptor(slot.value)) {
      return false;
    }
    return true;
  });
  const searchQuerySlot = (Array.isArray(slots) ? slots : []).find(
    (slot) => slot && slot.name === 'поисковый_запрос' && slot.value
  );
  const normalizedSearchQuery = normalizeSearchFacetValue(searchQuerySlot?.value || '');
  const hasSpecificSearchQuery = Boolean(
    normalizedSearchQuery &&
    normalizedSearchQuery !== 'все' &&
    normalizedSearchQuery !== 'покажи все' &&
    normalizedSearchQuery !== 'покажи всё'
  );

  if (genreSlot?.value || strictNamedQuerySlot?.value || hasSpecificSearchQuery) {
    return events;
  }

  const filtered = events.filter((event) => isSeniorFriendlyEventCandidate(event, slots));
  console.log(
    `👵 [filterEventsBySeniorFriendlyContext] Оставлено ${filtered.length} из ${events.length} событий`
  );
  return filtered;
}

function isPopularSelectionCandidate(candidate = null, searchPlan = null) {
  const popularSelectionSlug = normalizePageKitSlug(searchPlan?.popularSelectionSlug || '');
  const candidateSlug = normalizePageKitSlug(candidate?.params?.slug || '');
  return Boolean(popularSelectionSlug && candidateSlug && candidateSlug === popularSelectionSlug);
}

function isPopularSelectionBackfillCandidate(candidate = null) {
  return String(candidate?.source || '') === 'popular-selection-underfilled-general';
}

function hasPopularSelectionBackfillCandidate(candidates = []) {
  return (
    Array.isArray(candidates) &&
    candidates.some((candidate) => isPopularSelectionBackfillCandidate(candidate))
  );
}

function buildPopularSelectionBackfillCandidate(candidateParams = {}) {
  const params = {
    ...candidateParams,
    slug: DEFAULT_SLUG,
    isBroadSearch: true,
  };
  delete params.keyword;

  return {
    params,
    label: 'general-afisha-today-backfill',
    source: 'popular-selection-underfilled-general',
  };
}

function hasExplicitNamedTargetForSearch(slots = []) {
  return (
    Array.isArray(slots) &&
    slots.some((slot) => {
      if (!slot) return false;
      if (slot.isNegative) return false;
      const name = String(slot.name || '').trim();
      if (name !== 'исполнитель' && name !== 'название_мероприятия') {
        return false;
      }
      const slotValue = String(slot.value || '').trim();
      if (!slotValue) {
        return false;
      }
      if (
        name === 'исполнитель' &&
        (isVagueArtistDescriptor(slotValue) || isInvalidArtistSlotForStrictSearch(slotValue))
      ) {
        return false;
      }
      return true;
    })
  );
}

function hasChildAudienceSignal(slots = []) {
  return (
    Array.isArray(slots) &&
    slots.some((slot) => {
      if (!slot || slot.isNegative) return false;

      const slotName = String(slot.name || '').trim();
      const slotValue = String(slot.value || '')
        .toLowerCase()
        .replace(/ё/g, 'е')
        .trim();
      if (!slotValue) return false;

      if (slotName === 'возраст_ребенка') {
        return true;
      }

      if (slotName === 'возрастное_ограничение') {
        return slotValue.includes('дет') || slotValue.includes('ребен');
      }

      if (slotName === 'настроение') {
        return /детям|для\s*дет|детск|ребенк|малыш/u.test(slotValue);
      }

      return false;
    })
  );
}

function hasSeniorFriendlyContext(slots = []) {
  if (!Array.isArray(slots) || slots.length === 0) {
    return false;
  }

  const seniorMarkerSlot = slots.find(
    (slot) => slot && slot.name === 'аудитория_спутник' && slot.value
  );
  const contextSlot = slots.find((slot) => slot && slot.name === 'контекст_события' && slot.value);
  const audienceSlot = slots.find(
    (slot) => slot && slot.name === 'возрастное_ограничение' && slot.value
  );

  const seniorMarkerValue = String(seniorMarkerSlot?.value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .trim();
  const contextValue = String(contextSlot?.value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .trim();
  const audienceValue = String(audienceSlot?.value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .trim();

  return (
    seniorMarkerValue.includes('пожил') ||
    (contextValue === 'семейный' && audienceValue.includes('взросл'))
  );
}

function resolveMoodSearchRouting({ slots = [], fallbackQuery = '', keywordOverride = null } = {}) {
  const effectiveSlots = Array.isArray(slots) ? slots.filter(Boolean) : [];

  if (hasChildAudienceSignal(effectiveSlots)) {
    return null;
  }

  const moodSignal = resolveMoodSearchSignal({
    slots: effectiveSlots,
    fallbackQuery,
    keywordOverride,
  });
  if (
    !moodSignal?.profile ||
    !Array.isArray(moodSignal.profile.routes) ||
    moodSignal.profile.routes.length === 0
  ) {
    return null;
  }

  const familyContextActive = hasFamilyContextSignal(effectiveSlots);
  if (familyContextActive && moodSignal.profile.key !== 'fun') {
    return null;
  }

  if (hasSeniorFriendlyContext(effectiveSlots)) {
    return null;
  }

  if (hasExplicitNamedTargetForSearch(effectiveSlots)) {
    return null;
  }

  if (
    effectiveSlots.some((slot) => {
      if (!slot || slot.isNegative) return false;

      const slotName = String(slot.name || '').trim();
      if (
        slotName === 'тип_события' ||
        slotName === 'тип_мероприятия' ||
        slotName === 'категория'
      ) {
        return false;
      }
      if (!MOOD_ROUTING_BLOCKING_SLOT_NAMES.has(slotName)) {
        return false;
      }

      const slotValue = String(slot.value || '').trim();
      if (!slotValue) {
        return false;
      }

      if (slotName === 'поисковый_запрос') {
        return !isGenericMoodSearchQueryValue(slotValue);
      }

      return true;
    })
  ) {
    return null;
  }

  const explicitTypeSlot = effectiveSlots.find(
    (slot) =>
      slot &&
      !slot.isNegative &&
      (slot.name === 'тип_события' ||
        slot.name === 'тип_мероприятия' ||
        slot.name === 'категория') &&
      String(slot.value || '').trim().length > 0
  );
  const explicitCategoryConfig = explicitTypeSlot
    ? findCategoryConfigByType([explicitTypeSlot.value])
    : null;

  let filteredRoutes = moodSignal.profile.routes;
  const shouldRelaxExplicitCategoryRestriction = Boolean(
    familyContextActive &&
    moodSignal.profile.key === 'fun' &&
    FUN_MOOD_RELAXED_CATEGORY_KEYS.has(explicitCategoryConfig?.key || '')
  );
  if (explicitCategoryConfig && !shouldRelaxExplicitCategoryRestriction) {
    filteredRoutes = moodSignal.profile.routes.filter((route) => {
      const slug = String(route?.slug || '').toLowerCase();
      if (!slug) return false;

      switch (explicitCategoryConfig.key) {
        case 'concerts':
          return slug.includes('/bilety-na-koncert/');
        case 'theater':
          return slug.includes('/bilety-v-teatr/');
        case 'shows':
          return slug.includes('/bilety-na-shou/');
        case 'standup':
          return slug.includes('/bilety-na-standup/');
        case 'museums':
          return slug.includes('/bilety-v-muzei/');
        case 'exhibitions':
          return slug.includes('/vystavki/');
        case 'excursions':
          return slug.includes('/bilety-na-ekskursii/');
        case 'festivals':
          return slug.includes('/bilety-na-festival/');
        case 'sport':
          return slug.includes('/bilety-na-sportivnye-meropriyatiya/');
        case 'education':
          return slug.includes('/obrazovanie-i-kursy/');
        case 'children':
          return slug.includes('/detskaya-afisha/');
        case 'tourists':
          return slug.includes('/bilety-for-tourists/');
        default:
          return true;
      }
    });
  }

  if (!Array.isArray(filteredRoutes) || filteredRoutes.length === 0) {
    return null;
  }

  if (familyContextActive && moodSignal.profile.key === 'fun') {
    filteredRoutes = [...filteredRoutes].sort((left, right) => {
      const leftPriority = FAMILY_FUN_ROUTE_PRIORITY.get(left?.key) ?? Number.MAX_SAFE_INTEGER;
      const rightPriority = FAMILY_FUN_ROUTE_PRIORITY.get(right?.key) ?? Number.MAX_SAFE_INTEGER;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
      return String(left?.label || left?.key || '').localeCompare(
        String(right?.label || right?.key || '')
      );
    });
  }

  return {
    ...moodSignal.profile,
    routes: filteredRoutes,
    moodValue: moodSignal.normalizedMoodValue,
    primary: filteredRoutes[0],
    signalSource: moodSignal.source,
  };
}

function hasMoodSearchSignal(slots = []) {
  return Boolean(resolveMoodSearchSignal({ slots }));
}

function isFamilyContextValue(value = '') {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .trim();

  if (!normalized) {
    return false;
  }

  return normalized === 'семейный' || /семейн|семь(?:е|ей|ею|е|я)|family/u.test(normalized);
}

function hasFamilyContextSignal(slots = []) {
  if (!Array.isArray(slots) || slots.length === 0) {
    return false;
  }

  return slots.some((slot) => {
    if (!slot || slot.isNegative || slot.name !== 'контекст_события') {
      return false;
    }

    const slotValue = String(slot.value || '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .trim();

    return isFamilyContextValue(slotValue);
  });
}

function hasPopularSelectionBlockingSlot(
  slots = [],
  { allowDateSlot = false, allowBroadCategoryGenreSlots = false, allowMoodSlot = false } = {}
) {
  return (
    Array.isArray(slots) &&
    slots.some((slot) => {
      if (!slot || slot.isNegative) return false;

      const slotName = String(slot.name || '').trim();
      const slotValue = String(slot.value || '').trim();
      const hasStructuredDateOrTime = Boolean(slot.parsedDate || slot.dateRange || slot.timeRange);

      if (allowDateSlot && slotName === 'дата_события') {
        return false;
      }

      if (allowMoodSlot && slotName === 'настроение') {
        return false;
      }

      if (hasStructuredDateOrTime) {
        return true;
      }

      if (!slotValue) {
        return false;
      }

      if (
        allowBroadCategoryGenreSlots &&
        (slotName === 'жанр' || slotName === 'жанр_музыки' || slotName === 'предпочтения_жанры') &&
        isBroadCategoryFacetValue(slotValue)
      ) {
        return false;
      }

      if (
        (slotName === 'исполнитель' || slotName === 'артист') &&
        isVagueArtistDescriptor(slotValue)
      ) {
        return false;
      }

      return !ALLOWED_POPULAR_SELECTION_SLOT_NAMES.has(slotName);
    })
  );
}

function tokenizePopularSelectionText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
}

function isNeutralPopularSelectionToken(token = '') {
  if (!token) {
    return true;
  }

  if (GENERIC_POPULAR_REQUEST_TOKENS.has(token)) {
    return true;
  }

  if (/^\d+$/.test(token) || /^\d{1,2}:\d{2}$/u.test(token)) {
    return true;
  }

  return (
    token.startsWith('интересн') ||
    token.startsWith('популяр') ||
    token.startsWith('лучш') ||
    token.startsWith('классн') ||
    token.startsWith('хорош') ||
    token.startsWith('приколь') ||
    token.startsWith('концерт') ||
    token.startsWith('театр') ||
    token.startsWith('спектак') ||
    token.startsWith('выстав') ||
    token.startsWith('музе') ||
    token.startsWith('шоу') ||
    token.startsWith('фестив') ||
    token.startsWith('мероприят') ||
    token.startsWith('событ') ||
    token.startsWith('вариант') ||
    token.startsWith('подборк')
  );
}

function isGenericPopularSelectionText(text = '', city = '') {
  const normalizedText = String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .trim();

  if (!normalizedText) {
    return true;
  }

  // "Должен приехать популярный артист, не помню кто" names no concrete target, so the
  // city's popular selection is the best available search.
  if (looksLikeUnknownArtistDiscoveryText(normalizedText)) {
    return true;
  }

  const cityTokenRoots = new Set(
    tokenizePopularSelectionText(city)
      .map((token) => token.slice(0, Math.min(token.length, 4)))
      .filter(Boolean)
  );
  const meaningfulTokens = tokenizePopularSelectionText(normalizedText)
    .filter((token) => !cityTokenRoots.has(token.slice(0, Math.min(token.length, 4))))
    .filter((token) => !isNeutralPopularSelectionToken(token));

  return meaningfulTokens.length === 0;
}

function hasExplicitBroadPopularSelectionMarker(text = '') {
  const normalizedText = String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .trim();

  if (!normalizedText) {
    return false;
  }

  return (
    /(?:^|\s)(?:популяр|лучш|интересн|классн|хорош|приколь|подборк|вариант|афиш|посовет|рекоменд)/u.test(
      normalizedText
    ) ||
    /(?:^|[^\p{L}\p{N}])(?:мероприят[\p{L}\p{N}_]*|событ[\p{L}\p{N}_]*|досуг)(?=$|[^\p{L}\p{N}])/u.test(
      normalizedText
    ) ||
    /что[\s-]*то/u.test(normalizedText) ||
    /что[\s-]*нибудь/u.test(normalizedText) ||
    /куда\s+сход/u.test(normalizedText) ||
    /что\s+(?:можно\s+)?посет/u.test(normalizedText)
  );
}

function getMentionedBroadCategoryKeysFromText(text = '') {
  const candidates = collectFacetCandidates([text]);
  if (candidates.length === 0) {
    return new Set();
  }

  const ignoredCategoryKeys = new Set(['sale']);
  const categoryKeys = new Set();

  CATEGORY_SLUG_CONFIGS.forEach((categoryConfig) => {
    if (!categoryConfig?.key || ignoredCategoryKeys.has(categoryConfig.key)) {
      return;
    }

    const hasMatch = candidates.some(
      (candidate) =>
        matchesCategoryType(categoryConfig, candidate) ||
        Boolean(resolveCategoryGenreRule(categoryConfig, candidate))
    );

    if (hasMatch) {
      categoryKeys.add(categoryConfig.key);
    }
  });

  return categoryKeys;
}

function isBroadCategoryFacetValue(value = '') {
  return getMentionedBroadCategoryKeysFromText(value).size > 0;
}

function hasBroadGeneralEventSelectionText(text = '') {
  return hasExplicitBroadPopularSelectionMarker(text);
}

function hasBroadMultiCategorySelectionText(text = '') {
  const normalizedText = String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .trim();

  if (!normalizedText || !hasBroadGeneralEventSelectionText(normalizedText)) {
    return false;
  }

  const mentionedCategoryKeys = getMentionedBroadCategoryKeysFromText(normalizedText);
  return (
    mentionedCategoryKeys.size >= 2 ||
    /(?:или|и)\s+друг[\p{L}\p{N}_]*\s+(?:интересн[\p{L}\p{N}_]*\s+)?(?:событ|мероприят|вариант|афиш)/u.test(
      normalizedText
    )
  );
}

function hasBroadPopularSelectionIntent({
  city = '',
  textCandidates = [],
  hasCategorySignal = false,
} = {}) {
  if (!Array.isArray(textCandidates) || textCandidates.length === 0) {
    return !hasCategorySignal;
  }

  const looksBroad = textCandidates.every((text) => isGenericPopularSelectionText(text, city));
  if (!looksBroad) {
    return false;
  }

  if (hasCategorySignal) {
    return textCandidates.some((text) => hasExplicitBroadPopularSelectionMarker(text));
  }

  return true;
}

function hasCategorySpecificPopularSortRequest(textCandidates = []) {
  if (!Array.isArray(textCandidates) || textCandidates.length === 0) {
    return false;
  }

  return textCandidates.some((text) => {
    const normalizedText = String(text || '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .trim();

    if (!normalizedText || !/(?:^|[^\p{L}\p{N}])(?:популяр|лучш)/u.test(normalizedText)) {
      return false;
    }

    if (
      !/(?:^|[^\p{L}\p{N}])(?:концерт\p{L}*|театр\p{L}*|спектакл\p{L}*|пьес\p{L}*|опера|оперн\p{L}*|балет\p{L}*|мюзикл\p{L}*|выставк\p{L}*|музе[йяи]\p{L}*|ст[эе]ндап\p{L}*|шоу|цирк\p{L}*|фестивал\p{L}*|спорт\p{L}*|матч\p{L}*|кино|фильм\p{L}*|экскурс\p{L}*|квиз\p{L}*)(?=$|[^\p{L}\p{N}])/u.test(
        normalizedText
      )
    ) {
      return false;
    }

    return getMentionedBroadCategoryKeysFromText(normalizedText).size === 1;
  });
}

function resolvePopularCitySelectionSlug({
  slots = [],
  fallbackQuery = '',
  keywordOverride = null,
  userMessage = '',
} = {}) {
  const effectiveSlots = Array.isArray(slots) ? slots.filter(Boolean) : [];
  const searchQuerySlotValue =
    effectiveSlots.find((slot) => !slot.isNegative && slot.name === 'поисковый_запрос')?.value ||
    '';
  const textCandidates = [keywordOverride, searchQuerySlotValue, fallbackQuery, userMessage]
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);
  const hasBroadGeneralText = textCandidates.some((text) =>
    hasBroadGeneralEventSelectionText(text)
  );
  const hasBroadMultiCategoryText = textCandidates.some((text) =>
    hasBroadMultiCategorySelectionText(text)
  );

  if (hasChildAudienceSignal(effectiveSlots)) {
    return null;
  }

  if (hasSeniorFriendlyContext(effectiveSlots)) {
    return null;
  }

  // Если запрос явно широкий и мульти-категорийный (напр., "Какие мероприятия, концерты,
  // спектакли или другие интересные события можно посетить сегодня?"), то настроение
  // является попутным слотом, а не основным сигналом поиска — не блокируем популярную подборку.
  if (!hasBroadMultiCategoryText) {
    if (hasMoodSearchSignal(effectiveSlots)) {
      return null;
    }

    if (resolveMoodSearchRouting({ slots: effectiveSlots, fallbackQuery, keywordOverride })) {
      return null;
    }
  }

  if (
    hasPopularSelectionBlockingSlot(effectiveSlots, {
      allowDateSlot: hasBroadGeneralText,
      allowBroadCategoryGenreSlots: hasBroadMultiCategoryText,
      allowMoodSlot: hasBroadMultiCategoryText,
    })
  ) {
    return null;
  }

  const citySlot = effectiveSlots.find(
    (slot) => !slot.isNegative && slot.name === 'город' && String(slot.value || '').trim()
  );
  const city = normalizeCityValue(citySlot?.value || '');
  if (!city) {
    return null;
  }

  const domain = getDomainForCity(city);
  const selectionSlug = getPopularSelectionSlugForDomain(domain);
  if (!selectionSlug) {
    return null;
  }

  if (hasExplicitNamedTargetForSearch(effectiveSlots)) {
    return null;
  }

  const typeValues = effectiveSlots
    .filter(
      (slot) =>
        !slot.isNegative &&
        (slot.name === 'тип_события' ||
          slot.name === 'тип_мероприятия' ||
          slot.name === 'категория')
    )
    .map((slot) => slot.value);
  const genreValues = effectiveSlots
    .filter(
      (slot) =>
        !slot.isNegative &&
        (slot.name === 'жанр' || slot.name === 'жанр_музыки' || slot.name === 'предпочтения_жанры')
    )
    .map((slot) => slot.value);
  const routing = resolveCategorySearchRouting({
    typeValues,
    genreValues,
    fallbackValues: [fallbackQuery, keywordOverride, searchQuerySlotValue],
    isChildAudience: false,
  });

  const hasBroadPopularIntent = hasBroadPopularSelectionIntent({
    city,
    textCandidates,
    hasCategorySignal: Boolean(routing),
  });

  if (!hasBroadPopularIntent) {
    return null;
  }

  if (routing && hasCategorySpecificPopularSortRequest(textCandidates)) {
    return null;
  }

  if (routing) {
    return selectionSlug;
  }

  return selectionSlug;
}

function canUsePopularCitySelection(options = {}) {
  return Boolean(resolvePopularCitySelectionSlug(options));
}

export {
  findMoodSearchProfile,
  resolveMoodSearchSignal,
  normalizeSearchFacetValue,
  isGenericMoodSearchQueryValue,
  isPopularitySortOnlyValue,
  removePopularitySortOnlyTokens,
  isInvalidArtistSlotForStrictSearch,
  matchesCategoryType,
  findCategoryConfigByType,
  AMBIGUOUS_CATEGORY_SHOW_ALL_SLOT_NAME,
  getAmbiguousGenreShowAllRouteDefinitions,
  pruneBroadRootCandidatesWhenSpecificGenreSlugExists,
  resolveCategorySearchRouting,
  resolveChildAgeGenreSlug,
  shouldOmitCategoryFacetFromKeyword,
  buildEventCategorySearchText,
  isSeniorFriendlyEventCandidate,
  filterEventsBySeniorFriendlyContext,
  isPopularSelectionCandidate,
  isPopularSelectionBackfillCandidate,
  hasPopularSelectionBackfillCandidate,
  buildPopularSelectionBackfillCandidate,
  hasSeniorFriendlyContext,
  resolveMoodSearchRouting,
  isFamilyContextValue,
  hasFamilyContextSignal,
  hasBroadMultiCategorySelectionText,
  resolvePopularCitySelectionSlug,
  canUsePopularCitySelection,
};
