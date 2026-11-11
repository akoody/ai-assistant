import { describe, expect, test } from '@jest/globals';
import { pickPreferenceMemoryReferenceIntent, pickRecommendationsIntent } from './intentUtils.js';

describe('intentUtils preference memory intent', () => {
  test('picks explicit preference memory reference intent above threshold', () => {
    expect(
      pickPreferenceMemoryReferenceIntent([
        { name: 'recommendations_request', confidence: 0.9 },
        {
          name: 'preference_memory_reference',
          confidence: 0.91,
          trigger: 'на свои любимые жанры',
          memoryType: 'genre',
          source: 'llm',
        },
      ])
    ).toEqual(
      expect.objectContaining({
        name: 'preference_memory_reference',
        memoryType: 'genre',
      })
    );
  });

  test('ignores low-confidence preference memory reference intent', () => {
    expect(
      pickPreferenceMemoryReferenceIntent([
        { name: 'preference_memory_reference', confidence: 0.2, memoryType: 'genre' },
      ])
    ).toBe(null);
  });

  test('keeps recommendations intent available alongside preference memory reference', () => {
    expect(
      pickRecommendationsIntent([
        { name: 'recommendations_request', confidence: 0.88, source: 'llm' },
        {
          name: 'preference_memory_reference',
          confidence: 0.93,
          memoryType: 'genre',
          source: 'llm',
        },
      ])
    ).toEqual(
      expect.objectContaining({
        name: 'recommendations_request',
      })
    );
  });
});
