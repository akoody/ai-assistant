import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { enrichSlotWithDateLlmFallback } from '../services/dateLlmNormalizationService.js';

describe('ai-slots date LLM normalization fallback', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-20T12:00:00.000Z'));
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('normalizes "через месяц" deterministically without LLM fallback', async () => {
    const slot = await enrichSlotWithDateLlmFallback(
      {
        name: 'дата_события',
        value: 'через месяц',
        confidence: 0.95,
      },
      {
        sourceText: 'Хочу через месяц на концерт',
      }
    );

    expect(slot.dateRange).toBeDefined();
    expect(slot.dateRange.startDate.getFullYear()).toBe(2026);
    expect(slot.dateRange.startDate.getMonth()).toBe(4);
    expect(slot.dateRange.startDate.getDate()).toBe(1);
    expect(slot.dateRange.endDate.getFullYear()).toBe(2026);
    expect(slot.dateRange.endDate.getMonth()).toBe(4);
    expect(slot.dateRange.endDate.getDate()).toBe(31);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('keeps deterministic "через месяц" range when LLM is unavailable', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                '{"resolved":true,"parsedDate":"not-a-date","dateRange":{"startDate":"bad","endDate":"bad"}}',
            },
          },
        ],
      }),
    });

    const slot = await enrichSlotWithDateLlmFallback(
      {
        name: 'дата_события',
        value: 'через месяц',
        confidence: 0.95,
      },
      {
        sourceText: 'Хочу через месяц на концерт',
      }
    );

    expect(slot.dateRange).toBeDefined();
    expect(slot.parsedDate).toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
