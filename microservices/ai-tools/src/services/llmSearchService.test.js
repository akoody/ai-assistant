import { describe, expect, test } from '@jest/globals';
import { __testUtils } from './llmSearchService.js';

describe('llmSearchService payload compaction', () => {
  test('compacts history entries and drops heavy offer metadata', () => {
    const compacted = __testUtils.compactHistory([
      {
        role: 'assistant',
        content: 'Я нашёл варианты. '.repeat(40),
        metadata: {
          buttons: ['Показать другие варианты', 'Уточнить жанр'],
          offer: {
            events: Array.from({ length: 5 }, (_, index) => ({
              title: `Событие ${index + 1}`,
              description: 'Очень длинное описание '.repeat(100),
            })),
          },
        },
      },
    ]);

    expect(compacted).toHaveLength(1);
    expect(compacted[0]).toEqual(
      expect.objectContaining({
        role: 'assistant',
        buttons: ['Показать другие варианты', 'Уточнить жанр'],
      })
    );
    expect(compacted[0].content.length).toBeLessThanOrEqual(320);
    expect(JSON.stringify(compacted[0])).not.toContain('Событие 1');
    expect(JSON.stringify(compacted[0])).not.toContain('Очень длинное описание');
  });

  test('detects oversized payloads before sending search-filter to LLM', () => {
    const oversizedPayload = {
      history: Array.from({ length: 8 }, () => ({
        role: 'assistant',
        content: 'Очень длинный текст '.repeat(300),
      })),
      candidateEvents: Array.from({ length: 20 }, (_, index) => ({
        index,
        title: `Событие ${index + 1}`,
        description: 'Описание '.repeat(200),
      })),
    };

    expect(__testUtils.isPayloadTooLarge(oversizedPayload, 16000)).toBe(true);
  });
});
