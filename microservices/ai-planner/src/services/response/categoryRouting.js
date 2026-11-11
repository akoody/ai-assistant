import {
  TAXONOMY_GENRE_ENTRIES,
  normalizeComparableCategoryValue,
  CATEGORY_BUTTON_LABELS,
  detectCategoryFromText,
  resolveTaxonomyGenreEntryByValue,
  resolveTaxonomyGenreEntryFromText,
  normalizeCategory,
} from './categoryDefinitions.js';
import { POPULAR_SELECTION_SHOW_ALL_BUTTON } from '../../../../../shared/popularSelectionCategories.js';
import { dedupeQuickReplyButtons } from '../quickButtonsService.js';
import {
  normalizeComparableSlotValue,
  BUDGET_SLOT_NAMES,
  removeSlotsByName,
  EVENT_TYPE_SLOT_NAMES,
} from './slotUtils.js';
import { normalizeSlotName } from '../slotsService.js';
import { isAuthoritativeOffTopicIntent } from './intentPolicy.js';
import { normalizeText } from './textUtils.js';
import {
  hasExplicitPreferenceSignal,
  hasNegativePreferenceCue,
  splitPreferenceChangeText as splitSharedPreferenceChangeText,
} from '../../../../../shared/preferenceRules.js';
import { inferClarificationTarget } from './clarificationTarget.js';
import {
  savePreference,
  saveDislikedPreference,
  PREFERENCE_TYPES,
  removeDislikedPreference,
} from '../userPreferencesService.js';

const CATEGORY_BUTTON_PRIORITY = new Map([
  ['театры', 10],
  ['концерты', 20],
  ['шоу', 30],
  ['детям', 40],
  ['выставки', 50],
  ['музеи', 60],
  ['туристам', 70],
  ['экскурсии', 80],
  ['образование', 90],
  ['фестивали', 100],
  ['кино', 110],
  ['квесты', 120],
  ['квизы', 130],
  ['праздники', 140],
  ['стендап', 150],
  ['стэндап', 150],
  ['спорт', 160],
]);

const AMBIGUOUS_TAXONOMY_CATEGORY_MAP = TAXONOMY_GENRE_ENTRIES.reduce((target, entry) => {
  for (const alias of entry.aliases) {
    if (!target.has(alias)) {
      target.set(alias, new Set());
    }
    target.get(alias).add(entry.normalizedCategory);
  }
  return target;
}, new Map());

const AMBIGUOUS_GENRE_SIGNAL_RULES = Object.freeze([
  { canonicalGenre: 'танец', categories: ['театры', 'концерты', 'шоу'], pattern: /танц/u },
  { canonicalGenre: 'цирк', categories: ['театры', 'шоу', 'детям'], pattern: /цирк/u },
  { canonicalGenre: 'клоунада', categories: ['театры', 'шоу', 'детям'], pattern: /клоунад/u },
  { canonicalGenre: 'юмор', categories: ['концерты', 'шоу'], pattern: /(юмор|юморист)/u },
]);

const GENRE_SLOT_NAMES = new Set(['жанр', 'жанр_музыки', 'предпочтения_жанры']);

const AMBIGUOUS_GENRE_SNAPSHOT_SOURCE = 'ambiguous_genre_context';

const AMBIGUOUS_CATEGORY_SHOW_ALL_SLOT_NAME = 'режим_поиска';

const AMBIGUOUS_CATEGORY_SHOW_ALL_SLOT_VALUE = 'ambiguous_category_show_all';

function getCategoryButtonLabelByValue(category = '') {
  const normalizedCategory = normalizeComparableCategoryValue(category);
  return CATEGORY_BUTTON_LABELS.get(normalizedCategory) || null;
}

function sortAmbiguousCategories(categories = []) {
  return Array.from(
    new Set(
      (Array.isArray(categories) ? categories : [])
        .map((category) => normalizeComparableCategoryValue(category))
        .filter(Boolean)
    )
  ).sort((left, right) => {
    const leftPriority = CATEGORY_BUTTON_PRIORITY.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightPriority = CATEGORY_BUTTON_PRIORITY.get(right) ?? Number.MAX_SAFE_INTEGER;

    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    return left.localeCompare(right, 'ru');
  });
}

