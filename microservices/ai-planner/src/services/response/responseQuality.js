import { normalizeText, escapeRegExp } from './textUtils.js';
import { hasExplicitContinuationRequestText } from './searchReset.js';
import {
  ensureFarewellHasHelp,
  buildMoodCityPromptResponse,
  looksLikeAngryMoodOutletRequest,
  buildAngryMoodCategoryClarificationResponse,
  isMaybeLaterReplyText,
} from './moodHealth.js';
import { DEFAULT_CHEAP_PRICE_CAP } from './searchVocabulary.js';
import {
  removeSlotsByName,
  readSlotValue,
  getKnownEventTypeValue,
  getKnownCityValue,
} from './slotUtils.js';
import {
  containsNonCyrillic,
  containsAwkwardRussianPhrasing,
} from '../llm/assistantResponseUtils.js';
import { DEFAULT_CITY_SELECTION_BUTTONS } from './replyConstants.js';
import {
  resolveClarificationPlan,
  buildClarificationActionResponse,
  buildKnownCityClarificationResponseViaLlm,
} from './clarification.js';
import { parseBudgetValue } from '../../../../../shared/moneyUtils.js';
import { buildOffTopicRedirectResponse } from './redirects.js';
import {
  getOfferFallbackIntro,
  buildSafeEventDetailsText,
  rebuildOfferTextWithRecovery,
} from './offerText.js';
import { OFFER_DELIVERY_AI_GATEWAY_TIMEOUT_MS } from './gatewayClient.js';
import {
  inferClarificationActionFromText,
  isQuickCategoryButtonText,
} from '../quickButtonsService.js';
import { looksLikeShowMoreRequestText } from '../llm/showMoreHeuristics.js';

function detectSoftClosureReplyKind(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return null;
  }

  if (hasExplicitContinuationRequestText(normalized)) {
    return null;
  }

  if (
    /(?:^|\s)(пока|до\s+свидания|до\s+встречи|всего\s+доброго|хорошего\s+дня|хорошего\s+вечера)(?:\s|$)/u.test(
      normalized
    )
  ) {
    return 'farewell';
  }

  if (/(?:^|\s)(спасибо|благодарю|благодарствую|спс|пасиб)(?:\s|$)/u.test(normalized)) {
    return 'thanks';
  }

  return null;
}

function buildSoftClosureReplyResponse(userMessage) {
  const kind = detectSoftClosureReplyKind(userMessage);
  const normalized = normalizeText(userMessage);

  if (kind === 'farewell') {
    return {
      message: ensureFarewellHasHelp('До встречи!'),
      buttons: [],
      offer: null,
    };
  }

  if (kind === 'thanks') {
    const hasPositiveTone = /(крут|класс|супер|отличн|замечательн|прекрасн|понрав)/u.test(
      normalized
    );
    return {
      message: hasPositiveTone ? 'Рад, что подбор вам понравился!' : 'Пожалуйста!',
      buttons: [],
      offer: null,
    };
  }

  return null;
}

function wantsCheaperBudget(text) {
  const normalized = normalizeText(text);
  return /(подешевле|дешевле|дешево|недорог|бюджетн)/u.test(normalized);
}

function wantsSimilarAlternatives(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return false;
  }

  return (
    /(похож|аналог|в\s+этом\s+же\s+духе)/u.test(normalized) ||
    /что[-\s]?нибудь\s+похож/u.test(normalized)
  );
}

