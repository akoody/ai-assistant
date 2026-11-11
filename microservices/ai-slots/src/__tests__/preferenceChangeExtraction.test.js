import { describe, expect, test } from '@jest/globals';
import {
  annotatePreferenceSlotsWithSentiment,
  shouldKeepSlotAfterConfidenceFilter,
} from '../services/queueService.js';

describe('preference change extraction', () => {
  test('keeps grounded slots even when LLM omitted confidence', () => {
    const message = 'мне больше не нравятся рок концерты, я хочу теперь оперу';

    expect(
      shouldKeepSlotAfterConfidenceFilter(
        { name: 'тип_мероприятия', value: 'театры' },
        0.6,
        message
      )
    ).toBe(true);

    expect(
      shouldKeepSlotAfterConfidenceFilter({ name: 'жанр', value: 'оперу' }, 0.6, message)
    ).toBe(true);
  });

  test('marks only outdated taste slots as negative', () => {
    const slots = annotatePreferenceSlotsWithSentiment(
      [
        { name: 'жанр_музыки', value: 'рок' },
        { name: 'тип_мероприятия', value: 'театры' },
        { name: 'жанр', value: 'опера' },
      ],
      'мне больше не нравятся рок концерты, я хочу теперь оперу'
    );

    expect(slots.find((slot) => slot.name === 'жанр_музыки')?.isNegative).toBe(true);
    expect(slots.find((slot) => slot.name === 'тип_мероприятия')?.isNegative).not.toBe(true);
    expect(slots.find((slot) => slot.name === 'жанр')?.isNegative).not.toBe(true);
  });

  test('keeps opera target positive in mixed dislike-plus-search phrasing', () => {
    const slots = annotatePreferenceSlotsWithSentiment(
      [
        { name: 'жанр_музыки', value: 'рок' },
        { name: 'жанр', value: 'оперы' },
        { name: 'жанр_музыки', value: 'классика' },
      ],
      'я больше не люблю рок, давай посмотрим оперу'
    );

    expect(
      slots.find((slot) => slot.name === 'жанр_музыки' && slot.value === 'рок')?.isNegative
    ).toBe(true);
    expect(
      slots.find((slot) => slot.name === 'жанр' && slot.value === 'оперы')?.isNegative
    ).not.toBe(true);
    expect(
      slots.find((slot) => slot.name === 'жанр_музыки' && slot.value === 'классика')?.isNegative
    ).not.toBe(true);
  });

  test('does not treat "мне нравится" as negative preference cue', () => {
    const slots = annotatePreferenceSlotsWithSentiment(
      [
        { name: 'жанр', value: 'мюзикл' },
        { name: 'жанр', value: 'балет' },
      ],
      'Мне нравится мюзикл и балет'
    );

    expect(slots.find((slot) => slot.value === 'мюзикл')?.isNegative).not.toBe(true);
    expect(slots.find((slot) => slot.value === 'балет')?.isNegative).not.toBe(true);
  });

  test('prefers explicit positive polarity from llm over fallback heuristics', () => {
    const slots = annotatePreferenceSlotsWithSentiment(
      [
        { name: 'жанр', value: 'мюзикл', isNegative: false, preferencePolarity: 'positive' },
        { name: 'жанр', value: 'балет', isNegative: false, preferencePolarity: 'positive' },
      ],
      'Мне нравится мюзикл и балет'
    );

    expect(slots.find((slot) => slot.value === 'мюзикл')?.isNegative).toBe(false);
    expect(slots.find((slot) => slot.value === 'мюзикл')?.preferencePolarity).toBe('positive');
    expect(slots.find((slot) => slot.value === 'балет')?.isNegative).toBe(false);
    expect(slots.find((slot) => slot.value === 'балет')?.preferencePolarity).toBe('positive');
  });

  test('prefers explicit negative polarity from llm over fallback heuristics', () => {
    const slots = annotatePreferenceSlotsWithSentiment(
      [{ name: 'жанр_музыки', value: 'рок', isNegative: true, preferencePolarity: 'negative' }],
      'Я больше не люблю рок'
    );

    expect(slots.find((slot) => slot.value === 'рок')?.isNegative).toBe(true);
    expect(slots.find((slot) => slot.value === 'рок')?.preferencePolarity).toBe('negative');
  });
});