function resolveAmbiguousGenreCategoryChoice({ slots = [], userMessage = '' } = {}) {
  if (detectCategoryFromText(userMessage)) {
    return null;
  }

  const normalizedUserMessage = normalizeComparableSlotValue(userMessage);
  const candidateSources = [];

  (Array.isArray(slots) ? slots : []).forEach((slot) => {
    if (!slot || !slot.name || slot.value === undefined || slot.value === null) {
      return;
    }

    if (!GENRE_SLOT_NAMES.has(slot.name) && slot.name !== 'поисковый_запрос') {
      return;
    }

    candidateSources.push(String(slot.value));
  });

  if (normalizedUserMessage) {
    candidateSources.push(userMessage);
  }

  for (const sourceValue of candidateSources) {
    const normalizedSource = normalizeComparableSlotValue(sourceValue);
    if (!normalizedSource) {
      continue;
    }

    const exactCategories = AMBIGUOUS_TAXONOMY_CATEGORY_MAP.get(normalizedSource);
    if (exactCategories && exactCategories.size > 1) {
      const categories = sortAmbiguousCategories(Array.from(exactCategories));
      if (categories.length > 1) {
        return {
          genre: normalizedSource,
          categories,
          buttons: dedupeQuickReplyButtons([
            ...categories
              .map((category) => getCategoryButtonLabelByValue(category))
              .filter(Boolean),
            POPULAR_SELECTION_SHOW_ALL_BUTTON,
          ]),
        };
      }
    }
  }

  for (const rule of AMBIGUOUS_GENRE_SIGNAL_RULES) {
    const hasRuleMatch = candidateSources.some((sourceValue) =>
      rule.pattern.test(normalizeComparableSlotValue(sourceValue))
    );
    if (!hasRuleMatch) {
      continue;
    }

    const categories = sortAmbiguousCategories(rule.categories);
    if (categories.length <= 1) {
      continue;
    }

    return {
      genre: rule.canonicalGenre,
      categories,
      buttons: dedupeQuickReplyButtons([
        ...categories.map((category) => getCategoryButtonLabelByValue(category)).filter(Boolean),
        POPULAR_SELECTION_SHOW_ALL_BUTTON,
      ]),
    };
  }

  return null;
}

function buildAmbiguousGenreCategoryClarificationResponse({
  genre = '',
  buttons = [],
  knownCity = '',
} = {}) {
  const resolvedGenre = String(genre || '').trim();
  const resolvedCity = String(knownCity || '').trim();
  const citySuffix = resolvedCity ? ` в ${resolvedCity}` : '';

  return {
    message: `Жанр "${resolvedGenre}" встречается в нескольких категориях${citySuffix}. Что вам ближе или показать все?`,
    buttons: dedupeQuickReplyButtons(Array.isArray(buttons) ? buttons : []),
    offer: null,
  };
}

function getAmbiguousGenreContextSlot(slots = []) {
  const snapshotSlot = (Array.isArray(slots) ? slots : []).find(
    (slot) =>
      slot &&
      GENRE_SLOT_NAMES.has(String(slot.name || '').trim()) &&
      slot.source === AMBIGUOUS_GENRE_SNAPSHOT_SOURCE &&
      String(slot.value || '').trim()
  );

  if (!snapshotSlot) {
    return null;
  }

  return {
    ...snapshotSlot,
    name: normalizeSlotName(String(snapshotSlot.name).trim()),
    value: String(snapshotSlot.value).trim(),
  };
}

function resolveLocalCategoryForRouting(userMessage, offTopicIntent = null) {
  const detectedCategory = detectCategoryFromText(userMessage);
  if (!detectedCategory) {
    return null;
  }

  return isAuthoritativeOffTopicIntent(offTopicIntent) ? null : detectedCategory;
}

