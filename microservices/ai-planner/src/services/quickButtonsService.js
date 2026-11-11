import {
  POPULAR_SELECTION_CATEGORY_BUTTONS,
  POPULAR_SELECTION_SHOW_ALL_BUTTON,
  getPopularSelectionCategorySlotValue,
  isPopularSelectionCategoryButton,
} from '../../../../shared/popularSelectionCategories.js';

const SHOW_ALL_BUTTON = POPULAR_SELECTION_SHOW_ALL_BUTTON;
const CATEGORY_BUTTONS = ['Концерты', 'Театры', 'Выставки', 'Музеи', SHOW_ALL_BUTTON];
const EXTRA_CATEGORY_BUTTONS = [
  'Шоу',
  'Детям',
  'Туристам',
  'Экскурсии',
  'Образование',
  'Фестивали',
  'Кино',
  'Квесты',
  'Квизы',
  'Праздники',
];
const CATEGORY_BUTTON_SET = new Set(CATEGORY_BUTTONS);
const ANY_CATEGORY_BUTTON_SET = new Set([
  ...CATEGORY_BUTTONS,
  ...EXTRA_CATEGORY_BUTTONS,
  ...POPULAR_SELECTION_CATEGORY_BUTTONS,
]);
const CATEGORY_BUTTON_SLOT_MAP = new Map([
  ['концерты', 'концерты'],
  ['театры', 'театры'],
  ['выставки', 'выставки'],
  ['музеи', 'музеи'],
  ['шоу', 'шоу'],
  ['детям', 'детям'],
  ['туристам', 'туристам'],
  ['экскурсии', 'экскурсии'],
  ['образование', 'образование'],
  ['фестивали', 'фестивали'],
  ['кино', 'кино'],
  ['квесты', 'квесты'],
  ['квизы', 'квизы'],
  ['праздники', 'праздники'],
  ['стендап', 'стендап'],
  ['стэндап', 'стендап'],
  ['спорт', 'спорт'],
]);
const GENRE_CLARIFICATION_BUTTONS = [
  'Рок',
  'Поп',
  'Джаз',
  'Классика',
  'Клубы',
  'Хип-хоп',
  'Любой',
  SHOW_ALL_BUTTON,
];
const BUDGET_CLARIFICATION_BUTTONS = ['До 500₽', 'До 1000₽', 'До 3000₽', 'До 5000₽', 'Не важно'];
const TIME_CLARIFICATION_BUTTONS = [
  'Утром',
  'Днем',
  'Вечером',
  'Ночью',
  'Любое время',
  SHOW_ALL_BUTTON,
];
const DATE_CLARIFICATION_BUTTONS = [
  'Сегодня',
  'Завтра',
  'Ближайшие выходные',
  'На следующей неделе',
  'Любая',
  SHOW_ALL_BUTTON,
];
const BUDGET_BUTTON_SLOT_MAP = new Map([
  ['до 500₽', { name: 'цена_до', value: '500' }],
  ['до 1000₽', { name: 'цена_до', value: '1000' }],
  ['до 3000₽', { name: 'цена_до', value: '3000' }],
  ['до 5000₽', { name: 'цена_до', value: '5000' }],
  ['не важно', { name: 'бюджет', value: 'любой' }],
]);
const CLARIFICATION_ACTION_TARGET_MAP = new Map([
  ['уточнить категорию', 'category'],
  ['изменить категорию', 'category'],
  ['выбрать категорию', 'category'],
  ['уточнить жанр', 'genre'],
  ['выбрать жанр', 'genre'],
  ['другой жанр', 'genre'],
  ['уточнить бюджет', 'budget'],
  ['изменить бюджет', 'budget'],
  ['уточнить время', 'time'],
  ['изменить время', 'time'],
  ['выбрать время', 'time'],
  ['уточнить дату', 'date'],
  ['изменить дату', 'date'],
]);
const CLARIFICATION_ACTION_BUTTONS = new Set(CLARIFICATION_ACTION_TARGET_MAP.keys());
const KNOWN_BUTTON_GROUPS = [
  { buttons: CATEGORY_BUTTONS, minMatch: 3 },
  { buttons: GENRE_CLARIFICATION_BUTTONS, minMatch: 3 },
  { buttons: BUDGET_CLARIFICATION_BUTTONS, minMatch: 3 },
  { buttons: TIME_CLARIFICATION_BUTTONS, minMatch: 3 },
  { buttons: DATE_CLARIFICATION_BUTTONS, minMatch: 3 },
];

function normalizeText(value) {
  if (typeof value !== 'string') return '';
  return value.toLowerCase().replace(/ё/g, 'е').trim();
}

