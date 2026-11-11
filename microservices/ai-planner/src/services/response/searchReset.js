import { normalizeText } from './textUtils.js';
import {
  SENIOR_COMPANION_MARKER_SLOT_NAME,
  SENIOR_COMPANION_MARKER_VALUE,
  SLOT_LIKE_INTENT_SLOT_NAMES,
  FRESH_SEARCH_CARRY_SLOT_NAMES,
  FRESH_SEARCH_CONTEXT_SLOT_NAMES,
  FRESH_SEARCH_TRIGGER_SLOT_NAMES,
  FRESH_SEARCH_VOLATILE_SLOT_NAMES,
} from './eventProbe.js';
import {
  normalizeComparableSlotValue,
  removeSlotsByName,
  mergeSlots,
  getFirstComparableSlotValue,
  SHOW_ALL_KEYWORDS,
} from './slotUtils.js';
import { normalizeSlotName } from '../slotsService.js';
import { hasDateReferenceInText } from '../naturalLanguageHints.js';
import {
  detectCategoryFromText,
  normalizeComparableCategoryValue,
  normalizeCategory,
  resolveTaxonomyGenreEntryByValue,
} from './categoryDefinitions.js';
import { looksLikeUnknownArtistDiscoveryText } from '../../../../../shared/vagueArtistUtils.js';
import { deriveFallbackQuery } from './searchQuery.js';
import { detectChildrenGenreFromText } from './categoryRouting.js';
import { looksLikeShowMoreRequestText } from '../llm/showMoreHeuristics.js';
import { isBuyTicketsCommand } from './offerText.js';
import { wantsMoreOffersAfterFeedback } from './preferenceFeedback.js';

function hasExplicitFreshSearchLeadText(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return false;
  }

  return (
    /(?:^|\s)(хочу|ищу|найди|найти|подбери|подобрать|покажи|показать|интересует|интересуют|посоветуй|предложи|давай)(?:\s|$)/u.test(
      normalized
    ) ||
    /(?:^|\s)(а\s+что|что\s+есть|что\s+по)(?:\s|$)/u.test(normalized) ||
    /(?:^|\s)(теперь|лучше|вместо|а\s+теперь|нет,\s*хочу)(?:\s|$)/u.test(normalized)
  );
}

function hasExplicitChildAudienceInText(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return false;
  }

  return /(?:^|\s)(дет(?:и|ям|ей)?|детск\w*|ребен\w*|ребён\w*|малыш\w*)(?:\s|$)/u.test(normalized);
}

function hasExplicitSeniorCompanionInText(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return false;
  }

  return /(?:^|[^\p{L}])(?:бабушк[\p{L}\d]*|бабк[\p{L}\d]*|бабул[\p{L}\d]*|дедушк[\p{L}\d]*|дедул[\p{L}\d]*|дед(?:а|у|ом|е)?|пенсионер[\p{L}\d]*|пожил[\p{L}\d]*|старш[\p{L}\d]*\s+поколени[\p{L}\d]*)(?=$|[^\p{L}])/u.test(
    normalized
  );
}

function buildSeniorCompanionContextSlots() {
  return [
    {
      name: SENIOR_COMPANION_MARKER_SLOT_NAME,
      value: SENIOR_COMPANION_MARKER_VALUE,
      confidence: 0.99,
      source: 'senior_companion_rule',
    },
    {
      name: 'контекст_события',
      value: 'семейный',
      confidence: 0.98,
      source: 'senior_companion_rule',
    },
    {
      name: 'возрастное_ограничение',
      value: 'взрослые',
      confidence: 0.98,
      source: 'senior_companion_rule',
    },
  ];
}

function hasSeniorCompanionMarker(slots = []) {
  return (Array.isArray(slots) ? slots : []).some((slot) => {
    if (!slot || slot.name !== SENIOR_COMPANION_MARKER_SLOT_NAME || !slot.value) {
      return false;
    }

    const normalizedValue = normalizeComparableSlotValue(slot.value);
    return normalizedValue.includes('пожил') || normalizedValue.includes('senior');
  });
}

function buildSeniorCompanionSlots(text) {
  if (!hasExplicitSeniorCompanionInText(text)) {
    return [];
  }

  return buildSeniorCompanionContextSlots();
}

