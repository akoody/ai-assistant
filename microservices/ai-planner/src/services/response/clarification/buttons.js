import {
  POPULAR_SELECTION_SHOW_ALL_BUTTON,
  buildPopularSelectionCategoryButtons,
} from '../../../../../../shared/popularSelectionCategories.js';
import { getKnownEventTypeValue, getKnownCityValue } from '../slotUtils.js';
import { looksLikeUnknownArtistDiscoveryText } from '../../../../../../shared/vagueArtistUtils.js';
import { normalizeClarificationTextForMatch } from '../textUtils.js';
import {
  canUsePopularCitySelection,
  hasSeniorFriendlyContext,
  resolveMoodSearchSignal,
} from '../../offerService.js';
import { detectCategoryFromText } from '../categoryDefinitions.js';

const CATEGORY_CLARIFICATION_BUTTONS = [
  'Концерты',
  'Театры',
  'Выставки',
  'Музеи',
  POPULAR_SELECTION_SHOW_ALL_BUTTON,
];

const GENRE_CLARIFICATION_BUTTONS = [
  'Рок',
  'Поп',
  'Джаз',
  'Классика',
  'Клубы',
  'Хип-хоп',
  'Любой',
  'Покажи все',
];

const FUN_MOOD_GENRE_CLARIFICATION_BUTTONS = [
  'Стендап',
  'Комедия',
  'Шоу',
  'Юмористический концерт',
  'Любой',
  'Покажи все',
];

const MOOD_TYPE_CLARIFICATION_BUTTONS = [
  'Весёлое',
  'Романтичное',
  'Спокойное',
  'Энергичное',
  'Необычное',
];

const SENIOR_FRIENDLY_GENRE_CLARIFICATION_BUTTONS = [
  'Классика',
  'Джаз',
  'Творческий вечер',
  'Инструментальная музыка',
  'Любой',
  'Покажи все',
];

const THEATER_GENRE_CLARIFICATION_BUTTONS = [
  'Комедия',
  'Драма',
  'Мюзикл',
  'Детский',
  'Классика',
  'Любой',
  'Покажи все',
];

const CHILD_GENRE_CLARIFICATION_BUTTONS = [
  'Малышам (2-6)',
  'Для младшего и среднего возраста (7-12)',
  'Для старшего возраста (от 12 лет)',
  'Детские спектакли',
  'Детские концерты',
  'Детские мюзиклы',
  'Цирк / Клоунада',
  'Детские шоу',
  'Другое',
  'Покажи все',
];

const FESTIVAL_GENRE_CLARIFICATION_BUTTONS = ['Музыкальные фестивали', 'Опен-эйр', 'Покажи все'];

const BUDGET_CLARIFICATION_BUTTONS = ['До 500₽', 'До 1000₽', 'До 3000₽', 'До 5000₽', 'Не важно'];

const TIME_CLARIFICATION_BUTTONS = [
  'Утром',
  'Днем',
  'Вечером',
  'Ночью',
  'Любое время',
  'Покажи все',
];

const DATE_CLARIFICATION_BUTTONS = [
  'Сегодня',
  'Завтра',
  'Ближайшие выходные',
  'На следующей неделе',
  'Любая',
];

const GENERIC_GENRE_BUTTONS = new Set(['любой', 'покажи все']);

function looksLikeOfferTextWithoutCards(text = '') {
  const source = String(text || '').trim();
  if (!source) {
    return false;
  }

  const normalized = source.toLowerCase().replace(/ё/g, 'е');
  const numberedEventsCount = (source.match(/(?:^|\n)\s*\d{1,2}[.)]\s+\S/gm) || []).length;
  const hasOfferIntro =
    /(?:^|\n)\s*(?:вот\s+несколько|я\s+наш[её]л\s+(?:еще\s+|ещ[её]\s+)?вариант|подборк|другие\s+спектакл|интересных\s+вариант)/u.test(
      normalized
    );
  const hasPseudoOfferIntro =
    /(?<![A-Za-zА-Яа-яЁё0-9_])(?:вот\s+несколько\s+вариант|есть\s+разные\s+вариант|могу\s+предложить\s+несколько\s+вариант|нашел\s+несколько\s+вариант|подобрал\s+несколько\s+вариант)(?![A-Za-zА-Яа-яЁё0-9_])/u.test(
      normalized
    );
  const hasBareOfferIntro =
    /(?:^|[^\p{L}\p{N}_])(?:вот\s+несколько|наш[её]л\s+несколько|подобрал\s+несколько)[\s\S]{0,100}(?:вариант|событи|мероприяти|предложени)/u.test(
      normalized
    );
  const hasClarificationQuestion =
    /(?<![A-Za-zА-Яа-яЁё0-9_])(что|какое|какой|какая|какие|в каком|в каком направлении)(?![A-Za-zА-Яа-яЁё0-9_]).{0,80}\?/u.test(
      normalized
    );
  const hasCategoryChoicePattern =
    /(?<![A-Za-zА-Яа-яЁё0-9_])(концерт|театр|выставк|музе|стендап|шоу|жанр|бюджет|время)(?![A-Za-zА-Яа-яЁё0-9_])/u.test(
      normalized
    );
  const detailLabelsCount = ['дата и время:', 'место проведения:', 'описание:', 'цена:'].filter(
    (label) => normalized.includes(label)
  ).length;

  return (
    (numberedEventsCount >= 2 && detailLabelsCount >= 2) ||
    (hasOfferIntro && numberedEventsCount >= 1 && detailLabelsCount >= 2) ||
    (hasBareOfferIntro && numberedEventsCount === 0 && detailLabelsCount === 0) ||
    (hasPseudoOfferIntro && hasClarificationQuestion && hasCategoryChoicePattern)
  );
}