function toEventPriceNumber(value) {
  const digits = String(value ?? '').replace(/[^0-9]/g, '');
  if (!digits) return null;
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function getReferencePriceFromEvent(event) {
  if (!event || typeof event !== 'object') {
    return null;
  }

  const min = toEventPriceNumber(event.priceMin);
  const max = toEventPriceNumber(event.priceMax);
  return min ?? max;
}

function computeRelativeCheaperBudgetCap(selectedEvent, fallbackBudgetCap = null) {
  const referencePrice = getReferencePriceFromEvent(selectedEvent);
  const fallback = Number.isFinite(fallbackBudgetCap) ? fallbackBudgetCap : null;
  const baseValue = referencePrice ?? fallback ?? DEFAULT_CHEAP_PRICE_CAP;

  if (!Number.isFinite(baseValue) || baseValue <= 1) {
    return null;
  }

  return Math.max(1, baseValue - 1);
}

function buildSimilarEventGenreSlot(selectedEvent) {
  const extraCategories = Array.isArray(selectedEvent?.extraCategories)
    ? selectedEvent.extraCategories
    : [];

  const genre = extraCategories
    .map((value) => String(value || '').trim())
    .find((value) => {
      const normalized = normalizeText(value);
      return normalized && !/(концерт|спектакл|выставк|театр|шоу|событ)/u.test(normalized);
    });

  if (!genre) {
    return null;
  }

  return {
    name: 'жанр_музыки',
    value: normalizeText(genre),
    confidence: 0.85,
    source: 'selected_event_context',
  };
}

function pruneSnapshotSlotsAfterComplaint(slots = [], slotNames = []) {
  const resetNames = new Set(
    (Array.isArray(slotNames) ? slotNames : [])
      .map((name) => String(name || '').trim())
      .filter(Boolean)
  );

  if (resetNames.size === 0) {
    return Array.isArray(slots) ? [...slots] : [];
  }

  return removeSlotsByName(slots, resetNames);
}

function upsertEphemeralSlot(slots = [], slot) {
  if (!slot || !slot.name) {
    return Array.isArray(slots) ? [...slots] : [];
  }

  return [...removeSlotsByName(slots, new Set([slot.name])), slot];
}

function collectAllowedNonCyrillicPhrases(events = []) {
  const list = Array.isArray(events) ? events : [];
  const phrases = new Set();

  list.forEach((event) => {
    if (!event || typeof event !== 'object') {
      return;
    }

    [event.title, event.activityTitle, event.venue].forEach((value) => {
      const trimmed = typeof value === 'string' ? value.trim() : '';
      if (!trimmed || trimmed.length < 2) {
        return;
      }
      if (!/[A-Za-z]/u.test(trimmed)) {
        return;
      }
      phrases.add(trimmed);
    });
  });

  return Array.from(phrases);
}

function canUseOfferTextWithoutJsonRetry({
  offerEvents = [],
  assistantText = '',
  isEventDetailsRequest = false,
} = {}) {
  return (
    Array.isArray(offerEvents) &&
    offerEvents.length > 0 &&
    !isEventDetailsRequest &&
    typeof assistantText === 'string' &&
    assistantText.trim().length > 0
  );
}

function shouldRetryLanguageRepair({
  responseHasNonCyrillic = false,
  offerEvents = [],
  assistantText = '',
  isEventDetailsRequest = false,
} = {}) {
  if (!responseHasNonCyrillic) {
    return false;
  }

  return !canUseOfferTextWithoutJsonRetry({
    offerEvents,
    assistantText,
    isEventDetailsRequest,
  });
}

function containsUnsafeNonCyrillicOutsideAllowedPhrases(text, allowedPhrases = []) {
  const source = String(text || '');
  if (!source) {
    return false;
  }

  let sanitized = source;
  const phrases = Array.isArray(allowedPhrases)
    ? [...allowedPhrases].sort((a, b) => String(b).length - String(a).length)
    : [];

  phrases.forEach((phrase) => {
    const trimmed = String(phrase || '').trim();
    if (!trimmed) {
      return;
    }

    sanitized = sanitized.replace(new RegExp(escapeRegExp(trimmed), 'giu'), ' ');
  });

  return containsNonCyrillic(sanitized);
}

function claimsNoResults(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return false;
  }
  return (
    /(ничего не найден|ничего не нашл|не найдено|не нашлось)(?![A-Za-zА-Яа-яЁё0-9_])/u.test(
      normalized
    ) || /по вашему запросу ничего не найдено/u.test(normalized)
  );
}

function hasBinaryYesNoButtons(buttons = []) {
  const normalizedButtons = (Array.isArray(buttons) ? buttons : [])
    .map((button) => normalizeText(button))
    .filter(Boolean);

  if (normalizedButtons.length !== 2) {
    return false;
  }

  return normalizedButtons.includes('да') && normalizedButtons.includes('нет');
}