function hasExplicitSeniorCompanionInHistory(history = [], maxMessages = 6) {
  if (!Array.isArray(history) || history.length === 0) {
    return false;
  }

  const recentUserMessages = history
    .filter((item) => item && item.role === 'user' && typeof item.content === 'string')
    .slice(-maxMessages);

  return recentUserMessages.some((item) => hasExplicitSeniorCompanionInText(item.content));
}

function buildSeniorCompanionSlotsFromConversation({ userMessage = '', history = [] } = {}) {
  if (
    hasExplicitSeniorCompanionInText(userMessage) ||
    hasExplicitSeniorCompanionInHistory(history)
  ) {
    return buildSeniorCompanionContextSlots();
  }

  return [];
}

function enforceSeniorCompanionContext(slots = []) {
  const normalizedSlots = Array.isArray(slots) ? slots.filter(Boolean) : [];
  if (!hasSeniorCompanionMarker(normalizedSlots)) {
    return normalizedSlots;
  }

  const replacementSlotNames = new Set([
    SENIOR_COMPANION_MARKER_SLOT_NAME,
    'контекст_события',
    'возрастное_ограничение',
  ]);

  return mergeSlots(
    removeSlotsByName(normalizedSlots, replacementSlotNames),
    buildSeniorCompanionContextSlots()
  );
}

function extractSlotLikeIntents(intents = []) {
  return (Array.isArray(intents) ? intents : [])
    .filter(
      (intent) =>
        intent &&
        SLOT_LIKE_INTENT_SLOT_NAMES.has(String(intent.name || '').trim()) &&
        intent.value !== undefined &&
        intent.value !== null
    )
    .map((intent) => ({
      name: normalizeSlotName(String(intent.name).trim()),
      value: intent.value,
      confidence: intent.confidence,
      source: 'intent_slot_recovery',
    }));
}

function hasExplicitDateFilterInText(text) {
  return hasDateReferenceInText(text);
}

function resolveNamedTargetSlotReset(newlyExtractedSlots = [], userMessage = '') {
  const extractedSlots = Array.isArray(newlyExtractedSlots) ? newlyExtractedSlots : [];
  const hasArtistSlot = extractedSlots.some(
    (slot) => slot && slot.name === 'исполнитель' && slot.value
  );
  const hasEventNameSlot = extractedSlots.some(
    (slot) => slot && slot.name === 'название_мероприятия' && slot.value
  );

  if (!hasArtistSlot && !hasEventNameSlot) {
    return null;
  }

  const explicitSlotNames = new Set(
    extractedSlots.map((slot) => String(slot?.name || '').trim()).filter(Boolean)
  );
  const hasExplicitAudienceFilter =
    explicitSlotNames.has('возрастное_ограничение') ||
    explicitSlotNames.has('возраст_ребенка') ||
    explicitSlotNames.has('контекст_события') ||
    hasExplicitChildAudienceInText(userMessage) ||
    hasExplicitDateContextInText(userMessage);
  const hasExplicitDateFilter =
    explicitSlotNames.has('дата_события') || hasExplicitDateFilterInText(userMessage);
  const hasExplicitCategoryFilter =
    explicitSlotNames.has('тип_мероприятия') ||
    explicitSlotNames.has('тип_события') ||
    explicitSlotNames.has('категория') ||
    Boolean(detectCategoryFromText(userMessage));

  const slotsToRemove = new Set(['поисковый_запрос']);

  if (!hasExplicitAudienceFilter) {
    slotsToRemove.add('возрастное_ограничение');
    slotsToRemove.add('возраст_ребенка');
    slotsToRemove.add('контекст_события');
  }

  if (!hasExplicitDateFilter) {
    slotsToRemove.add('дата_события');
  }

  if (hasArtistSlot && !hasExplicitCategoryFilter) {
    slotsToRemove.add('тип_мероприятия');
    slotsToRemove.add('тип_события');
  }

  return {
    slotsToRemove,
    // Именованные артисты встречаются не только в музыкальных концертах:
    // это могут быть стендап, шоу, творческие вечера и другие форматы.
    // Поэтому не навязываем "концерты" без явного запроса категории.
    injectConcertCategory: false,
  };
}

