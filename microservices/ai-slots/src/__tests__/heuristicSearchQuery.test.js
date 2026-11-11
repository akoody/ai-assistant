import { describe, expect, test } from '@jest/globals';
import { appendHeuristicSearchQuerySlot } from '../services/queueService.js';

describe('appendHeuristicSearchQuerySlot', () => {
  test('adds planetarium keyword for standalone planetarium request', () => {
    const slots = [];

    appendHeuristicSearchQuerySlot(slots, 'Планетарий');

    expect(slots).toEqual([
      expect.objectContaining({
        name: 'поисковый_запрос',
        value: 'планетарий',
      }),
    ]);
  });

  test('does not overwrite existing search query slot', () => {
    const slots = [{ name: 'поисковый_запрос', value: 'звезды', confidence: 0.9 }];

    appendHeuristicSearchQuerySlot(slots, 'Планетарий');

    expect(slots).toHaveLength(1);
    expect(slots[0]).toEqual(expect.objectContaining({ value: 'звезды' }));
  });

  test('adds illusionist keyword for inflected and standalone forms', () => {
    const standalone = [];
    appendHeuristicSearchQuerySlot(standalone, 'Иллюзионист');
    expect(standalone).toEqual([
      expect.objectContaining({
        name: 'поисковый_запрос',
        value: 'иллюзионист',
      }),
    ]);

    const inflected = [];
    appendHeuristicSearchQuerySlot(inflected, 'Хочу на иллюзиониста');
    expect(inflected).toEqual([
      expect.objectContaining({
        name: 'поисковый_запрос',
        value: 'иллюзионист',
      }),
    ]);
  });
});
