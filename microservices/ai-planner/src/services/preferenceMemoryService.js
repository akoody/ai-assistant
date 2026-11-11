import {
  detectPreferenceMemorySignals,
  isMetaPreferenceGenreValue,
} from '../../../../shared/preferenceRules.js';

function normalizeText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

function getLatestArrayValue(values = []) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = String(values[index] || '').trim();
    if (value) {
      return value;
    }
  }

  return null;
}

function getMeaningfulArrayValues(values = []) {
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }

  const result = [];
  const seen = new Set();

  values.forEach((rawValue) => {
    const value = String(rawValue || '').trim();
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    result.push(value);
  });

  return result;
}

function hasPositiveNumber(value) {
  return Number.isFinite(value) && value > 0;
}

function hasReusablePriceRange(preferences = null) {
  const min = Number(preferences?.priceRange?.min);
  const max = Number(preferences?.priceRange?.max);
  return hasPositiveNumber(min) || hasPositiveNumber(max);
}

export function hasTastePreferenceMemory(preferences = null) {
  return Boolean(
    getLatestArrayValue(preferences?.genres) ||
    getLatestArrayValue(preferences?.artists) ||
    getLatestArrayValue(preferences?.eventTypes) ||
    getLatestArrayValue(preferences?.dislikedGenres) ||
    getLatestArrayValue(preferences?.dislikedArtists) ||
    getLatestArrayValue(preferences?.dislikedEventTypes)
  );
}

export function hasStoredPreferenceMemory(preferences = null) {
  return Boolean(
    hasTastePreferenceMemory(preferences) ||
    hasReusablePriceRange(preferences) ||
    String(preferences?.city || '').trim()
  );
}

const GENERIC_PLACEHOLDER_VALUES = new Set([
  '',
  'не указано',
  'не указан',
  'не указана',
  'не указаны',
  'неизвестно',
  'не выбран',
  'не выбрано',
  'none',
  'null',
  'undefined',
  'unknown',
  'n/a',
  'na',
]);

const NON_LIMIT_BUDGET_VALUES = new Set([
  'любой',
  'любой бюджет',
  'любая цена',
  'не важно',
  'неважно',
]);

const BUDGET_SLOT_NAMES = new Set(['бюджет', 'цена_до', 'цена_от', 'цена']);

export function isMeaningfulPreferenceSlotValue(slotName = '', value = '') {
  const normalizedSlotName = normalizeText(slotName);
  const normalizedValue = normalizeText(value);

  if (!normalizedValue || GENERIC_PLACEHOLDER_VALUES.has(normalizedValue)) {
    return false;
  }

  if (normalizedSlotName === 'город') {
    if (
      normalizedValue === 'мой город' ||
      normalizedValue === 'текущий город' ||
      normalizedValue.includes('в моем городе') ||
      normalizedValue.includes('в моём городе')
    ) {
      return false;
    }
  }

  if (
    normalizedSlotName === 'жанр' ||
    normalizedSlotName === 'жанр_музыки' ||
    normalizedSlotName === 'предпочтения_жанры'
  ) {
    if (isMetaPreferenceGenreValue(normalizedValue)) {
      return false;
    }
  }

  if (BUDGET_SLOT_NAMES.has(normalizedSlotName)) {
    if (NON_LIMIT_BUDGET_VALUES.has(normalizedValue)) {
      return false;
    }

    const digits = normalizedValue.replace(/[^0-9]/g, '');
    return digits.length > 0;
  }

  return true;
}

export function detectPreferenceMemoryRequest(text = '') {
  return detectPreferenceMemorySignals(text, { requireAction: true });
}

export function buildPreferenceSlotsFromPreferences({
  userPreferences = null,
  existingSlots = [],
  memoryRequest = null,
} = {}) {
  if (!userPreferences || !memoryRequest?.wantsAnyPreferenceMemory) {
    return [];
  }

  const slots = Array.isArray(existingSlots) ? existingSlots.filter(Boolean) : [];
  const hasSlot = (names) =>
    slots.some(
      (slot) =>
        slot && names.includes(slot.name) && isMeaningfulPreferenceSlotValue(slot.name, slot.value)
    );
  const result = [];
  const pushSlot = (slot) => {
    if (!slot?.name || slot.value === undefined || slot.value === null) {
      return;
    }
    if (result.some((item) => item.name === slot.name && item.value === slot.value)) {
      return;
    }
    result.push(slot);
  };
  const pushMemorySlot = (name, value, isNegative = false) => {
    if (!value) {
      return;
    }

    pushSlot({
      name,
      value,
      confidence: 0.95,
      source: 'memory_preference',
      ...(isNegative ? { isNegative: true } : {}),
    });
  };

  const shouldUseGeneralMemory = Boolean(memoryRequest.wantsGeneralPreferenceMemory);
  const shouldUseTasteMemory = Boolean(memoryRequest.wantsTasteMemory);
  const shouldUseBudgetMemory = Boolean(memoryRequest.wantsBudgetMemory || shouldUseGeneralMemory);

  if (shouldUseGeneralMemory && !hasSlot(['тип_мероприятия', 'тип_события'])) {
    const preferredEventType = getLatestArrayValue(userPreferences.eventTypes);
    const dislikedEventType = getLatestArrayValue(userPreferences.dislikedEventTypes);

    if (preferredEventType) {
      pushMemorySlot('тип_мероприятия', preferredEventType);
    } else if (dislikedEventType) {
      pushMemorySlot('тип_мероприятия', dislikedEventType, true);
    }
  }

  if (shouldUseTasteMemory && !hasSlot(['жанр', 'жанр_музыки', 'предпочтения_жанры'])) {
    const preferredGenres = getMeaningfulArrayValues(userPreferences.genres);
    const dislikedGenres = getMeaningfulArrayValues(userPreferences.dislikedGenres);

    if (preferredGenres.length > 0) {
      preferredGenres.forEach((genre) => {
        pushMemorySlot('предпочтения_жанры', genre);
      });
    } else if (dislikedGenres.length > 0) {
      dislikedGenres.forEach((genre) => {
        pushMemorySlot('предпочтения_жанры', genre, true);
      });
    } else if (shouldUseGeneralMemory && !hasSlot(['исполнитель', 'артист'])) {
      const preferredArtist = getLatestArrayValue(userPreferences.artists);
      const dislikedArtist = getLatestArrayValue(userPreferences.dislikedArtists);

      if (preferredArtist) {
        pushMemorySlot('исполнитель', preferredArtist);
      } else if (dislikedArtist) {
        pushMemorySlot('исполнитель', dislikedArtist, true);
      }
    }
  }

  if (shouldUseBudgetMemory && !hasSlot(['бюджет', 'цена_до', 'цена_от', 'цена'])) {
    const min = Number(userPreferences?.priceRange?.min);
    const max = Number(userPreferences?.priceRange?.max);

    if (hasPositiveNumber(min)) {
      pushSlot({
        name: 'цена_от',
        value: String(min),
        confidence: 0.95,
        source: 'memory_preference',
      });
    }

    if (hasPositiveNumber(max)) {
      pushSlot({
        name: 'цена_до',
        value: String(max),
        confidence: 0.95,
        source: 'memory_preference',
      });
    }
  }

  if (shouldUseGeneralMemory && !hasSlot(['город'])) {
    const preferredCity = String(userPreferences.city || '').trim();
    if (preferredCity) {
      pushMemorySlot('город', preferredCity);
    }
  }

  return result;
}
