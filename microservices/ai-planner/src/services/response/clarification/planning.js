import { hasDateReferenceInText } from '../../naturalLanguageHints.js';
import { isKnownDateContextAligned } from './dateContext.js';
import { hasLooseClarificationContextMatch } from './contextMatching.js';
import { normalizeClarificationTextForMatch, pickVariant } from '../textUtils.js';
import { normalizeAssistantButtonLabel } from '../buttonLabels.js';
import {
  resolveAmbiguousGenreCategoryChoice,
  getAmbiguousGenreContextSlot,
} from '../categoryRouting.js';
import { getKnownEventTypeValue } from '../slotUtils.js';
import {
  MOOD_TYPE_CLARIFICATION_BUTTONS,
  BUDGET_CLARIFICATION_BUTTONS,
  TIME_CLARIFICATION_BUTTONS,
  DATE_CLARIFICATION_BUTTONS,
  hasDislikedGenrePreferences,
  getCategoryClarificationButtons,
  getGenreClarificationButtons,
  canOfferMoodGenreClarification,
} from './buttons.js';

function getExpectedKnownClarificationContextScore({
  knownCity = '',
  knownDate = '',
  target = '',
} = {}) {
  let score = 0;
  if (knownCity && target !== 'date' && target !== 'ambiguous_category') score += 1;
  if (knownDate && target !== 'date' && target !== 'ambiguous_category') score += 1;
  return score;
}

function getKnownClarificationContextScore(
  text = '',
  { knownCity = '', knownDate = '', target = '' } = {}
) {
  const sourceText = String(text || '').trim();
  if (!sourceText) {
    return 0;
  }

  let score = 0;
  if (
    knownCity &&
    target !== 'date' &&
    target !== 'ambiguous_category' &&
    hasLooseClarificationContextMatch(sourceText, knownCity)
  ) {
    score += 1;
  }

  if (
    knownDate &&
    target !== 'date' &&
    target !== 'ambiguous_category' &&
    hasDateReferenceInText(sourceText) &&
    isKnownDateContextAligned(sourceText, knownDate)
  ) {
    score += 1;
  }

  return score;
}

