const SHOW_ALL_BUTTON = 'Покажи все';

const POPULAR_SELECTION_CATEGORY_OPTIONS = Object.freeze([
  { button: 'Квизы', slotValue: 'квизы' },
  { button: 'Выставки', slotValue: 'выставки' },
  { button: 'Музеи', slotValue: 'музеи' },
  { button: 'Экскурсии', slotValue: 'экскурсии' },
  { button: 'Стендап', slotValue: 'стендап' },
  { button: 'Образование', slotValue: 'образование' },
  { button: 'Квесты', slotValue: 'квесты' },
  { button: 'Концерты', slotValue: 'концерты' },
  { button: 'Театры', slotValue: 'театры' },
  { button: 'Шоу', slotValue: 'шоу' },
  { button: 'Детям', slotValue: 'детям' },
  { button: 'Спорт', slotValue: 'спорт' },
  { button: 'Фестивали', slotValue: 'фестивали' },
  { button: 'Праздники', slotValue: 'праздники' },
  { button: 'Кино', slotValue: 'кино' },
  { button: 'Туристам', slotValue: 'туристам' },
  { button: 'Распродажа', slotValue: 'распродажа' },
]);

function normalizeText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .trim();
}

function hashToIndex(value, modulo) {
  if (!modulo || modulo <= 0) {
    return 0;
  }

  const text = String(value || '');
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }

  return hash % modulo;
}

const CATEGORY_BUTTON_TO_SLOT_VALUE = new Map(
  POPULAR_SELECTION_CATEGORY_OPTIONS.map(({ button, slotValue }) => [
    normalizeText(button),
    slotValue,
  ])
);

export const POPULAR_SELECTION_SHOW_ALL_BUTTON = SHOW_ALL_BUTTON;
export const POPULAR_SELECTION_CATEGORY_BUTTONS = Object.freeze(
  POPULAR_SELECTION_CATEGORY_OPTIONS.map(({ button }) => button)
);

export function getPopularSelectionCategorySlotValue(value = '') {
  return CATEGORY_BUTTON_TO_SLOT_VALUE.get(normalizeText(value)) || null;
}

export function isPopularSelectionCategoryButton(value = '') {
  return Boolean(getPopularSelectionCategorySlotValue(value));
}

export function buildPopularSelectionCategoryButtons(seed = '', count = 4) {
  const normalizedCount = Number.isFinite(count)
    ? Math.max(1, Math.min(Math.floor(count), POPULAR_SELECTION_CATEGORY_OPTIONS.length))
    : 4;
  const ordered = [...POPULAR_SELECTION_CATEGORY_OPTIONS]
    .map((option) => ({
      ...option,
      weight: hashToIndex(`${seed}|${normalizeText(option.button)}`, 1000003),
    }))
    .sort((left, right) => {
      if (left.weight !== right.weight) {
        return left.weight - right.weight;
      }
      return left.button.localeCompare(right.button, 'ru');
    });

  return ordered.slice(0, normalizedCount).map(({ button }) => button);
}