function detectFestivalGenreFromText(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }

  const normalized = normalizeText(text);
  if (!normalized) {
    return null;
  }

  if (
    /open\s*air/u.test(normalized) ||
    /опен[\s-]?эйр/u.test(normalized) ||
    /на\s+природ/u.test(normalized) ||
    /на\s+улиц/u.test(normalized) ||
    /на\s+(?:открытом|свежем)\s+воздух/u.test(normalized) ||
    /под\s+открытым\s+(?:небом|воздухом)/u.test(normalized)
  ) {
    return 'опен эйр';
  }

  if (/музыкальн.*фестив/u.test(normalized) || /фестив.*музыкальн/u.test(normalized)) {
    return 'музыкальные фестивали';
  }

  return null;
}

function detectTheaterGenreFromText(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }

  const normalized = normalizeText(text);
  if (!normalized) {
    return null;
  }

  if (
    /(^|[^\p{L}\p{N}_])опер(?:а|ы|у|е|ой|ою|ный|ная|ное|ные|ного|ному|ным|ных)(?=$|[^\p{L}\p{N}_])/u.test(
      normalized
    )
  )
    return 'опера';
  if (
    /(^|[^\p{L}\p{N}_])балет(?:а|у|ом|е|ы|ный|ная|ное|ные|ного|ному|ным|ных)?(?=$|[^\p{L}\p{N}_])/u.test(
      normalized
    )
  )
    return 'балет';
  if (
    /(^|[^\p{L}\p{N}_])мюзикл(?:а|у|ом|е|ы|ный|ная|ное|ные|ного|ному|ным|ных)?(?=$|[^\p{L}\p{N}_])/u.test(
      normalized
    )
  )
    return 'мюзикл';
  if (/кукольн/u.test(normalized)) return 'кукольный театр';
  if (/иммерсив/u.test(normalized)) return 'иммерсивный спектакль';
  if (/моноспект/u.test(normalized)) return 'моноспектакль';
  if (/(^|[^\p{L}\p{N}_])спектакл[\p{L}]*(?=$|[^\p{L}\p{N}_])/u.test(normalized))
    return 'спектакли';
  if (/трагикомед/u.test(normalized)) return 'трагикомедия';
  if (/мелодрам/u.test(normalized)) return 'мелодрама';
  if (/сказк/u.test(normalized)) return 'сказка';
  if (/драм/u.test(normalized)) return 'драма';
  if (/комед/u.test(normalized)) return 'комедия';
  if (/гастрол/u.test(normalized)) return 'гастроли';
  if (/танц|балет.*танец/u.test(normalized)) return 'танец';

  return null;
}

