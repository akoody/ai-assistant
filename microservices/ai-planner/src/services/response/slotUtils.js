import { normalizeText } from './textUtils.js';
import { isVagueArtistDescriptor } from '../../../../../shared/vagueArtistUtils.js';

const EVENT_TYPE_SLOT_NAMES = new Set([
  'тип_мероприятия',
  'тип_события',
  'предпочтения_типы_событий',
  'категория',
  'category',
  'event_type',
]);

function readSlotValue(slot) {
  if (!slot) return '';
  const raw = slot.value;
  if (typeof raw === 'string') {
    return raw.trim();
  }
  if (raw && typeof raw === 'object') {
    if (typeof raw.original === 'string') return raw.original.trim();
    if (typeof raw.label === 'string') return raw.label.trim();
    if (typeof raw.value === 'string') return raw.value.trim();
  }
  if (typeof raw === 'number') {
    return String(raw);
  }
  return '';
}

function getKnownEventTypeValue(slots = []) {
  if (!Array.isArray(slots)) return '';
  const slot = slots.find(
    (item) => item && EVENT_TYPE_SLOT_NAMES.has(item.name) && readSlotValue(item)
  );
  return slot ? readSlotValue(slot) : '';
}

function getKnownCityValue(slots = []) {
  if (!Array.isArray(slots)) return '';
  const slot = slots.find((item) => item && item.name === 'город' && readSlotValue(item));
  return slot ? readSlotValue(slot) : '';
}

function getKnownDateValue(slots = []) {
  if (!Array.isArray(slots)) return '';
  const slot = slots.find((item) => item && item.name === 'дата_события' && readSlotValue(item));
  return slot ? readSlotValue(slot) : '';
}

function normalizeDateResetValue(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

function isAnyDateSelectionValue(value = '') {
  const normalized = normalizeDateResetValue(value);
  return (
    normalized === 'любая' ||
    normalized === 'любая дата' ||
    normalized === 'любую дату' ||
    normalized === 'любой день' ||
    normalized === 'не важно по дате' ||
    normalized === 'без разницы по дате' ||
    normalized === 'когда угодно'
  );
}

function isAnyDateSelectionSlot(slot = null) {
  return Boolean(slot && slot.name === 'дата_события' && isAnyDateSelectionValue(slot.value));
}

function isNegativeDateSlot(slot = null) {
  return Boolean(slot && slot.name === 'дата_события' && slot.isNegative === true);
}

const QUERY_SLOT_NAMES = new Set([
  'тип_события',
  'тип_мероприятия',
  'жанр',
  'жанр_музыки',
  'предпочтения_жанры',
  'предпочтения_типы_событий',
  'исполнитель',
  'название_мероприятия',
  'категория',
  'поисковый_запрос',
  'настроение',
]);

const SHOW_ALL_KEYWORDS = [
  'покажи все',
  'покажи всё',
  'покажи больше',
  'показать все',
  'показать всё',
  'показать больше',
  'показать варианты',
  'посмотреть все',
  'посмотреть всё',
  'посмотреть еще',
  'посмотреть ещё',
  'больше вариантов',
  'еще варианты',
  'ещё варианты',
  'показать ещё варианты',
  'показать еще варианты',
  'посмотреть больше вариантов',
  'показать больше вариантов',
];

const BUDGET_SLOT_NAMES = new Set(['бюджет', 'цена_до', 'цена']);

function isShowAllSearchQueryValue(value) {
  const normalized = normalizeText(String(value || ''));
  if (!normalized) {
    return false;
  }

  if (normalized === 'все') {
    return true;
  }

  return SHOW_ALL_KEYWORDS.some((keyword) => normalized === normalizeText(keyword));
}

function normalizeComparableSlotValue(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'.,!?;:()[\]{}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function getFirstComparableSlotValue(slots = [], slotNames = []) {
  const names = new Set(Array.isArray(slotNames) ? slotNames : []);
  const slot = (Array.isArray(slots) ? slots : []).find((item) => {
    if (!item || !names.has(item.name) || !item.value) {
      return false;
    }

    if (
      (item.name === 'исполнитель' || item.name === 'артист') &&
      isVagueArtistDescriptor(item.value)
    ) {
      return false;
    }

    return true;
  });
  return normalizeComparableSlotValue(slot?.value || '');
}

function removeSlotsByName(slots = [], slotNames = new Set()) {
  return (Array.isArray(slots) ? slots : []).filter((slot) => slot && !slotNames.has(slot.name));
}

function hasQuerySlot(slots = []) {
  return Array.isArray(slots) && slots.some((slot) => QUERY_SLOT_NAMES.has(slot.name));
}

function mergeSlots(existingSlots = [], incomingSlots = []) {
  const multiValueSlotNames = new Set(['жанр', 'жанр_музыки', 'предпочтения_жанры', 'исполнитель']);
  const slotMap = new Map();

  existingSlots.forEach((slot) => {
    if (slot && slot.name) {
      const slotName = String(slot.name).trim();
      const slotValue = typeof slot.value === 'string' ? slot.value.trim() : (slot.value ?? '');
      const slotKey = multiValueSlotNames.has(slotName)
        ? `${slotName}::${String(slotValue)}`
        : slotName;
      slotMap.set(slotKey, { ...slot });
    }
  });

  incomingSlots.forEach((slot) => {
    if (!slot || !slot.name) {
      return;
    }

    const normalizedName = slot.name;
    const cleanValue = typeof slot.value === 'string' ? slot.value.trim() : (slot.value ?? null);
    const slotKey = multiValueSlotNames.has(normalizedName)
      ? `${normalizedName}::${String(cleanValue ?? '')}`
      : normalizedName;
    const previous = slotMap.get(slotKey) || {};

    const mergedSlot = {
      ...previous,
      ...slot,
      name: normalizedName,
      value: cleanValue,
    };

    if (slot.parsedDate && !(slot.parsedDate instanceof Date)) {
      mergedSlot.parsedDate = new Date(slot.parsedDate);
    }

    if (slot.dateRange) {
      const { startDate, endDate } = slot.dateRange;
      mergedSlot.dateRange = {
        startDate:
          startDate instanceof Date ? startDate : startDate ? new Date(startDate) : undefined,
        endDate: endDate instanceof Date ? endDate : endDate ? new Date(endDate) : undefined,
      };
    }

    if (!mergedSlot.extractedAt) {
      mergedSlot.extractedAt = slot.extractedAt
        ? slot.extractedAt instanceof Date
          ? slot.extractedAt
          : new Date(slot.extractedAt)
        : previous.extractedAt || new Date();
    }

    slotMap.set(slotKey, mergedSlot);
  });

  return Array.from(slotMap.values());
}

export {
  EVENT_TYPE_SLOT_NAMES,
  readSlotValue,
  getKnownEventTypeValue,
  getKnownCityValue,
  getKnownDateValue,
  isAnyDateSelectionSlot,
  isNegativeDateSlot,
  QUERY_SLOT_NAMES,
  SHOW_ALL_KEYWORDS,
  BUDGET_SLOT_NAMES,
  isShowAllSearchQueryValue,
  normalizeComparableSlotValue,
  getFirstComparableSlotValue,
  removeSlotsByName,
  hasQuerySlot,
  mergeSlots,
};
