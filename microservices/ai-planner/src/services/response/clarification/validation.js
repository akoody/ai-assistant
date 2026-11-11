import {
  normalizeClarificationTextForMatch,
  asksForCityClarification,
  normalizeText,
} from '../textUtils.js';
import {
  hasLooseClarificationContextMatch,
  asksForUnsupportedAreaClarification,
} from './contextMatching.js';
import { normalizeAssistantButtonLabel } from '../buttonLabels.js';
import { inferClarificationTarget } from '../clarificationTarget.js';
import {
  EMPTY_PREFERENCES_BUTTONS,
  CITY_CHANGE_CATEGORY_BUTTONS,
  CLARIFICATION_DECLINE_BUTTONS,
  POSITIVE_FEEDBACK_ACK_BUTTONS,
} from '../replyConstants.js';
import {
  CATEGORY_CLARIFICATION_BUTTONS,
  GENRE_CLARIFICATION_BUTTONS,
  MOOD_TYPE_CLARIFICATION_BUTTONS,
  SENIOR_FRIENDLY_GENRE_CLARIFICATION_BUTTONS,
  THEATER_GENRE_CLARIFICATION_BUTTONS,
  CHILD_GENRE_CLARIFICATION_BUTTONS,
  FESTIVAL_GENRE_CLARIFICATION_BUTTONS,
  BUDGET_CLARIFICATION_BUTTONS,
  TIME_CLARIFICATION_BUTTONS,
  DATE_CLARIFICATION_BUTTONS,
} from './buttons.js';
import { getKnownDateValue } from '../slotUtils.js';
import { isKnownDateContextAligned } from './dateContext.js';
import { resolveClarificationPlan } from './planning.js';
import {
  containsNonCyrillic,
  containsAwkwardRussianPhrasing,
  hasForbiddenAssistantFeminineSelfReference,
} from '../../llm/assistantResponseUtils.js';

function extractClarificationLead(text = '', limit = 4) {
  return normalizeClarificationTextForMatch(text).split(' ').filter(Boolean).slice(0, limit);
}

function hasSimilarClarificationLead(text = '', lastAssistantText = '') {
  const currentLead = extractClarificationLead(text, 4);
  const previousLead = extractClarificationLead(lastAssistantText, 4);

  if (currentLead.length < 3 || previousLead.length < 3) {
    return false;
  }

  return currentLead.slice(0, 3).join(' ') === previousLead.slice(0, 3).join(' ');
}

function isClarificationTextSpecificForTarget(
  text = '',
  { target = '', knownEventType = '', ambiguousGenre = '' } = {}
) {
  const normalized = normalizeClarificationTextForMatch(text);
  const normalizedEventType = normalizeClarificationTextForMatch(knownEventType);
  const normalizedAmbiguousGenre = normalizeClarificationTextForMatch(ambiguousGenre);

  if (!normalized || !target) {
    return true;
  }

  if (target === 'ambiguous_category') {
    const mentionsGenre = normalizedAmbiguousGenre
      ? hasLooseClarificationContextMatch(normalized, normalizedAmbiguousGenre)
      : /(?<![A-Za-zА-Яа-яЁё0-9_])жанр(?![A-Za-zА-Яа-яЁё0-9_])/u.test(normalized);

    return (
      mentionsGenre &&
      /(?<![A-Za-zА-Яа-яЁё0-9_])(категори|формат|направлен|вид|интереснее|ближе|что\s+показать|что\s+выбере)(?![A-Za-zА-Яа-яЁё0-9_])/u.test(
        normalized
      )
    );
  }

  if (target === 'category') {
    return (
      /(?<![A-Za-zА-Яа-яЁё0-9_])(категори|формат|интереснее|больше\s+интерес|больше\s+по\s+душе)(?![A-Za-zА-Яа-яЁё0-9_])/u.test(
        normalized
      ) ||
      /(?<![A-Za-zА-Яа-яЁё0-9_])(концерты|театры|выставки|музеи|стендап)(?![A-Za-zА-Яа-яЁё0-9_])/u.test(
        normalized
      )
    );
  }

  if (target === 'genre') {
    return (
      /(?<![A-Za-zА-Яа-яЁё0-9_])жанр(?![A-Za-zА-Яа-яЁё0-9_])/u.test(normalized) ||
      /(?<![A-Za-zА-Яа-яЁё0-9_])музык/u.test(normalized) ||
      (normalizedEventType && hasLooseClarificationContextMatch(normalized, normalizedEventType))
    );
  }

  if (target === 'budget') {
    return /(?<![A-Za-zА-Яа-яЁё0-9_])(бюджет|цена|стоимость|билет)(?![A-Za-zА-Яа-яЁё0-9_])/u.test(
      normalized
    );
  }

  if (target === 'time') {
    return /(?<![A-Za-zА-Яа-яЁё0-9_])(когда|время|утром|днем|вечером|ночью)(?![A-Za-zА-Яа-яЁё0-9_])/u.test(
      normalized
    );
  }

  if (target === 'date') {
    return /(?<![A-Za-zА-Яа-яЁё0-9_])(дата|когда|период|день|число)(?![A-Za-zА-Яа-яЁё0-9_])/u.test(
      normalized
    );
  }

  return true;
}

