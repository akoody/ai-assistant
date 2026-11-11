import { describe, expect, test } from '@jest/globals';
import { isEventTypeSlotGrounded } from '../services/queueService.js';
import { applyIntentHeuristics } from '../services/intentHeuristics.js';

describe('event type grounding', () => {
  test('accepts theater category when user mentions theater genres in different forms', () => {
    expect(
      isEventTypeSlotGrounded(
        { name: 'тип_мероприятия', value: 'театры' },
        'Привет, хочу на Оперу в МСК или Питере'
      )
    ).toBe(true);
    expect(
      isEventTypeSlotGrounded(
        { name: 'тип_мероприятия', value: 'театры' },
        'Хочу на балет в Москве'
      )
    ).toBe(true);
    expect(
      isEventTypeSlotGrounded({ name: 'тип_мероприятия', value: 'театры' }, 'Ищу мюзикл в Питере')
    ).toBe(true);
  });

  test('accepts concert category when user mentions music genres', () => {
    expect(
      isEventTypeSlotGrounded(
        { name: 'тип_мероприятия', value: 'концерты' },
        'Хочу на джаз в Москве'
      )
    ).toBe(true);
    expect(
      isEventTypeSlotGrounded(
        { name: 'тип_мероприятия', value: 'концерты' },
        'Ищу классику в Питере'
      )
    ).toBe(true);
    expect(
      isEventTypeSlotGrounded(
        { name: 'тип_мероприятия', value: 'концерты' },
        'Нужен рэп концерт в Москве'
      )
    ).toBe(true);
    expect(
      isEventTypeSlotGrounded(
        { name: 'тип_мероприятия', value: 'концерты' },
        'Хочу в клубы в Москве'
      )
    ).toBe(true);
  });

  test('does not ground concerts on incidental substring matches', () => {
    expect(
      isEventTypeSlotGrounded(
        { name: 'тип_мероприятия', value: 'концерты' },
        'Хочу на популярный спектакль'
      )
    ).toBe(false);
    expect(
      isEventTypeSlotGrounded(
        { name: 'тип_мероприятия', value: 'концерты' },
        'Урок актерского мастерства'
      )
    ).toBe(false);
  });

  test('accepts inflected forms for other categories', () => {
    expect(
      isEventTypeSlotGrounded(
        { name: 'тип_мероприятия', value: 'выставки' },
        'Хочу на выставку в Москве'
      )
    ).toBe(true);
    expect(
      isEventTypeSlotGrounded(
        { name: 'тип_мероприятия', value: 'экскурсии' },
        'Хочу на экскурсию в Питере'
      )
    ).toBe(true);
    expect(
      isEventTypeSlotGrounded({ name: 'тип_мероприятия', value: 'музеи' }, 'Хочу в музей в Москве')
    ).toBe(true);
    expect(
      isEventTypeSlotGrounded(
        { name: 'тип_мероприятия', value: 'образование' },
        'Хочу на мастер-класс в Питере'
      )
    ).toBe(true);
  });

  test('does not keep off_topic for dance leisure request', () => {
    const intents = applyIntentHeuristics(
      'Хочу на танцы',
      [{ name: 'recommendations_request', confidence: 0.9, source: 'llm' }],
      []
    );

    expect(intents).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'recommendations_request' })])
    );
    expect(intents.some((intent) => intent?.name === 'off_topic')).toBe(false);
  });
});