function buildOfferClarificationButtons(slots = []) {
  const currentSlotsForButtons = Array.isArray(slots) ? slots.filter(Boolean) : [];
  const hasKnownEventType = Boolean(getKnownEventTypeValue(currentSlotsForButtons));
  const hasMoodGenreClarification = canOfferMoodGenreClarification(currentSlotsForButtons);
  const hasGenre = currentSlotsForButtons.some(
    (slot) =>
      slot.name === 'жанр' || slot.name === 'жанр_музыки' || slot.name === 'предпочтения_жанры'
  );
  const hasBudget = currentSlotsForButtons.some(
    (slot) =>
      slot.name === 'бюджет' ||
      slot.name === 'цена_от' ||
      slot.name === 'цена_до' ||
      slot.name === 'цена'
  );
  const hasTime = currentSlotsForButtons.some((slot) => {
    if (!slot) return false;
    if (slot.name === 'время_события' || slot.name === 'концерт_время') {
      return true;
    }
    if (String(slot.name || '').includes('время')) {
      return true;
    }
    if (slot.timeRange) {
      return true;
    }
    return false;
  });

  const buttons = [];

  if ((hasKnownEventType || hasMoodGenreClarification) && !hasGenre) {
    buttons.push('Уточнить жанр');
  }
  if (!hasBudget) {
    buttons.push('Уточнить бюджет');
  }
  if (!hasTime) {
    buttons.push('Уточнить время');
  }

  return buttons;
}

function buildOfferClarificationText(buttons = []) {
  const buttonToDetail = new Map([
    ['Уточнить жанр', 'жанр'],
    ['Уточнить бюджет', 'бюджет'],
    ['Уточнить время', 'время'],
  ]);

  const details = (Array.isArray(buttons) ? buttons : [])
    .map((button) => buttonToDetail.get(String(button || '').trim()))
    .filter(Boolean);

  if (details.length === 0) {
    return '';
  }

  if (details.length === 1) {
    return `Уточните ${details[0]}, чтобы я мог предложить ещё варианты.`;
  }

  if (details.length === 2) {
    return `Уточните ${details[0]} или ${details[1]}, чтобы я мог предложить ещё варианты.`;
  }

  return `Уточните ${details[0]}, ${details[1]} или ${details[2]}, чтобы я мог предложить ещё варианты.`;
}

function normalizePreferenceToken(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .trim();
}

function getNormalizedDislikedGenres(userPreferences = null) {
  return Array.isArray(userPreferences?.dislikedGenres)
    ? userPreferences.dislikedGenres.map(normalizePreferenceToken).filter(Boolean)
    : [];
}

function hasDislikedGenrePreferences(userPreferences = null) {
  return getNormalizedDislikedGenres(userPreferences).length > 0;
}

function looksLikePopularCategoryPromptText(userMessage = '') {
  const normalized = normalizeClarificationTextForMatch(userMessage);
  if (!normalized) {
    return false;
  }

  return (
    looksLikeUnknownArtistDiscoveryText(userMessage) ||
    /(популяр|известн|лучш|топ|знаменит)/u.test(normalized)
  );
}

function shouldUsePopularSelectionCategoryClarification({
  userMessage = '',
  slots = [],
  knownCity = '',
  fallbackQuery = '',
} = {}) {
  const resolvedCity = String(knownCity || getKnownCityValue(slots) || '').trim();
  const effectiveQuery = String(userMessage || fallbackQuery || '').trim();

  if (!resolvedCity || !effectiveQuery) {
    return false;
  }

  if (getKnownEventTypeValue(slots) || detectCategoryFromText(effectiveQuery)) {
    return false;
  }

  if (!looksLikePopularCategoryPromptText(effectiveQuery)) {
    return false;
  }

  return canUsePopularCitySelection({
    slots,
    fallbackQuery: effectiveQuery,
  });
}