function dedupeButtons(buttons = []) {
  const result = [];
  const seen = new Set();

  buttons.forEach((button) => {
    const trimmed = typeof button === 'string' ? button.trim() : '';
    if (!trimmed) return;

    const normalized = normalizeText(trimmed);
    if (!normalized || seen.has(normalized)) return;

    seen.add(normalized);
    result.push(normalized === 'покажи все' ? SHOW_ALL_BUTTON : trimmed);
  });

  return result;
}

export function dedupeQuickReplyButtons(buttons = []) {
  return dedupeButtons(buttons);
}

export function normalizeQuickReplyText(value) {
  return normalizeText(value);
}

export function hasCategoryButtons(buttons = []) {
  if (!Array.isArray(buttons) || buttons.length === 0) return false;
  return buttons.some((button) => {
    const trimmed = String(button || '').trim();
    return ANY_CATEGORY_BUTTON_SET.has(trimmed) || isPopularSelectionCategoryButton(trimmed);
  });
}

export function isQuickCategoryButtonText(text) {
  const normalized = normalizeText(text);
  return (
    normalized === 'концерты' ||
    normalized === 'театры' ||
    normalized === 'выставки' ||
    normalized === 'музеи' ||
    normalized === 'шоу' ||
    normalized === 'детям' ||
    normalized === 'туристам' ||
    normalized === 'экскурсии' ||
    normalized === 'образование' ||
    normalized === 'фестивали' ||
    normalized === 'кино' ||
    normalized === 'квесты' ||
    normalized === 'квизы' ||
    normalized === 'праздники' ||
    normalized === 'стендап' ||
    normalized === 'стэндап' ||
    normalized === 'спорт' ||
    normalized === 'покажи все' ||
    normalized === 'покажи всё' ||
    Boolean(getPopularSelectionCategorySlotValue(normalized))
  );
}

export function matchesAnyButtonText(userText, buttons = []) {
  const normalizedUser = normalizeText(userText);
  if (!normalizedUser || !Array.isArray(buttons) || buttons.length === 0) return false;
  return buttons.some((button) => normalizeText(button) === normalizedUser);
}

export function inferClarificationActionFromText(userText) {
  const normalizedUser = normalizeText(userText);
  if (!normalizedUser) return '';
  return CLARIFICATION_ACTION_TARGET_MAP.get(normalizedUser) || '';
}

export function inferClarificationActionFromButtons(userText, buttons = []) {
  const inferredFromText = inferClarificationActionFromText(userText);
  if (!inferredFromText || !Array.isArray(buttons) || buttons.length === 0) return '';

  const hasClarificationButtons = buttons.some((button) =>
    CLARIFICATION_ACTION_BUTTONS.has(normalizeText(button))
  );

  if (!hasClarificationButtons) {
    return '';
  }

  return inferredFromText;
}

const DATE_BUTTON_VALUE_MAP = new Map([
  ['сегодня', 'сегодня'],
  ['завтра', 'завтра'],
  ['ближайшие выходные', 'ближайшие выходные'],
  ['на этой неделе', 'на этой неделе'],
  ['эта неделя', 'эта неделя'],
  ['эту неделю', 'эту неделю'],
  ['на следующей неделе', 'на следующей неделе'],
  ['следующая неделя', 'следующая неделя'],
  ['следующую неделю', 'следующую неделю'],
  ['любая', 'любая'],
  ['любая дата', 'любая'],
  ['любое время', 'любая'],
]);

const DATE_BUTTON_HINTS = new Set(DATE_BUTTON_VALUE_MAP.keys());
const TIME_BUTTON_SLOT_MAP = new Map([
  [
    'утром',
    {
      name: 'время_события',
      value: 'утром',
      parsedDate: null,
      timeRange: { startHour: 6, startMinute: 0, endHour: 11, endMinute: 59 },
    },
  ],
  [
    'днем',
    {
      name: 'время_события',
      value: 'днем',
      parsedDate: null,
      timeRange: { startHour: 12, startMinute: 0, endHour: 16, endMinute: 59 },
    },
  ],
  [
    'вечером',
    {
      name: 'время_события',
      value: 'вечером',
      parsedDate: null,
      timeRange: { startHour: 17, startMinute: 0, endHour: 21, endMinute: 59 },
    },
  ],
  [
    'ночью',
    {
      name: 'время_события',
      value: 'ночью',
      parsedDate: null,
      timeRange: { startHour: 22, startMinute: 0, endHour: 23, endMinute: 59 },
    },
  ],
  [
    'любое время',
    {
      name: 'время_события',
      value: 'любое время',
      parsedDate: null,
      timeRange: null,
    },
  ],
]);
const TIME_BUTTON_HINTS = new Set(TIME_BUTTON_SLOT_MAP.keys());