function buildDeterministicNoResultsResponse({
  slots = [],
  hasValidCity = false,
  userPreferences = null,
} = {}) {
  const citySlot = Array.isArray(slots)
    ? slots.find((slot) => slot && slot.name === 'город' && readSlotValue(slot))
    : null;
  const cityName = citySlot ? readSlotValue(citySlot) : '';
  const knownEventType = normalizeText(getKnownEventTypeValue(slots));
  const dislikedGenres = Array.isArray(userPreferences?.dislikedGenres)
    ? userPreferences.dislikedGenres.filter(Boolean)
    : [];

  let eventTypeLabel = 'вариантов';
  if (knownEventType.includes('концерт')) eventTypeLabel = 'концертов';
  else if (knownEventType.includes('театр') || knownEventType.includes('спектак'))
    eventTypeLabel = 'спектаклей';
  else if (knownEventType.includes('выстав')) eventTypeLabel = 'выставок';
  else if (knownEventType.includes('музе')) eventTypeLabel = 'вариантов для посещения';

  let message =
    hasValidCity && cityName
      ? `Подходящих ${eventTypeLabel} в городе ${cityName} сейчас не нашлось.`
      : 'Сейчас не нашлось подходящих вариантов.';

  if (dislikedGenres.length > 0) {
    const dislikedGenresText = dislikedGenres.join(', ');
    message =
      hasValidCity && cityName
        ? `С учетом исключенных жанров (${dislikedGenresText}) подходящих ${eventTypeLabel} в городе ${cityName} сейчас не нашлось.`
        : `С учетом исключенных жанров (${dislikedGenresText}) подходящих вариантов сейчас не нашлось.`;
  }

  message += ' Могу сразу предложить другой формат досуга или поискать в другом городе.';

  if (!hasValidCity) {
    return {
      message,
      buttons: ['Москва', 'Санкт-Петербург', 'Екатеринбург', 'Другой город'],
      offer: null,
    };
  }

  const refinementButtons = knownEventType
    ? ['Уточнить дату', 'Уточнить категорию', 'Уточнить жанр']
    : ['Уточнить дату', 'Уточнить категорию'];

  return {
    message: `${message} Давайте уточним параметры поиска.`,
    buttons: refinementButtons,
    offer: null,
  };
}

async function buildNoSearchClarificationResponse({
  slots = [],
  hasValidCity = false,
  userPreferences = null,
  vagueRequestInfo = null,
  userId = '',
  sessionId = '',
  userMessage = '',
} = {}) {
  if (!hasValidCity) {
    const moodSlot = Array.isArray(slots)
      ? slots.find((slot) => slot && slot.name === 'настроение' && readSlotValue(slot))
      : null;
    const moodValue = moodSlot ? readSlotValue(moodSlot) : '';

    if (moodValue) {
      return buildMoodCityPromptResponse({
        moodValue,
        seed: `${userId}|${sessionId}|${userMessage}|${moodValue}|no_search_city`,
      });
    }

    return {
      message: 'Чтобы продолжить подбор, мне нужен город. В каком городе ищем?',
      buttons: [...DEFAULT_CITY_SELECTION_BUTTONS],
      offer: null,
    };
  }

  const plan = resolveClarificationPlan({
    slots,
    vagueRequestInfo,
    seed: `${userId}|${sessionId}|${userMessage}|no_search_clarification`,
    userPreferences,
  });

  if (plan.target === 'category' && looksLikeAngryMoodOutletRequest(userMessage)) {
    return buildAngryMoodCategoryClarificationResponse();
  }

  const target = plan.target || 'category';
  const knownEventType = plan.knownEventType || getKnownEventTypeValue(slots);
  const knownCity = getKnownCityValue(slots);

  if (hasValidCity && knownCity) {
    return buildKnownCityClarificationResponseViaLlm({
      userId,
      sessionId,
      userMessage,
      knownCity,
      slots,
      vagueRequestInfo,
      targetHint: target,
      originalText: '',
      originalButtons: [],
      history: [],
      userPreferences,
    });
  }

  return buildClarificationActionResponse({
    target,
    knownEventType,
    userPreferences,
    slots,
  });
}

