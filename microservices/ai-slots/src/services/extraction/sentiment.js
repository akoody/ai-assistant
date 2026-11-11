import { escapeRegExp, normalizeRussianStem, isGenreSlotGrounded } from './genreGrounding.js';
import { normalizeGuardText } from './timeGrounding.js';
import { splitPreferenceChangeText as splitSharedPreferenceChangeText } from '../../../../../shared/preferenceRules.js';
import { EVENT_TYPE_SLOT_NAMES, GENRE_SLOT_NAMES, TASTE_SLOT_NAMES } from './policy.js';
import { isEventTypeSlotGrounded } from './eventGrounding.js';

function hasNegativePreferenceContextForValue(sourceText = '', value = '') {
  const normalizedText = normalizeGuardText(sourceText);
  const normalizedValue = normalizeGuardText(value);
  if (!normalizedText || !normalizedValue) {
    return false;
  }

  const valueStem = normalizeRussianStem(normalizedValue);
  const valuePattern = valueStem
    ? `${escapeRegExp(valueStem)}[\\p{L}]*`
    : escapeRegExp(normalizedValue);

  const negativeContextPattern = new RegExp(
    `(?:^|[^\\p{L}\\p{N}_])(?:не\\s+люб\\w*|не\\s+нрав\\w*|больше\\s+не\\s+нрав\\w*|разонрав\\w*|не\\s+хоч\\w*|надоел\\w*|устал\\w*\\s+от)[^.!?]{0,80}${valuePattern}`,
    'u'
  );

  return negativeContextPattern.test(normalizedText);
}

function annotatePreferenceSlotsWithSentiment(slots = [], sourceText = '') {
  const list = Array.isArray(slots) ? slots : [];
  if (!sourceText || list.length === 0) {
    return list;
  }

  const { positivePart, negativePart } = splitSharedPreferenceChangeText(sourceText, {
    hasPositiveTargetSignal: (clauseText) =>
      list.some((slot) => {
        const slotName = String(slot?.name || '').trim();
        if (!slot || !TASTE_SLOT_NAMES.has(slotName)) {
          return false;
        }

        if (GENRE_SLOT_NAMES.has(slotName) && isGenreSlotGrounded(slot, clauseText)) {
          return true;
        }

        if (EVENT_TYPE_SLOT_NAMES.has(slotName) && isEventTypeSlotGrounded(slot, clauseText)) {
          return true;
        }

        if (slotName === 'исполнитель' || slotName === 'артист') {
          return normalizeGuardText(clauseText).includes(normalizeGuardText(slot.value));
        }

        return false;
      }),
  });
  const normalizedPositivePart = normalizeGuardText(positivePart);

  return list.map((slot) => {
    const slotName = String(slot?.name || '').trim();
    if (!slot || !TASTE_SLOT_NAMES.has(slotName)) {
      return slot;
    }

    const modelPolarity =
      typeof slot.preferencePolarity === 'string'
        ? slot.preferencePolarity.trim().toLowerCase()
        : '';
    const hasExplicitModelPolarity =
      typeof slot.isNegative === 'boolean' ||
      modelPolarity === 'positive' ||
      modelPolarity === 'negative' ||
      modelPolarity === 'neutral';

    if (hasExplicitModelPolarity) {
      if (slot.isNegative === true || modelPolarity === 'negative') {
        return {
          ...slot,
          isNegative: true,
          preferencePolarity: 'negative',
        };
      }

      return {
        ...slot,
        isNegative: false,
        preferencePolarity: modelPolarity === 'neutral' ? 'neutral' : 'positive',
      };
    }

    if (positivePart && GENRE_SLOT_NAMES.has(slotName) && isGenreSlotGrounded(slot, positivePart)) {
      return slot;
    }

    if (
      positivePart &&
      EVENT_TYPE_SLOT_NAMES.has(slotName) &&
      isEventTypeSlotGrounded(slot, positivePart)
    ) {
      return slot;
    }

    if (
      positivePart &&
      (slotName === 'исполнитель' || slotName === 'артист') &&
      normalizedPositivePart &&
      normalizedPositivePart.includes(normalizeGuardText(slot.value))
    ) {
      return slot;
    }

    const negativeContextSource = negativePart || sourceText;
    if (!hasNegativePreferenceContextForValue(negativeContextSource, slot.value)) {
      return slot;
    }

    return {
      ...slot,
      isNegative: true,
    };
  });
}

export { annotatePreferenceSlotsWithSentiment };