function buildShowAllResetSlotNames({ effectiveSlots = [], clarificationTarget = '' } = {}) {
  const resetOnShowAll = new Set([
    'жанр',
    'жанр_музыки',
    'предпочтения_жанры',
    'исполнитель',
    'название_мероприятия',
    'поисковый_запрос',
  ]);
  const effectiveEventTypeForShowAll = getFirstComparableSlotValue(effectiveSlots, [
    'тип_мероприятия',
    'тип_события',
    'категория',
  ]);

  if (effectiveEventTypeForShowAll.includes('фестив')) {
    resetOnShowAll.delete('жанр');
    resetOnShowAll.delete('жанр_музыки');
    resetOnShowAll.delete('предпочтения_жанры');
  }

  if (clarificationTarget === 'ambiguous_category') {
    resetOnShowAll.delete('жанр');
    resetOnShowAll.delete('жанр_музыки');
    resetOnShowAll.delete('предпочтения_жанры');
    resetOnShowAll.add('тип_мероприятия');
    resetOnShowAll.add('тип_события');
    resetOnShowAll.add('категория');
    resetOnShowAll.add('category');
    resetOnShowAll.add('event_type');
  } else if (clarificationTarget === 'category') {
    resetOnShowAll.add('тип_мероприятия');
    resetOnShowAll.add('тип_события');
    resetOnShowAll.add('категория');
    resetOnShowAll.add('category');
    resetOnShowAll.add('event_type');
  } else if (clarificationTarget === 'time') {
    resetOnShowAll.add('время_события');
    resetOnShowAll.add('концерт_время');
  } else if (clarificationTarget === 'date') {
    resetOnShowAll.add('дата_события');
  } else if (clarificationTarget === 'budget') {
    resetOnShowAll.add('бюджет');
    resetOnShowAll.add('цена');
    resetOnShowAll.add('цена_от');
    resetOnShowAll.add('цена_до');
  }

  return resetOnShowAll;
}