function areButtonSetsEquivalent(leftButtons = [], rightButtons = []) {
  const normalizeButtons = (buttons) =>
    Array.from(
      new Set(
        (Array.isArray(buttons) ? buttons : [])
          .map((button) => normalizeAssistantButtonLabel(button))
          .map((button) => normalizeClarificationTextForMatch(button))
          .filter(Boolean)
      )
    ).sort();

  const left = normalizeButtons(leftButtons);
  const right = normalizeButtons(rightButtons);

  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function resolveClarificationTargetFromSessionContext({
  clarificationTarget = '',
  lastAssistantButtons = [],
  slotsSnapshot = [],
} = {}) {
  const normalizedTarget = String(clarificationTarget || '').trim();
  if (normalizedTarget === 'ambiguous_category') {
    return normalizedTarget;
  }

  const ambiguousGenreSlot = getAmbiguousGenreContextSlot(slotsSnapshot);
  if (!ambiguousGenreSlot) {
    return normalizedTarget;
  }

  const ambiguousChoice = resolveAmbiguousGenreCategoryChoice({
    slots: slotsSnapshot,
    userMessage: '',
  });
  const expectedButtons = Array.isArray(ambiguousChoice?.buttons) ? ambiguousChoice.buttons : [];

  if (areButtonSetsEquivalent(lastAssistantButtons, expectedButtons)) {
    return 'ambiguous_category';
  }

  return normalizedTarget;
}

function resolveClarificationPlan({
  slots = [],
  vagueRequestInfo = null,
  seed = '',
  targetHint = '',
  userPreferences = null,
  preferPopularSelectionCategories = false,
} = {}) {
  const knownEventType = getKnownEventTypeValue(slots);
  const dislikedGenresKnown = hasDislikedGenrePreferences(userPreferences);
  const missingDetails = Array.isArray(vagueRequestInfo?.missingDetails)
    ? vagueRequestInfo.missingDetails.filter(
        (detail) => !(dislikedGenresKnown && detail === 'жанр')
      )
    : [];
  const knownMissing = missingDetails.filter((detail) =>
    ['тип_мероприятия', 'жанр', 'бюджет', 'время', 'дата', 'настроение'].includes(detail)
  );
  const normalizedTargetHint = String(targetHint || '').trim();

  if (normalizedTargetHint === 'genre') {
    if (!knownEventType && !canOfferMoodGenreClarification(slots, knownEventType)) {
      return {
        target: 'category',
        buttons: getCategoryClarificationButtons(slots, { preferPopularSelectionCategories, seed }),
        knownEventType,
      };
    }

    if (dislikedGenresKnown) {
      const nextTarget = knownMissing.find((detail) => detail !== 'жанр') || 'date';
      return resolveClarificationPlan({
        slots,
        vagueRequestInfo: { ...vagueRequestInfo, missingDetails },
        seed,
        targetHint: nextTarget,
        userPreferences,
        preferPopularSelectionCategories,
      });
    }

    return {
      target: 'genre',
      buttons: getGenreClarificationButtons(knownEventType, userPreferences, slots),
      knownEventType,
    };
  }
  if (normalizedTargetHint === 'budget') {
    return { target: 'budget', buttons: [...BUDGET_CLARIFICATION_BUTTONS], knownEventType };
  }
  if (normalizedTargetHint === 'time') {
    return { target: 'time', buttons: [...TIME_CLARIFICATION_BUTTONS], knownEventType };
  }
  if (normalizedTargetHint === 'date') {
    return { target: 'date', buttons: [...DATE_CLARIFICATION_BUTTONS], knownEventType };
  }
  if (normalizedTargetHint === 'category') {
    return {
      target: 'category',
      buttons: getCategoryClarificationButtons(slots, { preferPopularSelectionCategories, seed }),
      knownEventType,
    };
  }
  if (normalizedTargetHint === 'ambiguous_category') {
    const ambiguousGenreChoice = resolveAmbiguousGenreCategoryChoice({ slots, userMessage: '' });
    return {
      target: 'ambiguous_category',
      buttons:
        ambiguousGenreChoice?.buttons?.length > 0
          ? ambiguousGenreChoice.buttons
          : getCategoryClarificationButtons(slots, { preferPopularSelectionCategories, seed }),
      knownEventType: '',
    };
  }

  // Пользователь сказал "по настроению" (вагый mood-запрос) — спрашиваем конкретное настроение
  if (knownMissing.includes('настроение') && !knownEventType) {
    return {
      target: 'настроение',
      buttons: [...MOOD_TYPE_CLARIFICATION_BUTTONS],
      knownEventType,
    };
  }

  if (
    !knownEventType &&
    canOfferMoodGenreClarification(slots, knownEventType) &&
    !dislikedGenresKnown
  ) {
    return {
      target: 'genre',
      buttons: getGenreClarificationButtons(knownEventType, userPreferences, slots),
      knownEventType,
    };
  }

  if (knownMissing.includes('тип_мероприятия') || !knownEventType) {
    return {
      target: 'category',
      buttons: getCategoryClarificationButtons(slots, { preferPopularSelectionCategories, seed }),
      knownEventType,
    };
  }

  const candidates = knownMissing.filter(
    (detail) => detail === 'жанр' || detail === 'бюджет' || detail === 'время' || detail === 'дата'
  );
  const picked =
    candidates.length > 0
      ? pickVariant(candidates, `${seed}|clarification-detail`) || candidates[0]
      : 'жанр';

  if (picked === 'бюджет') {
    return { target: 'budget', buttons: [...BUDGET_CLARIFICATION_BUTTONS], knownEventType };
  }
  if (picked === 'дата') {
    return { target: 'date', buttons: [...DATE_CLARIFICATION_BUTTONS], knownEventType };
  }
  if (picked === 'время') {
    return { target: 'time', buttons: [...TIME_CLARIFICATION_BUTTONS], knownEventType };
  }
  return {
    target: 'genre',
    buttons: getGenreClarificationButtons(knownEventType, userPreferences, slots),
    knownEventType,
  };
}

function getClarificationButtonsForTarget(
  target = '',
  knownEventType = '',
  userPreferences = null,
  slots = []
) {
  if (target === 'ambiguous_category') {
    const ambiguousGenreChoice = resolveAmbiguousGenreCategoryChoice({ slots, userMessage: '' });
    if (ambiguousGenreChoice?.buttons?.length > 0) {
      return ambiguousGenreChoice.buttons;
    }
  }
  if (target === 'genre')
    return getGenreClarificationButtons(knownEventType, userPreferences, slots);
  if (target === 'budget') return [...BUDGET_CLARIFICATION_BUTTONS];
  if (target === 'time') return [...TIME_CLARIFICATION_BUTTONS];
  if (target === 'date') return [...DATE_CLARIFICATION_BUTTONS];
  return getCategoryClarificationButtons(slots);
}

export {
  getExpectedKnownClarificationContextScore,
  getKnownClarificationContextScore,
  resolveClarificationTargetFromSessionContext,
  resolveClarificationPlan,
  getClarificationButtonsForTarget,
};