function areClarificationButtonsCompatible(actualButtons = [], expectedButtons = []) {
  const normalizedActual = Array.isArray(actualButtons)
    ? actualButtons
        .map((item) => normalizeClarificationTextForMatch(normalizeAssistantButtonLabel(item)))
        .filter(Boolean)
    : [];
  const normalizedExpected = new Set(
    Array.isArray(expectedButtons)
      ? expectedButtons.map((item) => normalizeClarificationTextForMatch(item)).filter(Boolean)
      : []
  );

  if (normalizedActual.length === 0 || normalizedExpected.size === 0) {
    return true;
  }

  return normalizedActual.every((button) => normalizedExpected.has(button));
}

function normalizeClarificationButtonsForPlan(actualButtons = [], expectedButtons = []) {
  const expectedList = Array.isArray(expectedButtons)
    ? expectedButtons.filter((item) => String(item || '').trim())
    : [];

  if (expectedList.length === 0) {
    return Array.isArray(actualButtons)
      ? actualButtons.filter((item) => String(item || '').trim())
      : [];
  }

  const expectedByNormalized = new Map(
    expectedList.map((item) => [normalizeClarificationTextForMatch(item), item])
  );

  if (expectedByNormalized.has('покажи все')) {
    expectedByNormalized.set('показать все', expectedByNormalized.get('покажи все'));
    expectedByNormalized.set('показать всё', expectedByNormalized.get('покажи все'));
  }

  const normalizedActual = Array.isArray(actualButtons)
    ? actualButtons
        .map((item) => normalizeClarificationTextForMatch(normalizeAssistantButtonLabel(item)))
        .filter(Boolean)
    : [];

  const filtered = [];
  const seen = new Set();
  for (const normalizedButton of normalizedActual) {
    if (!expectedByNormalized.has(normalizedButton) || seen.has(normalizedButton)) {
      continue;
    }
    seen.add(normalizedButton);
    filtered.push(expectedByNormalized.get(normalizedButton));
  }

  return filtered.length > 0 ? filtered : [...expectedList];
}

function isClarificationCandidateAligned({
  text = '',
  buttons = [],
  target = '',
  expectedButtons = [],
} = {}) {
  const normalizedTarget = String(target || '').trim();
  if (!normalizedTarget) {
    return true;
  }

  const inferredTarget = inferClarificationTarget({ buttons, text });
  const isCompatibleAmbiguousCategoryTarget =
    normalizedTarget === 'ambiguous_category' &&
    (inferredTarget === 'category' || inferredTarget === 'ambiguous_category');

  if (
    inferredTarget &&
    inferredTarget !== normalizedTarget &&
    !isCompatibleAmbiguousCategoryTarget
  ) {
    return false;
  }

  return areClarificationButtonsCompatible(buttons, expectedButtons);
}

function countClarificationNumberedOptions(text = '') {
  if (!text) return 0;
  const matches = String(text).match(/(?:^|\n)\s*\d{1,2}[.)]\s+\S/gm);
  return Array.isArray(matches) ? matches.length : 0;
}

function isKnownClarificationButton(button = '') {
  const normalized = normalizeClarificationTextForMatch(button);
  if (!normalized) return false;

  const knownButtons = [
    ...CATEGORY_CLARIFICATION_BUTTONS,
    ...GENRE_CLARIFICATION_BUTTONS,
    ...SENIOR_FRIENDLY_GENRE_CLARIFICATION_BUTTONS,
    ...THEATER_GENRE_CLARIFICATION_BUTTONS,
    ...CHILD_GENRE_CLARIFICATION_BUTTONS,
    ...FESTIVAL_GENRE_CLARIFICATION_BUTTONS,
    ...BUDGET_CLARIFICATION_BUTTONS,
    ...TIME_CLARIFICATION_BUTTONS,
    ...DATE_CLARIFICATION_BUTTONS,
    ...MOOD_TYPE_CLARIFICATION_BUTTONS,
    ...EMPTY_PREFERENCES_BUTTONS,
    ...CLARIFICATION_DECLINE_BUTTONS,
    ...CITY_CHANGE_CATEGORY_BUTTONS,
    ...POSITIVE_FEEDBACK_ACK_BUTTONS,
  ];

  return knownButtons.some((item) => normalizeClarificationTextForMatch(item) === normalized);
}