function hasLowQualityRussianPhrasing(text = '') {
  const sourceText = String(text || '').trim();
  if (!sourceText) {
    return false;
  }

  const normalized = normalizeText(sourceText);
  if (!normalized) {
    return false;
  }

  if (containsAwkwardRussianPhrasing(sourceText)) {
    return true;
  }

  const badPatterns = [
    /меня\s+не\s+специализиру/u,
    /какие\s+события\s+вам\s+сейчас\s+подойдут/u,
    /какое\s+событие\s+вас\s+больше\s+всего\s+заинтересует/u,
    /интересное\s+мероприятие\s+для\s+вас\s+в\s+санкт\s+петербурге/u,
    /(?<![A-Za-zА-Яа-яЁё0-9_])с\s+участием$/u,
    /(?<![A-Za-zА-Яа-яЁё0-9_])в\s+городе$/u,
    /(?<![A-Za-zА-Яа-яЁё0-9_])на\s+\d{1,2}\s+[а-яё]+(?:\s+в\s+[а-яё\s-]+)?\s+(?:концертов|спектаклей|выставок|событий)\s+с\s+участием$/u,
  ];

  if (badPatterns.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  const endsWithoutTerminalPunctuation = !/[.!?…»"\)]$/u.test(sourceText);
  if (endsWithoutTerminalPunctuation) {
    const tailStopWords = new Set([
      'и',
      'или',
      'либо',
      'но',
      'а',
      'в',
      'во',
      'на',
      'по',
      'под',
      'над',
      'к',
      'ко',
      'с',
      'со',
      'у',
      'от',
      'до',
      'из',
      'для',
      'о',
      'об',
      'обо',
      'про',
      'при',
      'через',
      'между',
      'без',
    ]);
    const lastWord = normalized.split(/\s+/).filter(Boolean).pop() || '';
    if (tailStopWords.has(lastWord)) {
      return true;
    }
  }

  const quotesCount = (sourceText.match(/["«»]/gu) || []).length;
  if (quotesCount % 2 === 1) {
    return true;
  }

  return false;
}

function hasSlotWithAnyName(slots = [], slotNames = []) {
  const names = new Set((Array.isArray(slotNames) ? slotNames : []).filter(Boolean));
  if (names.size === 0) {
    return false;
  }

  return (Array.isArray(slots) ? slots : []).some((slot) => {
    if (!slot || typeof slot !== 'object') {
      return false;
    }
    const slotName = String(slot.name || '').trim();
    const slotValue = String(slot.value || '').trim();
    return names.has(slotName) && slotValue.length > 0;
  });
}

function shouldTreatAsClarificationFollowUpSelection({
  clarificationAsked = false,
  clarificationTarget = '',
  newlyExtractedSlots = [],
  recoveredUiSlot = null,
  userMessage = '',
  isExplicitAnyBudget = false,
  isExplicitAnyDate = false,
  isQuickCategorySelection = false,
} = {}) {
  if (!clarificationAsked) {
    return false;
  }

  const target = String(clarificationTarget || '').trim();
  if (!target) {
    return false;
  }

  const candidateSlots = [
    ...(Array.isArray(newlyExtractedSlots) ? newlyExtractedSlots : []),
    recoveredUiSlot && typeof recoveredUiSlot === 'object' ? recoveredUiSlot : null,
  ].filter(Boolean);

  switch (target) {
    case 'date':
      return isExplicitAnyDate || hasSlotWithAnyName(candidateSlots, ['дата_события']);
    case 'budget':
      return (
        isExplicitAnyBudget ||
        hasSlotWithAnyName(candidateSlots, ['бюджет', 'цена', 'цена_от', 'цена_до']) ||
        parseBudgetValue(userMessage) !== null
      );
    case 'time':
      return hasSlotWithAnyName(candidateSlots, ['время', 'время_события', 'концерт_время']);
    case 'genre':
      return hasSlotWithAnyName(candidateSlots, ['жанр', 'жанр_музыки', 'предпочтения_жанры']);
    case 'category':
      return (
        isQuickCategorySelection ||
        hasSlotWithAnyName(candidateSlots, ['тип_мероприятия', 'тип_события', 'категория'])
      );
    default:
      return candidateSlots.length > 0;
  }
}

async function buildLanguageQualityFallbackResponse({
  userId = '',
  sessionId = '',
  userMessage = '',
  normalizedCity = null,
  hasValidCity = false,
  noResultsDetected = false,
  slots = [],
  userPreferences = null,
  needsClarification = false,
  vagueRequestInfo = null,
  eventsForResponse = [],
  offerType = 'quick',
  hasPreviouslyShownEvents = false,
  offTopicIntent = null,
} = {}) {
  if (Array.isArray(eventsForResponse) && eventsForResponse.length > 0) {
    if (offerType === 'details' && eventsForResponse.length === 1) {
      return {
        message: buildSafeEventDetailsText(eventsForResponse[0], userMessage),
        buttons: null,
      };
    }

    return {
      message: rebuildOfferTextWithRecovery({
        primaryText: '',
        retryText: '',
        events: eventsForResponse,
        fallbackIntro: getOfferFallbackIntro(eventsForResponse, { hasPreviouslyShownEvents }),
        ensureOutro: true,
      }),
      buttons: null,
    };
  }

  if (noResultsDetected) {
    return buildDeterministicNoResultsResponse({
      slots,
      hasValidCity,
      userPreferences,
    });
  }

  if (offTopicIntent) {
    return buildOffTopicRedirectResponse({
      normalizedCity,
      hasValidCity,
      seed: `${userId}|${sessionId}|${userMessage}|language_quality_guard|offtopic`,
      userMessage,
    });
  }

  return buildNoSearchClarificationResponse({
    slots,
    hasValidCity,
    userPreferences,
    vagueRequestInfo: needsClarification ? vagueRequestInfo : null,
    userId,
    sessionId,
    userMessage,
  });
}

function isAiGatewayTimeoutError(error) {
  if (!error) {
    return false;
  }

  const message = String(error.message || '');

  if (error.code === 'AI_GATEWAY_TIMEOUT') {
    return true;
  }

  return (
    /Превышено время ожидания ответа от AI Gateway/u.test(message) ||
    /AI Gateway ошибка:\s*50[234](?![A-Za-zА-Яа-яЁё0-9_])/u.test(message) ||
    /Gateway Time-out|Gateway Timeout/iu.test(message)
  );
}

function buildOfferDeliveryTimeoutFallbackResponse({
  offerEvents = [],
  hasPreviouslyShownEvents = false,
  timeoutMs = OFFER_DELIVERY_AI_GATEWAY_TIMEOUT_MS,
  userId = '',
  sessionId = '',
} = {}) {
  console.warn(
    `⚠️ [${userId}][${sessionId}] Финальный LLM-ответ для подборки не уложился в ${timeoutMs}мс. ` +
      'Возвращаю локально собранный текст по готовым карточкам, чтобы не дойти до прокси-таймаута.'
  );

  return {
    text: rebuildOfferTextWithRecovery({
      primaryText: '',
      retryText: '',
      events: offerEvents,
      fallbackIntro: getOfferFallbackIntro(offerEvents, { hasPreviouslyShownEvents }),
      ensureOutro: true,
    }),
    buttons: [],
    parsedFromJson: false,
    usedLocalFallback: true,
  };
}

function looksLikeAssistantCatalogNavigationMessage(userMessage) {
  const raw = String(userMessage || '').trim();
  if (!raw || raw.length > 200) return false;
  if (raw.includes('\n')) return false;

  if (isMaybeLaterReplyText(raw)) return true;
  if (looksLikeShowMoreRequestText(raw)) return true;
  if (isQuickCategoryButtonText(raw)) return true;
  if (inferClarificationActionFromText(raw)) return true;

  const collapsed = normalizeText(raw).replace(/\s+/g, ' ').trim();
  if (!collapsed) return false;

  return /^найти\s+(?:концерт(?:ы)?|театр(?:ы)?|выставку|выставки|музей|музеи|стендап|спортивное\s+событие)$/u.test(
    collapsed
  );
}

export {
  buildSoftClosureReplyResponse,
  wantsCheaperBudget,
  wantsSimilarAlternatives,
  computeRelativeCheaperBudgetCap,
  buildSimilarEventGenreSlot,
  pruneSnapshotSlotsAfterComplaint,
  upsertEphemeralSlot,
  collectAllowedNonCyrillicPhrases,
  canUseOfferTextWithoutJsonRetry,
  shouldRetryLanguageRepair,
  containsUnsafeNonCyrillicOutsideAllowedPhrases,
  claimsNoResults,
  hasBinaryYesNoButtons,
  buildDeterministicNoResultsResponse,
  buildNoSearchClarificationResponse,
  hasLowQualityRussianPhrasing,
  shouldTreatAsClarificationFollowUpSelection,
  buildLanguageQualityFallbackResponse,
  isAiGatewayTimeoutError,
  buildOfferDeliveryTimeoutFallbackResponse,
  looksLikeAssistantCatalogNavigationMessage,
};