function getPopularCategoryClarificationButtons(seed = '') {
  return [
    ...buildPopularSelectionCategoryButtons(seed || 'popular-category-clarification', 4),
    POPULAR_SELECTION_SHOW_ALL_BUTTON,
  ];
}

function getCategoryClarificationButtons(
  slots = [],
  { preferPopularSelectionCategories = false, seed = '' } = {}
) {
  if (preferPopularSelectionCategories) {
    return getPopularCategoryClarificationButtons(seed);
  }

  return hasSeniorFriendlyContext(slots)
    ? ['Театры', 'Выставки', 'Музеи', 'Концерты', 'Покажи все']
    : [...CATEGORY_CLARIFICATION_BUTTONS];
}

function getGenreClarificationButtons(knownEventType = '', userPreferences = null, slots = []) {
  const normalizedEventType = normalizeClarificationTextForMatch(knownEventType);
  const seniorFriendlyContext = hasSeniorFriendlyContext(slots);
  const moodSignal = !normalizedEventType ? resolveMoodSearchSignal({ slots }) : null;
  const useFunMoodFormatButtons = !normalizedEventType && moodSignal?.profile?.key === 'fun';
  const sourceButtons = useFunMoodFormatButtons
    ? FUN_MOOD_GENRE_CLARIFICATION_BUTTONS
    : seniorFriendlyContext &&
        !normalizedEventType.includes('театр') &&
        !normalizedEventType.includes('спектак')
      ? SENIOR_FRIENDLY_GENRE_CLARIFICATION_BUTTONS
      : normalizedEventType.includes('дет')
        ? CHILD_GENRE_CLARIFICATION_BUTTONS
        : normalizedEventType.includes('фестив')
          ? FESTIVAL_GENRE_CLARIFICATION_BUTTONS
          : normalizedEventType.includes('театр') || normalizedEventType.includes('спектак')
            ? THEATER_GENRE_CLARIFICATION_BUTTONS
            : GENRE_CLARIFICATION_BUTTONS;
  const dislikedGenres = new Set(getNormalizedDislikedGenres(userPreferences));
  const filteredButtons = sourceButtons.filter((button) => {
    const normalizedButton = normalizePreferenceToken(button);
    if (!normalizedButton || GENERIC_GENRE_BUTTONS.has(normalizedButton)) {
      return true;
    }

    return !dislikedGenres.has(normalizedButton);
  });

  const finalButtons = filteredButtons.length > 0 ? [...filteredButtons] : [...sourceButtons];

  const specific = [];
  const generic = [];
  for (const btn of finalButtons) {
    const normalized = normalizePreferenceToken(btn);
    if (GENERIC_GENRE_BUTTONS.has(normalized) || normalized === 'другое') {
      generic.push(btn);
    } else {
      specific.push(btn);
    }
  }

  if (specific.length <= 5) {
    return [...specific, ...generic];
  }

  const shuffled = [...specific];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return [...shuffled.slice(0, 5), ...generic];
}

function canOfferMoodGenreClarification(slots = [], knownEventType = '') {
  if (normalizeClarificationTextForMatch(knownEventType)) {
    return false;
  }

  const moodSignal = resolveMoodSearchSignal({ slots });
  return moodSignal?.profile?.key === 'fun';
}

function filterButtonsForSeniorFriendlyContext(buttons = [], slots = []) {
  const normalizedButtons = Array.isArray(buttons) ? buttons.filter(Boolean) : [];
  if (!hasSeniorFriendlyContext(slots)) {
    return normalizedButtons;
  }

  const blockedButtons = new Set([
    'стендап',
    'стэндап',
    'рок',
    'поп',
    'хип-хоп',
    'хип хоп',
    'hip-hop',
    'hip hop',
    'рэп',
    'реп',
  ]);

  const filteredButtons = normalizedButtons.filter(
    (button) => !blockedButtons.has(normalizePreferenceToken(button))
  );
  if (filteredButtons.length > 0) {
    return filteredButtons;
  }

  const knownEventType = getKnownEventTypeValue(slots);
  return knownEventType
    ? getGenreClarificationButtons(knownEventType, null, slots)
    : getCategoryClarificationButtons(slots);
}

export {
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
  looksLikeOfferTextWithoutCards,
  buildOfferClarificationButtons,
  buildOfferClarificationText,
  hasDislikedGenrePreferences,
  shouldUsePopularSelectionCategoryClarification,
  getPopularCategoryClarificationButtons,
  getCategoryClarificationButtons,
  getGenreClarificationButtons,
  canOfferMoodGenreClarification,
  filterButtonsForSeniorFriendlyContext,
};