function detectConcertGenreFromText(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }

  const normalized = normalizeText(text);
  if (!normalized) {
    return null;
  }

  const explicitTheaterGenre = detectTheaterGenreFromText(normalized);
  const hasExplicitConcertContext =
    /(?:^|[^\p{L}\p{N}_])(?:концерт[\p{L}\p{N}_]*|музык[\p{L}\p{N}_]*|оркестр[\p{L}\p{N}_]*|филармон[\p{L}\p{N}_]*|live|dj)(?=$|[^\p{L}\p{N}_])/u.test(
      normalized
    );
  if (explicitTheaterGenre && !hasExplicitConcertContext) {
    return null;
  }

  if (/(классик|симфон|академическ)/u.test(normalized)) {
    return { slotName: 'жанр_музыки', value: 'классика' };
  }
  if (/(^|[^\p{L}\p{N}])(?:rock|рок)(?=$|[^\p{L}\p{N}])|рок[-\s]?н[-\s]?рол/u.test(normalized)) {
    return { slotName: 'жанр_музыки', value: 'рок' };
  }
  if (/(^|[^\p{L}\p{N}])(?:pop|поп)(?=$|[^\p{L}\p{N}])|попс|эстрад/u.test(normalized)) {
    return { slotName: 'жанр_музыки', value: 'поп' };
  }
  if (/(^|[^\p{L}\p{N}])(?:jazz|джаз)(?=$|[^\p{L}\p{N}])/u.test(normalized)) {
    return { slotName: 'жанр_музыки', value: 'джаз' };
  }
  if (/(folk|фолк|народн|этно)/u.test(normalized)) {
    return { slotName: 'жанр_музыки', value: 'фолк' };
  }
  if (/(шансон|романс|авторск|бард)/u.test(normalized)) {
    return { slotName: 'жанр_музыки', value: 'шансон' };
  }
  if (/(рэп|реп|хип[\s-]?хоп|hip[\s-]?hop|трэп|trap)/u.test(normalized)) {
    return { slotName: 'жанр_музыки', value: 'рэп' };
  }
  if (
    /(электрон|электроник|(^|[^\p{L}\p{N}])электро(?=$|[^\p{L}\p{N}])|edm|техно|techno|house|хаус)/u.test(
      normalized
    )
  ) {
    return { slotName: 'жанр_музыки', value: 'электронная музыка' };
  }
  if (/(металл?|metal|хэви|heavy|death|thrash)/u.test(normalized)) {
    return { slotName: 'жанр_музыки', value: 'металл' };
  }
  if (/(инструментальн|instrumental|без\s+слов)/u.test(normalized)) {
    return { slotName: 'жанр_музыки', value: 'инструментальная музыка' };
  }
  if (/творческ.*(?:вечер|встреч)/u.test(normalized)) {
    return { slotName: 'жанр', value: 'творческий вечер' };
  }
  if (/клуб(?:н|ы|ах|ам|ами|е|ов)?/u.test(normalized)) {
    return { slotName: 'жанр', value: 'клубы' };
  }
  if (/(юморист|юмор|комеди|смешн)/u.test(normalized)) {
    return { slotName: 'жанр', value: 'юмористический' };
  }
  if (/(танцев|dance)/u.test(normalized)) {
    return { slotName: 'жанр', value: 'танцевальный' };
  }
  if (/(^|[^\p{L}\p{N}_])(?:show|шоу)(?=$|[^\p{L}\p{N}_])|шоу.*программ/u.test(normalized)) {
    return { slotName: 'жанр', value: 'шоу' };
  }

  return null;
}

function detectShowGenreFromText(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }

  const normalized = normalizeText(text);
  if (!normalized) {
    return null;
  }

  if (/(цирк|цирков|клоунад|клоун)/u.test(normalized)) {
    return 'цирк';
  }
  if (/спортивн.*шоу/u.test(normalized)) {
    return 'спортивное шоу';
  }
  if (/(юмор|юморист|комеди)/u.test(normalized)) {
    return 'юмор';
  }
  if (/(^|[^\p{L}\p{N}])ст[еэ]ндап(?=$|[^\p{L}\p{N}])/u.test(normalized)) {
    return 'стендап';
  }
  if (/(танц|dance)/u.test(normalized)) {
    return 'танец';
  }

  return null;
}