function looksLikeSpecificPlaceSelection(text = '', buttons = []) {
  const normalizedText = normalizeClarificationTextForMatch(text);
  const normalizedButtons = Array.isArray(buttons)
    ? buttons.map((item) => normalizeClarificationTextForMatch(item)).filter(Boolean)
    : [];

  const specificPlacePrompt =
    /(?<![A-Za-zА-Яа-яЁё0-9_])(в каком|какой|какая|какие|выберите|или же выберите|из предложенного списка)(?![A-Za-zА-Яа-яЁё0-9_]).{0,60}(?<![A-Za-zА-Яа-яЁё0-9_])(театр|театре|музей|музее|галере|клуб|клубе|зал|зале|холл|hall|space|пространств|площадк|арен|сцен|дк|дом культуры|кинотеатр)(?![A-Za-zА-Яа-яЁё0-9_])/u.test(
      normalizedText
    ) ||
    /(?<![A-Za-zА-Яа-яЁё0-9_])другой театр(?![A-Za-zА-Яа-яЁё0-9_])/u.test(normalizedText) ||
    /(?<![A-Za-zА-Яа-яЁё0-9_])из этих вариантов(?![A-Za-zА-Яа-яЁё0-9_])/u.test(normalizedText);

  const specificPlaceButtons = normalizedButtons.some((button) => {
    if (isKnownClarificationButton(button)) {
      return false;
    }

    return /(?<![A-Za-zА-Яа-яЁё0-9_])(тюз|театр|театре|драм|опера|балет|клуб|hall|space|музей|галере|планетар|арена|сцена|холл|дк|дом культуры|центр|дворец|площадк|имени|им)(?![A-Za-zА-Яа-яЁё0-9_])/u.test(
      button
    );
  });

  return specificPlacePrompt || specificPlaceButtons;
}

function shouldGuardUngroundedClarificationResponse({
  needsClarification = false,
  offerEvents = [],
  text = '',
  buttons = [],
  slots = [],
  vagueRequestInfo = null,
  userPreferences = null,
  seed = '',
} = {}) {
  if (!needsClarification) {
    return { shouldGuard: false, reason: '', plan: null };
  }

  if (Array.isArray(offerEvents) && offerEvents.length > 0) {
    return { shouldGuard: false, reason: '', plan: null };
  }

  const plan = resolveClarificationPlan({ slots, vagueRequestInfo, seed, userPreferences });
  const knownDate = getKnownDateValue(slots);
  if (knownDate && !isKnownDateContextAligned(text, knownDate)) {
    return { shouldGuard: true, reason: 'known_date_mismatch', plan };
  }

  const aligned = isClarificationCandidateAligned({
    text,
    buttons,
    target: plan.target,
    expectedButtons: plan.buttons,
  });

  if (!aligned) {
    return { shouldGuard: true, reason: 'clarification_alignment', plan };
  }

  if (countClarificationNumberedOptions(text) >= 2) {
    return { shouldGuard: true, reason: 'numbered_clarification_options', plan };
  }

  if (looksLikeSpecificPlaceSelection(text, buttons)) {
    return { shouldGuard: true, reason: 'specific_place_selection', plan };
  }

  return { shouldGuard: false, reason: '', plan };
}

function shouldReplaceClarificationWithFallback(text, history = []) {
  const normalized = normalizeClarificationTextForMatch(text);
  if (!normalized) {
    return false;
  }

  if (
    normalized.includes('мне нужно уточнить') ||
    normalized.includes('учитываю дату') ||
    normalized.includes('город уже известен') ||
    normalized.includes('продолжаем подбор') ||
    normalized.includes('чтобы сузить варианты')
  ) {
    return true;
  }

  const lastAssistantText = Array.isArray(history)
    ? [...history].reverse().find((item) => item?.role === 'assistant' && item?.content)?.content ||
      ''
    : '';
  const normalizedLastAssistant = normalizeClarificationTextForMatch(lastAssistantText);

  return Boolean(
    normalizedLastAssistant &&
    (normalized === normalizedLastAssistant || hasSimilarClarificationLead(text, lastAssistantText))
  );
}

