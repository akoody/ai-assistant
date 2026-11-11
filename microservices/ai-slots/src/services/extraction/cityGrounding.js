import { escapeRegExp, normalizeRussianStem, isGenreSlotGrounded } from './genreGrounding.js';
import { normalizeGuardText } from './timeGrounding.js';
import { EVENT_TYPE_SLOT_NAMES, GENRE_SLOT_NAMES } from './policy.js';
import { isEventTypeSlotGrounded } from './eventGrounding.js';

function isCitySlotGrounded(slot, sourceText = '') {
  if (!slot || slot.value === undefined || slot.value === null) {
    return false;
  }

  if (slot.source === 'heuristic') {
    return true;
  }

  const normalizedText = normalizeGuardText(sourceText);
  if (!normalizedText) {
    return true;
  }

  const normalizedValue = normalizeGuardText(slot.value);
  if (!normalizedValue) {
    return false;
  }

  if (normalizedText.includes(normalizedValue)) {
    return true;
  }

  // Для городов с падежами/многословных названий (например "Нижнем Новгороде")
  // проверяем совпадение по стемам каждого компонента названия города.
  if (isCityMentionByTokenStems(normalizedValue, normalizedText)) {
    return true;
  }

  const valueStem = normalizeRussianStem(normalizedValue);
  if (valueStem && normalizedText.includes(valueStem)) {
    return true;
  }

  if (normalizedValue === 'москва') {
    return /(?:^|[^\p{L}\p{N}_])(?:москв[\p{L}]*|мск)(?=$|[^\p{L}\p{N}_])/u.test(normalizedText);
  }

  if (normalizedValue === 'санкт-петербург' || normalizedValue === 'санкт петербург') {
    return /(?:^|[^\p{L}\p{N}_])(?:санкт[\s-]?петер[\p{L}]*|питер[\p{L}]*|спб|с-?пб)(?=$|[^\p{L}\p{N}_])/u.test(
      normalizedText
    );
  }

  if (valueStem) {
    const valuePattern = new RegExp(
      `(^|[^\\p{L}\\p{N}_])${escapeRegExp(valueStem)}[\\p{L}-]*($|[^\\p{L}\\p{N}_])`,
      'u'
    );
    return valuePattern.test(normalizedText);
  }

  return false;
}

function tokenizeAlphaNumericWords(value = '') {
  return normalizeGuardText(value)
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function isCityMentionByTokenStems(cityValue = '', sourceText = '') {
  const cityTokens = tokenizeAlphaNumericWords(cityValue);
  const textTokens = tokenizeAlphaNumericWords(sourceText);
  if (cityTokens.length === 0 || textTokens.length === 0) {
    return false;
  }

  // Для многословных городов требуем покрытие всех значимых токенов
  // (нижний+новгород; санкт+петербург и т.п.).
  return cityTokens.every((cityToken) => {
    const cityStem = normalizeRussianStem(cityToken);
    if (!cityStem || cityStem.length < 2) {
      return false;
    }

    return textTokens.some((textToken) => {
      const textStem = normalizeRussianStem(textToken);
      if (!textStem) return false;
      return textStem.startsWith(cityStem) || cityStem.startsWith(textStem);
    });
  });
}

function shouldKeepSlotAfterConfidenceFilter(slot, confidenceThreshold, sourceText = '') {
  const confidence = typeof slot?.confidence === 'number' ? slot.confidence : null;
  if (confidence !== null) {
    return confidence >= confidenceThreshold;
  }

  return hasGroundedConfidenceFallback(slot, sourceText);
}

function hasGroundedConfidenceFallback(slot, sourceText = '') {
  if (!slot || !slot.name || slot.value === undefined || slot.value === null) {
    return false;
  }

  const slotName = String(slot.name || '').trim();
  const slotValue = String(slot.value || '').trim();
  if (!slotValue) {
    return false;
  }

  if (EVENT_TYPE_SLOT_NAMES.has(slotName)) {
    return isEventTypeSlotGrounded(slot, sourceText);
  }

  if (GENRE_SLOT_NAMES.has(slotName)) {
    return isGenreSlotGrounded(slot, sourceText);
  }

  return false;
}

export { isCitySlotGrounded, shouldKeepSlotAfterConfidenceFilter };