function inferDirectPreferenceChange(userMessage = '', slots = []) {
  const DIRECT_INFERENCE_SLOT_NAMES = new Set([
    'тип_мероприятия',
    'тип_события',
    'жанр',
    'жанр_музыки',
    'предпочтения_жанры',
  ]);
  const normalizedSlots = Array.isArray(slots) ? slots.filter(Boolean) : [];
  const normalizedMessage = normalizeText(userMessage);
  const hasDirectPreferenceLanguage =
    hasNegativePreferenceCue(normalizedMessage) ||
    hasExplicitPreferenceSignal(normalizedMessage) ||
    /(?:^|[^\p{L}\p{N}_])теперь(?=$|[^\p{L}\p{N}_])/u.test(normalizedMessage);

  if (!hasDirectPreferenceLanguage) {
    return {
      fullText: normalizedMessage,
      negativePart: '',
      positivePart: '',
      dislikedGenres: [],
      dislikedEventTypes: [],
      preferredGenre: null,
      preferredEventType: null,
      hasAnyUpdates: false,
      canApplyDirectly: false,
      shouldPersistPositivePreference: false,
    };
  }

  if (shouldSuppressDirectPreferenceInferenceForBroadDiscovery(userMessage)) {
    return {
      fullText: normalizedMessage,
      negativePart: '',
      positivePart: '',
      dislikedGenres: [],
      dislikedEventTypes: [],
      preferredGenre: null,
      preferredEventType: null,
      hasAnyUpdates: false,
      canApplyDirectly: false,
      shouldPersistPositivePreference: false,
    };
  }

  const canInferGenresOrCategoriesFromText = normalizedSlots.some(
    (slot) => slot && DIRECT_INFERENCE_SLOT_NAMES.has(String(slot.name || '').trim())
  );

  const { fullText, negativePart, positivePart } = splitSharedPreferenceChangeText(userMessage, {
    hasPositiveTargetSignal: (clauseText) =>
      canInferGenresOrCategoriesFromText &&
      Boolean(
        detectTheaterGenreFromText(clauseText) ||
        detectConcertGenreFromText(clauseText)?.value ||
        detectCategoryFromText(clauseText)
      ),
  });

  const dislikedConcertGenre =
    negativePart && canInferGenresOrCategoriesFromText
      ? detectConcertGenreFromText(negativePart)?.value || null
      : null;
  const dislikedTheaterGenre =
    negativePart && canInferGenresOrCategoriesFromText
      ? detectTheaterGenreFromText(negativePart)
      : null;
  const dislikedGenre = dislikedTheaterGenre || dislikedConcertGenre || null;

  let dislikedEventType = null;
  if (!dislikedGenre && negativePart) {
    const negativeEventTypeSlot = normalizedSlots.find(
      (slot) =>
        slot &&
        (slot.name === 'тип_мероприятия' || slot.name === 'тип_события') &&
        negativePart.includes(normalizeText(slot.value))
    );
    dislikedEventType = normalizeCategory(
      negativeEventTypeSlot?.value ||
        (canInferGenresOrCategoriesFromText ? detectCategoryFromText(negativePart) : '') ||
        ''
    );
  }

  const preferredTheaterGenre =
    positivePart && canInferGenresOrCategoriesFromText
      ? detectTheaterGenreFromText(positivePart)
      : null;
  const preferredConcertGenre =
    positivePart && canInferGenresOrCategoriesFromText
      ? detectConcertGenreFromText(positivePart)?.value || null
      : null;
  let preferredGenre = preferredTheaterGenre || preferredConcertGenre || null;

  let preferredEventType = null;
  if (positivePart) {
    const positiveEventTypeSlot = normalizedSlots.find(
      (slot) =>
        slot &&
        (slot.name === 'тип_мероприятия' || slot.name === 'тип_события') &&
        (positivePart.includes(normalizeText(slot.value)) || !preferredGenre)
    );

    preferredEventType = normalizeCategory(
      positiveEventTypeSlot?.value ||
        (canInferGenresOrCategoriesFromText ? detectCategoryFromText(positivePart) : '') ||
        (preferredTheaterGenre ? 'театры' : preferredConcertGenre ? 'концерты' : '')
    );
  }

  if (preferredGenre) {
    const taxonomyPreferredGenreEntry =
      resolveTaxonomyGenreEntryByValue(preferredGenre, {
        preferredCategory: preferredEventType || '',
      }) ||
      resolveTaxonomyGenreEntryByValue(preferredGenre) ||
      resolveTaxonomyGenreEntryFromText(preferredGenre, {
        preferredCategory: preferredEventType || '',
      }) ||
      resolveTaxonomyGenreEntryFromText(preferredGenre);

    if (taxonomyPreferredGenreEntry) {
      preferredGenre = taxonomyPreferredGenreEntry.genre;
      preferredEventType =
        normalizeCategory(taxonomyPreferredGenreEntry.category) || preferredEventType || null;
    }
  }

  const dislikedGenres = dislikedGenre && dislikedGenre !== preferredGenre ? [dislikedGenre] : [];
  const dislikedEventTypes =
    dislikedEventType && dislikedEventType !== preferredEventType ? [dislikedEventType] : [];
  const hasAnyUpdates = Boolean(
    dislikedGenres.length || dislikedEventTypes.length || preferredGenre || preferredEventType
  );
  const canApplyDirectly = Boolean(preferredGenre || preferredEventType);
  const shouldPersistPositivePreference = Boolean(
    positivePart &&
    (hasExplicitPreferenceSignal(positivePart) ||
      /(?:теперь\s+)?предпочитаю(?![A-Za-zА-Яа-яЁё0-9_])/u.test(positivePart))
  );

  return {
    fullText,
    negativePart,
    positivePart,
    dislikedGenres,
    dislikedEventTypes,
    preferredGenre,
    preferredEventType: preferredEventType || null,
    hasAnyUpdates,
    canApplyDirectly,
    shouldPersistPositivePreference,
  };
}