function looksLikeFollowUpClarificationResponse(text = '', buttons = []) {
  const normalized = normalizeClarificationTextForMatch(text);
  const normalizedButtons = Array.isArray(buttons)
    ? buttons.map((item) => normalizeClarificationTextForMatch(item)).filter(Boolean)
    : [];

  if (!normalized && normalizedButtons.length === 0) {
    return false;
  }

  const hasPromptText =
    /^(какой|когда|на\s+какую|выберите|уточните)/u.test(normalized) ||
    /какой\s+бюджет/u.test(normalized) ||
    /на\s+какую\s+дат/u.test(normalized) ||
    /когда\s+вам\s+удоб/u.test(normalized) ||
    /какой\s+жанр/u.test(normalized) ||
    /выберите\s+дат/u.test(normalized) ||
    /выберите\s+время/u.test(normalized);

  const hasClarificationButtons =
    normalizedButtons.length > 0 &&
    !normalizedButtons.some((item) =>
      ['концерты', 'театры', 'выставки', 'музеи', 'стендап', 'покажи все'].includes(item)
    );

  return hasPromptText || hasClarificationButtons;
}

function isSafeKnownCityClarificationText(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (containsNonCyrillic(value)) return false;
  if (containsAwkwardRussianPhrasing(value)) return false;
  if (hasForbiddenAssistantFeminineSelfReference(value)) return false;
  if (asksForCityClarification(value)) return false;
  if (asksForUnsupportedAreaClarification(value)) return false;

  const normalized = normalizeText(value);
  const informalSecondPersonPattern =
    /(?:^|[\s,!.?;:()"«»-])(ты|тебя|тебе|тобой|твой|твоя|твое|твои)(?=$|[\s,!.?;:()"«»-])/u;
  if (/(выберите|уточните|подскажите)\s+город/u.test(normalized)) return false;
  if (/(?<![A-Za-zА-Яа-яЁё0-9_])другой\s+город(?![A-Za-zА-Яа-яЁё0-9_])/u.test(normalized))
    return false;
  if (/(?<![A-Za-zА-Яа-яЁё0-9_])учитываю\s+дат/u.test(normalized)) return false;
  if (/(?<![A-Za-zА-Яа-яЁё0-9_])город\s+уже\s+извест/u.test(normalized)) return false;
  if (/(?<![A-Za-zА-Яа-яЁё0-9_])продолжаем\s+подбор/u.test(normalized)) return false;
  if (
    /(?<![A-Za-zА-Яа-яЁё0-9_])район(?![A-Za-zА-Яа-яЁё0-9_])|(?<![A-Za-zА-Яа-яЁё0-9_])районе(?![A-Za-zА-Яа-яЁё0-9_])|(?<![A-Za-zА-Яа-яЁё0-9_])округ(?![A-Za-zА-Яа-яЁё0-9_])|(?<![A-Za-zА-Яа-яЁё0-9_])округе(?![A-Za-zА-Яа-яЁё0-9_])|(?<![A-Za-zА-Яа-яЁё0-9_])метро(?![A-Za-zА-Яа-яЁё0-9_])/u.test(
      normalized
    )
  )
    return false;
  if (informalSecondPersonPattern.test(normalized)) return false;
  if (/(?<![A-Za-zА-Яа-яЁё0-9_])есть\s+варианты(?![A-Za-zА-Яа-яЁё0-9_])/u.test(normalized))
    return false;
  if (/(?<![A-Za-zА-Яа-яЁё0-9_])вот\s+несколько\s+вариант/u.test(normalized)) return false;
  if (/(?<![A-Za-zА-Яа-яЁё0-9_])могу\s+предложить\s+несколько\s+вариант/u.test(normalized))
    return false;
  if (/(?<![A-Za-zА-Яа-яЁё0-9_])подобрал\s+несколько\s+вариант/u.test(normalized)) return false;
  return true;
}

export {
  isClarificationTextSpecificForTarget,
  areClarificationButtonsCompatible,
  normalizeClarificationButtonsForPlan,
  isClarificationCandidateAligned,
  shouldGuardUngroundedClarificationResponse,
  shouldReplaceClarificationWithFallback,
  looksLikeFollowUpClarificationResponse,
  isSafeKnownCityClarificationText,
};