function buildFreshSearchResetPlan({
  userMessage = '',
  currentSlots = [],
  previousSessionSlots = [],
  newlyExtractedSlots = [],
  hasMatchedUiButtonEcho = false,
  hasClarificationFollowUpSelection = false,
  isShowMoreRequest = false,
  isChangeCityRequest = false,
  isChangeDateRequest = false,
  isClarificationRequest = false,
  isEventDetailsRequest = false,
  isBuyTicketRequest = false,
  isExplicitAnyBudget = false,
  isExplicitAnyDate = false,
  wantsPreferredEventsRequest = false,
  directPreferenceChange = null,
} = {}) {
  const normalizedUserMessage = normalizeText(userMessage);
  const hasExplicitShowAllIntent =
    normalizedUserMessage.length > 0 &&
    SHOW_ALL_KEYWORDS.some((keyword) => normalizedUserMessage.includes(keyword));
  const hasUiFollowUpSelection = (
    Array.isArray(newlyExtractedSlots) ? newlyExtractedSlots : []
  ).some((slot) => slot && slot.source === 'ui');

  if (
    hasMatchedUiButtonEcho ||
    hasClarificationFollowUpSelection ||
    hasUiFollowUpSelection ||
    hasExplicitShowAllIntent ||
    isShowMoreRequest ||
    isChangeCityRequest ||
    isChangeDateRequest ||
    isClarificationRequest ||
    isEventDetailsRequest ||
    isBuyTicketRequest ||
    isExplicitAnyBudget ||
    isExplicitAnyDate ||
    wantsPreferredEventsRequest
  ) {
    return null;
  }

  const comparisonSlots =
    Array.isArray(previousSessionSlots) && previousSessionSlots.length > 0
      ? previousSessionSlots
      : currentSlots;

  const activeContextSlots = (Array.isArray(comparisonSlots) ? comparisonSlots : []).filter(
    (slot) =>
      slot &&
      FRESH_SEARCH_CONTEXT_SLOT_NAMES.has(slot.name) &&
      !FRESH_SEARCH_CARRY_SLOT_NAMES.has(slot.name)
  );

  if (activeContextSlots.length === 0) {
    return null;
  }

  const extractedTriggerSlots = (
    Array.isArray(newlyExtractedSlots) ? newlyExtractedSlots : []
  ).filter((slot) => slot && FRESH_SEARCH_TRIGGER_SLOT_NAMES.has(slot.name) && slot.value);
  const currentNamedTarget = getFirstComparableSlotValue(comparisonSlots, [
    'исполнитель',
    'название_мероприятия',
  ]);
  const newNamedTarget = getFirstComparableSlotValue(newlyExtractedSlots, [
    'исполнитель',
    'название_мероприятия',
  ]);
  const currentEventType = normalizeComparableCategoryValue(
    getFirstComparableSlotValue(comparisonSlots, ['тип_мероприятия', 'тип_события', 'категория'])
  );
  const directPreferredEventType = normalizeComparableSlotValue(
    directPreferenceChange?.preferredEventType || ''
  );
  const detectedEventType = normalizeComparableCategoryValue(
    directPreferredEventType ||
      getFirstComparableSlotValue(newlyExtractedSlots, [
        'тип_мероприятия',
        'тип_события',
        'категория',
      ]) ||
      detectCategoryFromText(
        directPreferenceChange?.canApplyDirectly && directPreferenceChange?.positivePart
          ? directPreferenceChange.positivePart
          : userMessage
      ) ||
      ''
  );
  const currentGenre = getFirstComparableSlotValue(comparisonSlots, [
    'жанр',
    'жанр_музыки',
    'предпочтения_жанры',
  ]);
  const newGenre = normalizeComparableSlotValue(
    directPreferenceChange?.preferredGenre ||
      getFirstComparableSlotValue(newlyExtractedSlots, [
        'жанр',
        'жанр_музыки',
        'предпочтения_жанры',
      ]) ||
      ''
  );
  const currentAudience = getFirstComparableSlotValue(comparisonSlots, [
    'возрастное_ограничение',
    'возраст_ребенка',
  ]);
  const newAudience = getFirstComparableSlotValue(newlyExtractedSlots, [
    'возрастное_ограничение',
    'возраст_ребенка',
  ]);
  const currentContext = getFirstComparableSlotValue(comparisonSlots, [
    'контекст_события',
    'настроение',
  ]);
  const newContext = getFirstComparableSlotValue(newlyExtractedSlots, [
    'контекст_события',
    'настроение',
  ]);
  const currentQuery = getFirstComparableSlotValue(comparisonSlots, ['поисковый_запрос']);
  const fallbackQuery = normalizeComparableSlotValue(
    deriveFallbackQuery(
      directPreferenceChange?.canApplyDirectly && directPreferenceChange?.positivePart
        ? directPreferenceChange.positivePart
        : userMessage,
      newlyExtractedSlots
    )
  );
  // A previous "type" can really be a genre of the newly detected category ("цирк" is a
  // genre of "шоу"); then the request continues instead of switching category.
  const currentTypeAsGenre =
    detectedEventType && currentEventType && detectedEventType !== currentEventType
      ? resolveTaxonomyGenreEntryByValue(currentEventType, { preferredCategory: detectedEventType })
      : null;
  const effectiveCurrentEventType = currentTypeAsGenre
    ? currentTypeAsGenre.normalizedCategory
    : currentEventType;
  const effectiveCurrentGenre =
    currentGenre ||
    (currentTypeAsGenre ? normalizeComparableSlotValue(currentTypeAsGenre.genre) : '');
  const genreCategory = detectedEventType || effectiveCurrentEventType;
  const resolveGenreKey = (genre) => {
    if (!genre) return '';
    const entry = resolveTaxonomyGenreEntryByValue(genre, { preferredCategory: genreCategory });
    return entry ? normalizeComparableSlotValue(entry.genre) : genre;
  };
  const formatReasonValue = (value) => String(value).replace(/_/gu, ' ');
  const reasons = [];

  if (looksLikeUnknownArtistDiscoveryText(userMessage)) {
    reasons.push('новый широкий поиск по артистам в городе');
  }

  if (newNamedTarget) {
    if (currentNamedTarget && newNamedTarget !== currentNamedTarget) {
      reasons.push(`новый именованный запрос "${newNamedTarget}" вместо "${currentNamedTarget}"`);
    } else if (!currentNamedTarget) {
      reasons.push(`появился именованный запрос "${newNamedTarget}"`);
    }
  }

  if (detectedEventType && detectedEventType !== effectiveCurrentEventType) {
    reasons.push(`категория сменилась на "${detectedEventType}"`);
  }

  if (newGenre && resolveGenreKey(newGenre) !== resolveGenreKey(effectiveCurrentGenre)) {
    reasons.push(`жанр сместился к "${newGenre}"`);
  }

  if (newAudience && newAudience !== currentAudience) {
    reasons.push(`новый фильтр аудитории "${formatReasonValue(newAudience)}"`);
  }

  if (newContext && newContext !== currentContext) {
    reasons.push(`новый контекст "${formatReasonValue(newContext)}"`);
  }

  if (
    reasons.length === 0 &&
    extractedTriggerSlots.length === 0 &&
    (!fallbackQuery || !hasExplicitFreshSearchLeadText(userMessage))
  ) {
    return null;
  }

  if (reasons.length === 0 && fallbackQuery && hasExplicitFreshSearchLeadText(userMessage)) {
    const currentAnchor = currentNamedTarget || currentEventType || currentGenre || currentQuery;
    const equivalentAnchors = new Set(
      [currentAnchor, effectiveCurrentEventType, resolveGenreKey(effectiveCurrentGenre)].filter(
        Boolean
      )
    );
    const isSameFocus =
      equivalentAnchors.has(fallbackQuery) ||
      equivalentAnchors.has(normalizeComparableCategoryValue(fallbackQuery));
    if (currentAnchor && !isSameFocus) {
      reasons.push(`новый поисковый фокус "${fallbackQuery}"`);
    }
  }

  if (reasons.length === 0) {
    return null;
  }

  const carryOverSlots = (Array.isArray(currentSlots) ? currentSlots : []).filter(
    (slot) => slot && FRESH_SEARCH_CARRY_SLOT_NAMES.has(slot.name)
  );
  const droppedSlots = activeContextSlots.map((slot) => `${slot.name}="${slot.value}"`);

  return {
    reasons,
    carryOverSlots,
    droppedSlots,
  };
}

