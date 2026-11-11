import { describe, expect, test } from '@jest/globals';
import {
  PREFERENCE_TYPES,
  buildPreferenceClearDescriptor,
  buildPreferenceRemoveDescriptor,
  buildPreferenceUpdateDescriptor,
  hasNegativePreferenceCue,
  isBudgetPreferenceSlotName,
  mergePriceRangeWithSlot,
  normalizeEventTitleValue,
  normalizeStoredPreferencesDocument,
  splitPreferenceChangeText,
  shouldSkipPreferenceSave,
} from '../../../../shared/preferenceRules.js';
import { parseBudgetValue } from '../../../../shared/moneyUtils.js';

describe('shared preference rules', () => {
  test('maps pseudo-genre event types consistently and removes opposite dislike', () => {
    const descriptor = buildPreferenceUpdateDescriptor({
      userId: 'u1',
      preferenceType: PREFERENCE_TYPES.GENRE,
      value: 'театры',
      isNegative: false,
      now: new Date('2026-04-03T12:00:00.000Z'),
    });

    expect(descriptor).toMatchObject({
      storedPreferenceType: PREFERENCE_TYPES.EVENT_TYPE,
      normalizedValue: 'театры',
      updateOperation: {
        $addToSet: { eventTypes: 'театры' },
        $pull: { dislikedEventTypes: 'театры' },
      },
    });
  });

  test('applies the same guard rules for slot-based taste preference saves', () => {
    expect(
      shouldSkipPreferenceSave({
        slot: { name: 'жанр_музыки', value: 'рок' },
        preferenceType: PREFERENCE_TYPES.GENRE,
        sourceText: 'хочу рок концерты',
        intents: [],
      })
    ).toBe(true);

    expect(
      shouldSkipPreferenceSave({
        slot: { name: 'жанр_музыки', value: 'рок' },
        preferenceType: PREFERENCE_TYPES.GENRE,
        sourceText: 'я люблю рок концерты',
        intents: [],
      })
    ).toBe(false);

    expect(
      shouldSkipPreferenceSave({
        slot: { name: 'жанр_музыки', value: 'рок' },
        preferenceType: PREFERENCE_TYPES.GENRE,
        sourceText: 'мне больше не нравится рок, хочу оперу',
        intents: [{ name: 'change_preferences' }],
      })
    ).toBe(true);
  });

  test('merges budget slots consistently across services', () => {
    expect(isBudgetPreferenceSlotName('бюджет')).toBe(true);
    expect(isBudgetPreferenceSlotName('цена_от')).toBe(true);
    expect(isBudgetPreferenceSlotName('жанр_музыки')).toBe(false);

    expect(mergePriceRangeWithSlot({ min: 500 }, { name: 'бюджет', value: '1500' })).toEqual({
      min: 500,
      max: 1500,
    });

    expect(mergePriceRangeWithSlot({ max: 2500 }, { name: 'цена_от', value: '900' })).toEqual({
      max: 2500,
      min: 900,
    });

    expect(mergePriceRangeWithSlot({}, { name: 'бюджет', value: '3к' })).toEqual({ max: 3000 });

    expect(mergePriceRangeWithSlot({}, { name: 'бюджет', value: '3 тыщи' })).toEqual({ max: 3000 });

    expect(mergePriceRangeWithSlot({}, { name: 'бюджет', value: '3 000 ₽' })).toEqual({
      max: 3000,
    });
  });

  test('parses common colloquial money formats', () => {
    expect(parseBudgetValue('3000')).toBe(3000);
    expect(parseBudgetValue('3 000 ₽')).toBe(3000);
    expect(parseBudgetValue('3к')).toBe(3000);
    expect(parseBudgetValue('3 к')).toBe(3000);
    expect(parseBudgetValue('3 тыс')).toBe(3000);
    expect(parseBudgetValue('3 тыщи')).toBe(3000);
    expect(parseBudgetValue('3', { sourceText: 'у меня 3к' })).toBe(3000);
  });

  test('builds consistent remove and clear descriptors from shared rules', () => {
    expect(
      buildPreferenceRemoveDescriptor({
        preferenceType: PREFERENCE_TYPES.GENRE,
        value: 'театры',
      })
    ).toMatchObject({
      normalizedValue: 'театры',
      updateOperation: {
        $pull: { eventTypes: 'театры' },
      },
    });

    expect(
      buildPreferenceClearDescriptor({
        preferenceType: PREFERENCE_TYPES.PRICE_RANGE,
      })
    ).toMatchObject({
      updateOperation: {
        $set: { priceRange: null },
      },
    });
  });

  test('splits mixed dislike-plus-target messages by semantic clauses', () => {
    expect(
      splitPreferenceChangeText('я больше не люблю рок, давай посмотрим оперу', {
        hasPositiveTargetSignal: (clause) => clause.includes('опер'),
      })
    ).toMatchObject({
      negativePart: 'я больше не люблю рок',
      positivePart: 'давай посмотрим оперу',
    });

    expect(
      splitPreferenceChangeText('я больше не люблю рок. покажи оперу', {
        hasPositiveTargetSignal: (clause) => clause.includes('опер'),
      })
    ).toMatchObject({
      negativePart: 'я больше не люблю рок',
      positivePart: 'покажи оперу',
    });

    expect(
      splitPreferenceChangeText('не люблю рок и хочу оперу', {
        hasPositiveTargetSignal: (clause) => clause.includes('опер'),
      })
    ).toMatchObject({
      // The conjunction joining the clauses belongs to neither side.
      negativePart: 'не люблю рок',
      positivePart: 'хочу оперу',
    });
  });

  test('keeps negative-only messages without fabricating a positive branch', () => {
    expect(hasNegativePreferenceCue('больше не люблю рок')).toBe(true);
    expect(splitPreferenceChangeText('больше не люблю рок')).toMatchObject({
      negativePart: 'больше не люблю рок',
      positivePart: '',
    });
  });

  test('normalizes disliked event titles case-insensitively', () => {
    expect(normalizeEventTitleValue('  Мастер   и Маргарита ')).toBe('мастер и маргарита');

    expect(
      buildPreferenceUpdateDescriptor({
        userId: 'u1',
        preferenceType: PREFERENCE_TYPES.EVENT_TITLE,
        value: 'Мастер и Маргарита',
        isNegative: true,
      })
    ).toMatchObject({
      normalizedValue: 'мастер и маргарита',
      updateOperation: {
        $addToSet: { dislikedEventTitles: 'мастер и маргарита' },
      },
    });

    expect(
      normalizeStoredPreferencesDocument(
        {
          userId: 'u1',
          dislikedEventTitles: [
            'Мастер и Маргарита',
            'мастер   и маргарита',
            ' Серебряное копытце ',
          ],
        },
        'u1'
      )
    ).toMatchObject({
      dislikedEventTitles: ['мастер и маргарита', 'серебряное копытце'],
    });
  });
});
