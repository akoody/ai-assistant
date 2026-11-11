import { describe, expect, test } from '@jest/globals';
import { appendHeuristicMoodSlot, extractHeuristicMoodValue } from '../services/queueService.js';

describe('queueService mood heuristics', () => {
  test('maps "поддержать настроение" phrasing to fun mood', () => {
    expect(
      extractHeuristicMoodValue(
        'У меня хорошее настроение, хочу сходить куда-то чтобы его поддержать'
      )
    ).toBe('веселье');
  });

  test('maps romantic phrasing to romantic mood', () => {
    expect(extractHeuristicMoodValue('Хочу что-то романтичное для свидания')).toBe('романтика');
  });

  test('appends mood slot when llm missed mood extraction', () => {
    const slots = [{ name: 'город', value: 'Нижний Новгород', confidence: 0.95 }];
    appendHeuristicMoodSlot(slots, 'Надо поднять настроение, хочется развеяться');

    const moodSlot = slots.find((slot) => slot.name === 'настроение');
    expect(moodSlot).toBeDefined();
    expect(moodSlot.value).toBe('веселье');
    expect(moodSlot.source).toBe('heuristic_mood');
  });
});