function normalizeFreshSearchGroundingText(text = '') {
  return String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е');
}

function tokenizeFreshSearchGroundingWords(text = '') {
  return normalizeFreshSearchGroundingText(text)
    .split(/[^a-zа-я0-9]+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeFreshSearchGroundingStem(value = '') {
  const normalized = normalizeFreshSearchGroundingText(value).trim();
  if (!normalized) return '';
  return normalized
    .replace(
      /(?:иями|ями|ами|ого|его|ому|ему|ыми|ими|ая|яя|ое|ее|ые|ие|ий|ый|ой|ей|ов|ев|ам|ям|ах|ях|ую|юю|а|я|у|ю|е|о|ы|и|ь)$/u,
      ''
    )
    .trim();
}

function isFreshSearchSlotGroundedInMessage(slot = null, userMessage = '') {
  const value = String(slot?.value || '').trim();
  if (!value) return false;

  const normalizedMessage = normalizeFreshSearchGroundingText(userMessage);
  if (!normalizedMessage) return false;

  const valueWords = tokenizeFreshSearchGroundingWords(value);
  if (valueWords.length === 0) return false;

  const messageWords = tokenizeFreshSearchGroundingWords(normalizedMessage);
  if (messageWords.length === 0) return false;

  const messageStems = new Set(
    messageWords
      .map((word) => normalizeFreshSearchGroundingStem(word))
      .filter((stem) => stem.length >= 3)
  );

  return valueWords.every((word) => {
    if (normalizedMessage.includes(word)) {
      return true;
    }
    const stem = normalizeFreshSearchGroundingStem(word);
    return stem.length >= 3 && messageStems.has(stem);
  });
}

function sanitizeFreshSearchExtractedSlots({
  newlyExtractedSlots = [],
  userMessage = '',
  reasons = [],
} = {}) {
  const extracted = Array.isArray(newlyExtractedSlots) ? [...newlyExtractedSlots] : [];
  const hasExplicitNewFocusReason = (Array.isArray(reasons) ? reasons : []).some((reason) =>
    String(reason || '').includes('новый поисковый фокус')
  );

  if (!hasExplicitNewFocusReason || extracted.length === 0) {
    return {
      slots: extracted,
      droppedSlots: [],
      enforcedSearchQuery: '',
    };
  }

  const droppedSlots = [];
  const sanitizedSlots = extracted.filter((slot) => {
    const slotName = String(slot?.name || '').trim();
    if (!slotName || !FRESH_SEARCH_VOLATILE_SLOT_NAMES.has(slotName)) {
      return true;
    }

    if (slot?.source === 'ui') {
      return true;
    }

    if (isFreshSearchSlotGroundedInMessage(slot, userMessage)) {
      return true;
    }

    droppedSlots.push(`${slotName}="${String(slot?.value || '').trim()}"`);
    return false;
  });

  let enforcedSearchQuery = '';
  const hasSearchQuerySlot = sanitizedSlots.some(
    (slot) => slot && slot.name === 'поисковый_запрос' && String(slot.value || '').trim()
  );
  if (!hasSearchQuerySlot) {
    const fallbackFocus = String(deriveFallbackQuery(userMessage, []) || '').trim();
    if (fallbackFocus) {
      enforcedSearchQuery = fallbackFocus;
      sanitizedSlots.push({
        name: 'поисковый_запрос',
        value: fallbackFocus,
        confidence: 0.9,
        source: 'fresh_search_focus',
      });
    }
  }

  return {
    slots: sanitizedSlots,
    droppedSlots,
    enforcedSearchQuery,
  };
}

function resolveDetectedCategoryForSearch({
  newlyExtractedSlots = [],
  fallbackQuery = '',
  userMessage = '',
  detectedIntents = [],
  isChangePreferencesRequest = false,
  directPreferenceChange = null,
  userId = 'test-user',
  sessionId = 'test-session',
} = {}) {
  if (isChangePreferencesRequest && directPreferenceChange?.preferredEventType) {
    console.log(
      `🎯 [${userId}][${sessionId}] Категория для поиска зафиксирована прямой целью change_preferences: ` +
        `"${directPreferenceChange.preferredEventType}"`
    );
    return directPreferenceChange.preferredEventType;
  }

  let detectedCategory = null;
  const extractedEventTypeSlot = (
    Array.isArray(newlyExtractedSlots) ? newlyExtractedSlots : []
  ).find((slot) => slot && (slot.name === 'тип_мероприятия' || slot.name === 'тип_события'));

  if (extractedEventTypeSlot && extractedEventTypeSlot.value) {
    detectedCategory = normalizeCategory(extractedEventTypeSlot.value);
    console.log(
      `🔍 [${userId}][${sessionId}] AI Slots извлек категорию: "${extractedEventTypeSlot.value}" -> ` +
        `нормализовано: "${detectedCategory}"`
    );
  }

  if (!detectedCategory && fallbackQuery) {
    detectedCategory = detectCategoryFromText(fallbackQuery);
    if (detectedCategory) {
      console.log(
        `🔍 [${userId}][${sessionId}] Категория обнаружена в fallbackQuery: "${fallbackQuery}" -> "${detectedCategory}"`
      );
    }
  }

  if (!detectedCategory && userMessage) {
    detectedCategory = detectCategoryFromText(userMessage);
    if (detectedCategory) {
      console.log(
        `🔍 [${userId}][${sessionId}] Категория обнаружена в userMessage: "${userMessage}" -> "${detectedCategory}"`
      );
    }
  }

  const hasEventDetailsIntent =
    Array.isArray(detectedIntents) &&
    detectedIntents.some((intent) => intent && intent.name === 'event_details_request');

  if (!detectedCategory && !hasEventDetailsIntent) {
    const intentTriggerWithCategory = (Array.isArray(detectedIntents) ? detectedIntents : [])
      .map((intent) => String(intent?.trigger || '').trim())
      .find((trigger) => trigger && detectCategoryFromText(trigger));

    if (intentTriggerWithCategory) {
      detectedCategory = detectCategoryFromText(intentTriggerWithCategory);
      console.log(
        `🔍 [${userId}][${sessionId}] Категория обнаружена в trigger интента: "${intentTriggerWithCategory}" -> "${detectedCategory}"`
      );
    }
  }

  const hasChildAudienceSignal = Boolean(
    hasExplicitChildAudienceInText(userMessage) ||
    hasExplicitChildAudienceInText(fallbackQuery) ||
    (Array.isArray(newlyExtractedSlots) ? newlyExtractedSlots : []).some((slot) => {
      const slotName = String(slot?.name || '').trim();
      const slotValue = normalizeText(String(slot?.value || ''));
      return (
        slotName === 'возраст_ребенка' ||
        (slotName === 'контекст_события' && slotValue.includes('деть')) ||
        (slotName === 'возрастное_ограничение' && slotValue.includes('дет'))
      );
    })
  );
  const detectedChildrenGenre =
    detectChildrenGenreFromText(fallbackQuery) ||
    detectChildrenGenreFromText(userMessage) ||
    (Array.isArray(detectedIntents) ? detectedIntents : [])
      .map((intent) => String(intent?.trigger || '').trim())
      .map((trigger) => detectChildrenGenreFromText(trigger))
      .find(Boolean) ||
    '';
  const shouldForceChildrenCategory = Boolean(hasChildAudienceSignal || detectedChildrenGenre);

  if (shouldForceChildrenCategory && detectedCategory !== 'детям') {
    const previousCategory = detectedCategory || 'нет';
    detectedCategory = 'детям';
    console.log(
      `🧒 [${userId}][${sessionId}] Детский сигнал в запросе имеет приоритет: ` +
        `"${previousCategory}" -> "детям".`
    );
  }

  return detectedCategory;
}

function hasExplicitContinuationRequestText(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return false;
  }

  if (looksLikeShowMoreRequestText(normalized)) {
    return true;
  }

  if (wantsMoreOffersAfterFeedback(normalized)) {
    return true;
  }

  if (isBuyTicketsCommand(normalized)) {
    return true;
  }

  return (
    /(?:^|\s)(покажи|показать|подбери|подобрать|найди|найти|посоветуй|посоветовать|предложи|предложить)(?:\s|$)/u.test(
      normalized
    ) ||
    /(?:^|\s)(хочу|давай)\s+(?:еще|ещё|еще\s+варианты|ещё\s+варианты)/u.test(normalized) ||
    /(?:^|\s)(что|а)\s+еще(?:\s|$)/u.test(normalized) ||
    /(?:^|\s)еще\s+(?:вариант|варианты|событи|мероприят|концерт|спектакл)/u.test(normalized) ||
    /(?:^|\s)ещё\s+(?:вариант|варианты|событи|мероприят|концерт|спектакл)/u.test(normalized)
  );
}

function hasExplicitDateContextInText(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return false;
  }

  return (
    /(?:^|\s)с\s+девушк/u.test(normalized) ||
    /(?:^|\s)с\s+парн/u.test(normalized) ||
    /(?:^|\s)куда\s+сводить/u.test(normalized) ||
    /(?:^|\s)сводить\s+девушк/u.test(normalized) ||
    /(?:^|\s)сводить\s+парн/u.test(normalized) ||
    /(?:^|\s)втор(?:ая|ой|ую)\s+половинк/u.test(normalized) ||
    /(?:^|\s)для\s+двоих/u.test(normalized) ||
    /(?:^|\s)вдво(?:ем|е)/u.test(normalized) ||
    /(?:^|\s)свидан/u.test(normalized) ||
    /(?:^|\s)романтик/u.test(normalized)
  );
}

export {
  hasExplicitChildAudienceInText,
  hasExplicitSeniorCompanionInText,
  hasSeniorCompanionMarker,
  buildSeniorCompanionSlots,
  buildSeniorCompanionSlotsFromConversation,
  enforceSeniorCompanionContext,
  extractSlotLikeIntents,
  resolveNamedTargetSlotReset,
  buildShowAllResetSlotNames,
  buildFreshSearchResetPlan,
  sanitizeFreshSearchExtractedSlots,
  resolveDetectedCategoryForSearch,
  hasExplicitContinuationRequestText,
  hasExplicitDateContextInText,
};