function shouldSuppressDirectPreferenceInferenceForBroadDiscovery(userMessage = '') {
  const normalized = normalizeText(userMessage);
  if (!normalized) {
    return false;
  }

  const hasPreferenceLanguage =
    /(?:^|[^\p{L}\p{N}])(?:предпочитаю|люблю|нравит|не\s+люблю|не\s+нравит|больше\s+не|теперь)(?=$|[^\p{L}\p{N}])/u.test(
      normalized
    );
  if (hasPreferenceLanguage) {
    return false;
  }

  const hasBroadDiscoveryMarker =
    /(?:^|[^\p{L}\p{N}])(?:мероприят[\p{L}\p{N}_]*|событ[\p{L}\p{N}_]*|афиш[\p{L}\p{N}_]*|интересн[\p{L}\p{N}_]*|вариант[\p{L}\p{N}_]*|досуг)(?=$|[^\p{L}\p{N}])/u.test(
      normalized
    ) ||
    /куда\s+сход/u.test(normalized) ||
    /что\s+(?:можно\s+)?посет/u.test(normalized);
  if (!hasBroadDiscoveryMarker) {
    return false;
  }

  const mentionedCategories = new Set();
  if (
    /(?:^|[^\p{L}\p{N}])(?:концерт[\p{L}\p{N}_]*|музык[\p{L}\p{N}_]*)(?=$|[^\p{L}\p{N}])/u.test(
      normalized
    )
  ) {
    mentionedCategories.add('концерты');
  }
  if (
    /(?:^|[^\p{L}\p{N}])(?:театр[\p{L}\p{N}_]*|спектакл[\p{L}\p{N}_]*)(?=$|[^\p{L}\p{N}])/u.test(
      normalized
    )
  ) {
    mentionedCategories.add('театры');
  }
  if (
    /(?:^|[^\p{L}\p{N}])(?:выставк[\p{L}\p{N}_]*|музе[\p{L}\p{N}_]*|шоу|ст[еэ]ндап[\p{L}\p{N}_]*|фестивал[\p{L}\p{N}_]*|экскурс[\p{L}\p{N}_]*|квиз[\p{L}\p{N}_]*|квест[\p{L}\p{N}_]*|спорт[\p{L}\p{N}_]*)(?=$|[^\p{L}\p{N}])/u.test(
      normalized
    )
  ) {
    mentionedCategories.add('другое');
  }

  return (
    mentionedCategories.size >= 2 ||
    /(?:или|и)\s+друг[\p{L}\p{N}_]*\s+(?:интересн[\p{L}\p{N}_]*\s+)?(?:событ|мероприят|вариант|афиш)/u.test(
      normalized
    )
  );
}