export function inferUiSlotFromButtons(userText, buttons = []) {
  const normalizedUser = normalizeText(userText);
  if (!normalizedUser || !Array.isArray(buttons) || buttons.length === 0) return null;

  const hasCategoryButtons = buttons.some((b) => {
    const normalizedButton = normalizeText(b);
    return (
      CATEGORY_BUTTON_SLOT_MAP.has(normalizedButton) ||
      Boolean(getPopularSelectionCategorySlotValue(normalizedButton)) ||
      normalizedButton === 'покажи все'
    );
  });

  if (
    hasCategoryButtons &&
    (CATEGORY_BUTTON_SLOT_MAP.has(normalizedUser) ||
      Boolean(getPopularSelectionCategorySlotValue(normalizedUser)))
  ) {
    return {
      name: 'тип_мероприятия',
      value:
        CATEGORY_BUTTON_SLOT_MAP.get(normalizedUser) ||
        getPopularSelectionCategorySlotValue(normalizedUser),
      confidence: 1.0,
      source: 'ui',
    };
  }

  const hasTimeButtons = buttons.some((b) => TIME_BUTTON_HINTS.has(normalizeText(b)));
  if (hasTimeButtons && TIME_BUTTON_SLOT_MAP.has(normalizedUser)) {
    return {
      ...TIME_BUTTON_SLOT_MAP.get(normalizedUser),
      confidence: 1.0,
      source: 'ui',
    };
  }

  const hasDateButtons = buttons.some((b) => DATE_BUTTON_HINTS.has(normalizeText(b)));

  if (hasDateButtons && DATE_BUTTON_VALUE_MAP.has(normalizedUser)) {
    return {
      name: 'дата_события',
      value: DATE_BUTTON_VALUE_MAP.get(normalizedUser),
      confidence: 1.0,
      source: 'ui',
    };
  }

  const hasBudgetButtons = buttons.some((b) => BUDGET_BUTTON_SLOT_MAP.has(normalizeText(b)));
  if (hasBudgetButtons && BUDGET_BUTTON_SLOT_MAP.has(normalizedUser)) {
    return {
      ...BUDGET_BUTTON_SLOT_MAP.get(normalizedUser),
      confidence: 1.0,
      source: 'ui',
    };
  }

  return null;
}

export function ensureCategoryButtonsCta(message, buttons = []) {
  const text = String(message || '').trim();
  if (!hasCategoryButtons(buttons)) return text;

  const normalized = normalizeText(text);
  const alreadyExplainsButtons =
    /(?:что\s+(?:вам|вас)\s+интерес|выберите|выбрать|категор|нажмит|можете\s+выбрать|хотите\s+посмотр|хотите\s+найти)/u.test(
      normalized
    ) || /\?/u.test(text);

  if (alreadyExplainsButtons) return text;

  if (!text) return 'Хотите посмотреть что-то другое? Выберите категорию:';
  return `${text}\n\nХотите посмотреть что-то другое? Выберите категорию:`;
}

export function ensureCompleteCategoryButtons(buttons = []) {
  const normalizedButtons = dedupeButtons(buttons);
  if (normalizedButtons.length === 0) {
    return normalizedButtons;
  }

  const hasNonCategoryButton = normalizedButtons.some(
    (button) => !CATEGORY_BUTTON_SET.has(String(button || '').trim())
  );
  if (hasNonCategoryButton) {
    return normalizedButtons;
  }

  const hasRealCategory = normalizedButtons.some(
    (button) => normalizeText(button) !== 'покажи все'
  );
  if (!hasRealCategory) {
    return normalizedButtons;
  }

  if (normalizedButtons.length >= CATEGORY_BUTTONS.length) {
    return normalizedButtons;
  }

  return [...CATEGORY_BUTTONS];
}

export function ensureShowAllButton(buttons = []) {
  const normalizedButtons = dedupeButtons(buttons);
  if (normalizedButtons.length === 0) return normalizedButtons;

  const hasShowAll = normalizedButtons.some((button) => normalizeText(button) === 'покажи все');
  if (hasShowAll) {
    return normalizedButtons;
  }

  const shouldAddShowAll = KNOWN_BUTTON_GROUPS.some(({ buttons: groupButtons, minMatch }) => {
    const normalizedGroup = new Set(groupButtons.map(normalizeText));
    const matchedCount = normalizedButtons.reduce(
      (count, button) => (normalizedGroup.has(normalizeText(button)) ? count + 1 : count),
      0
    );

    return matchedCount >= minMatch && matchedCount === normalizedButtons.length;
  });

  if (!shouldAddShowAll) {
    return normalizedButtons;
  }

  return [...normalizedButtons, SHOW_ALL_BUTTON];
}

export const CATEGORY_QUICK_BUTTONS = CATEGORY_BUTTONS;
