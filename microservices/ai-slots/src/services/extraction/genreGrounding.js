import { normalizeGuardText } from './timeGrounding.js';
import { HIP_HOP_GROUNDING_PATTERN } from './policy.js';

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeRussianStem(value = '') {
  const normalized = normalizeGuardText(value);
  if (!normalized) {
    return '';
  }

  const stemmed = normalized.replace(
    /(?:иями|ями|ами|ого|ему|ому|ыми|ими|ыми|ая|ое|ые|ий|ый|ой|ей|ов|ев|ам|ям|ах|ях|ую|юю|а|я|у|ю|е|о|ы|и|ь)$/u,
    ''
  );

  return stemmed.length >= 3 ? stemmed : normalized;
}

function hasLaughIntentGrounding(text = '') {
  return /(посме|смех|смея|смеш|рассмеш|хохот)/u.test(text);
}

function isGenreSlotGrounded(slot, sourceText = '') {
  const normalizedText = normalizeGuardText(sourceText);
  if (!normalizedText) return true;

  const normalizedValue = normalizeGuardText(slot?.value);
  if (!normalizedValue) return false;

  if (
    (normalizedValue === 'рэп' || normalizedValue === 'хип-хоп') &&
    HIP_HOP_GROUNDING_PATTERN.test(normalizedText)
  ) {
    return true;
  }

  if (
    /(юмор|юморист|комед|ст[еэ]ндап)/u.test(normalizedValue) &&
    hasLaughIntentGrounding(normalizedText)
  ) {
    return true;
  }

  if (normalizedText.includes(normalizedValue)) {
    return true;
  }

  const valueStem = normalizeRussianStem(normalizedValue);
  if (valueStem && normalizedText.includes(valueStem)) {
    return true;
  }

  if (valueStem) {
    const valuePattern = new RegExp(
      `(^|[^\\p{L}\\p{N}_])${escapeRegExp(valueStem)}[\\p{L}]*($|[^\\p{L}\\p{N}_])`,
      'u'
    );
    return valuePattern.test(normalizedText);
  }

  return false;
}

export { escapeRegExp, normalizeRussianStem, isGenreSlotGrounded };