function resolveExplicitAnySelection({
  normalizedUserMessage = '',
  lastAssistantButtons = [],
} = {}) {
  const normalized = normalizeText(normalizedUserMessage);
  const clarificationTarget = inferClarificationTarget({ buttons: lastAssistantButtons });

  const isExplicitAnyBudget =
    normalized === 'любой бюджет' ||
    normalized === 'любая цена' ||
    ((normalized === 'любой' || normalized === 'не важно') && clarificationTarget === 'budget');

  const isExplicitAnyGenre = normalized === 'любой' && clarificationTarget === 'genre';
  const isExplicitAnyDate =
    normalized === 'любая дата' || (normalized === 'любая' && clarificationTarget === 'date');

  return {
    clarificationTarget,
    isExplicitAnyBudget,
    isExplicitAnyGenre,
    isExplicitAnyDate,
  };
}

function applyExplicitAnyBudgetSelectionToSlots(slots = [], explicitSlot = null) {
  const cleanedSlots = removeSlotsByName(Array.isArray(slots) ? slots : [], BUDGET_SLOT_NAMES);
  const canonicalAnyBudgetSlot = {
    name: 'бюджет',
    value: 'любой',
    confidence: explicitSlot?.confidence ?? 1.0,
    source: explicitSlot?.source || 'explicit_any_budget',
  };

  return [...cleanedSlots, canonicalAnyBudgetSlot];
}

async function persistDirectPreferenceChange(userId, change = null) {
  if (!userId || !change?.hasAnyUpdates) {
    return;
  }

  const dislikedGenres = Array.isArray(change.dislikedGenres)
    ? [...new Set(change.dislikedGenres.filter(Boolean))]
    : [];
  const dislikedEventTypes = Array.isArray(change.dislikedEventTypes)
    ? [...new Set(change.dislikedEventTypes.filter(Boolean))]
    : [];

  for (const genre of dislikedGenres) {
    await saveDislikedPreference(userId, PREFERENCE_TYPES.GENRE, genre);
  }

  for (const eventType of dislikedEventTypes) {
    await saveDislikedPreference(userId, PREFERENCE_TYPES.EVENT_TYPE, eventType);
  }

  if (change.shouldPersistPositivePreference && change.preferredGenre) {
    await savePreference(userId, PREFERENCE_TYPES.GENRE, change.preferredGenre);
  }

  if (change.shouldPersistPositivePreference && change.preferredEventType) {
    await savePreference(userId, PREFERENCE_TYPES.EVENT_TYPE, change.preferredEventType);
  }
}

async function reconcileDirectSearchTargetWithDislikes(userId, change = null) {
  if (!userId || !change?.canApplyDirectly) {
    return false;
  }

  let modified = false;

  if (change.preferredGenre) {
    await removeDislikedPreference(userId, PREFERENCE_TYPES.GENRE, change.preferredGenre);
    modified = true;
  }

  if (change.preferredEventType) {
    await removeDislikedPreference(userId, PREFERENCE_TYPES.EVENT_TYPE, change.preferredEventType);
    modified = true;
  }

  return modified;
}

function buildImmediateSearchSlotsFromPreferenceChange(change = null) {
  if (!change?.canApplyDirectly) {
    return [];
  }

  const slots = [];
  if (change.preferredEventType) {
    slots.push({
      name: 'тип_мероприятия',
      value: change.preferredEventType,
      confidence: 0.97,
      source: 'change_preferences_search_target',
    });
  }

  if (change.preferredGenre) {
    const genreSlotName = change.preferredEventType === 'концерты' ? 'жанр_музыки' : 'жанр';
    slots.push({
      name: genreSlotName,
      value: change.preferredGenre,
      confidence: 0.97,
      source: 'change_preferences_search_target',
    });
  }

  return slots;
}

function applyImmediateSearchSlotsFromPreferenceChange(existingSlots = [], searchTargetSlots = []) {
  const baseSlots = Array.isArray(existingSlots) ? existingSlots.filter(Boolean) : [];
  const targetSlots = Array.isArray(searchTargetSlots) ? searchTargetSlots.filter(Boolean) : [];

  if (targetSlots.length === 0) {
    return baseSlots;
  }

  const targetEventTypeSlot = targetSlots.find((slot) =>
    EVENT_TYPE_SLOT_NAMES.has(String(slot?.name || '').trim())
  );
  const targetEventTypeValue = normalizeCategory(targetEventTypeSlot?.value || '');
  const filteredSlots = baseSlots.filter((slot) => {
    const slotName = String(slot?.name || '').trim();
    if (!slotName) return false;

    if (EVENT_TYPE_SLOT_NAMES.has(slotName)) {
      return false;
    }

    if (
      targetEventTypeValue === 'театры' &&
      (slotName === 'жанр_музыки' || slotName === 'предпочтения_жанры')
    ) {
      return false;
    }

    if (targetEventTypeValue === 'концерты' && slotName === 'жанр') {
      return false;
    }

    return true;
  });

  return [...filteredSlots, ...targetSlots];
}

