import { getKnownEventTypeValue, getKnownDateValue } from '../slotUtils.js';
import { buildClarificationActionResponse } from './wording.js';
import { asksForCityClarification } from '../textUtils.js';
import { isKnownDateContextAligned } from './dateContext.js';
import { asksForUnsupportedAreaClarification } from './contextMatching.js';
import {
  isClarificationTextSpecificForTarget,
  isClarificationCandidateAligned,
  shouldReplaceClarificationWithFallback,
  isSafeKnownCityClarificationText,
} from './validation.js';

function buildCardlessOfferFallbackResponse({
  slots = [],
  hasValidCity = false,
  cityName = '',
} = {}) {
  if (hasValidCity) {
    const knownEventType = getKnownEventTypeValue(slots);
    const knownDate = getKnownDateValue(slots);
    return buildClarificationActionResponse({
      target: knownEventType ? 'genre' : 'category',
      knownEventType,
      slots,
      knownCity: cityName,
      knownDate,
    });
  }

  const knownEventType = getKnownEventTypeValue(slots);
  const buttons = knownEventType
    ? ['Уточнить жанр', 'Уточнить бюджет', 'Уточнить время']
    : [
        'Москва',
        'Санкт-Петербург',
        'Екатеринбург',
        'Новосибирск',
        'Казань',
        'Нижний Новгород',
        'Другой город',
      ];

  const message = knownEventType
    ? cityName
      ? `Чтобы продолжить подбор в городе ${cityName}, давайте чуть уточним запрос: что для вас важнее сейчас?`
      : 'Давайте чуть уточним запрос: что для вас важнее сейчас?'
    : 'Давайте немного уточним запрос. В каком городе хотите посмотреть мероприятия?';

  return {
    message,
    buttons,
    offer: null,
  };
}

function buildKnownCityClarificationFallbackResult({
  originalText = '',
  originalButtons = [],
  buttons = [],
  target = '',
  knownEventType = '',
  ambiguousGenre = '',
  userPreferences = null,
  slots = [],
  knownCity = '',
  knownDate = '',
  history = [],
  preferPopularSelectionCategories = false,
  clarificationSeed = '',
} = {}) {
  const original = String(originalText || '').trim();
  const originalHasCityQuestion = asksForCityClarification(original);
  const originalHasUnsupportedAreaQuestion = asksForUnsupportedAreaClarification(
    original,
    originalButtons
  );
  const resolvedButtons =
    Array.isArray(originalButtons) && originalButtons.length > 0
      ? [...originalButtons]
      : [...buttons];
  const originalCanBeReused =
    Boolean(original) &&
    !originalHasCityQuestion &&
    !originalHasUnsupportedAreaQuestion &&
    isSafeKnownCityClarificationText(original, { knownCity, knownDate }) &&
    isKnownDateContextAligned(original, knownDate) &&
    isClarificationTextSpecificForTarget(original, { target, knownEventType, ambiguousGenre }) &&
    isClarificationCandidateAligned({
      text: original,
      buttons: resolvedButtons,
      target,
      expectedButtons: buttons,
    }) &&
    !shouldReplaceClarificationWithFallback(original, history, { knownCity, knownDate });

  if (!originalCanBeReused) {
    return buildClarificationActionResponse({
      target,
      knownEventType,
      userPreferences,
      slots,
      knownCity,
      knownDate,
      preferPopularSelectionCategories,
      seed: clarificationSeed,
    });
  }

  return {
    message: original,
    buttons: resolvedButtons,
    offer: null,
  };
}

export { buildCardlessOfferFallbackResponse, buildKnownCityClarificationFallbackResult };