function detectCircusGenreFromText(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }

  const normalized = normalizeText(text);
  if (!normalized) {
    return null;
  }

  if (/(цирк|цирков|клоунад)/u.test(normalized)) {
    return 'цирк';
  }

  return null;
}

function detectChildrenGenreFromText(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }

  const normalized = normalizeText(text);
  if (!normalized) {
    return null;
  }

  if (/детск.*мюзикл/u.test(normalized) || /мюзикл.*для\s*дет/u.test(normalized)) {
    return 'детские мюзиклы';
  }
  if (/детск.*концерт/u.test(normalized) || /концерт.*для\s*дет/u.test(normalized)) {
    return 'детские концерты';
  }
  if (
    /детск.*спектак/u.test(normalized) ||
    /спектак.*для\s*дет/u.test(normalized) ||
    /кукольн/u.test(normalized)
  ) {
    return 'детские спектакли';
  }
  if (/детск.*шоу/u.test(normalized) || /шоу.*для\s*дет/u.test(normalized)) {
    return 'детские шоу';
  }
  if (/(цирк|цирков|клоунад|клоун)/u.test(normalized)) {
    return 'цирк / клоунада';
  }
  if (
    /малыш/u.test(normalized) ||
    /дошкольн/u.test(normalized) ||
    /2\s*[- ]\s*6/u.test(normalized) ||
    /(?:от\s*)?2\s*(?:до|по)\s*6/u.test(normalized)
  ) {
    return 'малышам';
  }
  if (
    /7\s*[- ]\s*12/u.test(normalized) ||
    /(?:от\s*)?7\s*(?:до|по)\s*12/u.test(normalized) ||
    /младш.*средн/u.test(normalized) ||
    /школьник/u.test(normalized)
  ) {
    return 'для младшего и среднего возраста';
  }
  if (
    /от\s*12/u.test(normalized) ||
    /12\+/u.test(normalized) ||
    /старш.*(?:возраст|12)/u.test(normalized) ||
    /подростк/u.test(normalized)
  ) {
    return 'для старшего возраста';
  }
  if (/(?<![A-Za-zА-Яа-яЁё0-9_])друго[еий](?![A-Za-zА-Яа-яЁё0-9_])/u.test(normalized)) {
    return 'другое';
  }

  return null;
}

export {
  GENRE_SLOT_NAMES,
  AMBIGUOUS_GENRE_SNAPSHOT_SOURCE,
  AMBIGUOUS_CATEGORY_SHOW_ALL_SLOT_NAME,
  AMBIGUOUS_CATEGORY_SHOW_ALL_SLOT_VALUE,
  resolveAmbiguousGenreCategoryChoice,
  buildAmbiguousGenreCategoryClarificationResponse,
  getAmbiguousGenreContextSlot,
  resolveLocalCategoryForRouting,
  detectFestivalGenreFromText,
  detectTheaterGenreFromText,
  detectConcertGenreFromText,
  detectShowGenreFromText,
  inferDirectPreferenceChange,
  resolveExplicitAnySelection,
  applyExplicitAnyBudgetSelectionToSlots,
  persistDirectPreferenceChange,
  reconcileDirectSearchTargetWithDislikes,
  buildImmediateSearchSlotsFromPreferenceChange,
  applyImmediateSearchSlotsFromPreferenceChange,
  detectCircusGenreFromText,
  detectChildrenGenreFromText,
};
