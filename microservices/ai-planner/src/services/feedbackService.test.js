import { describe, expect, test } from '@jest/globals';
import {
  hasPositiveFeedback,
  hasNegativeFeedback,
  inferFeedbackPreferencesFromContext,
  findMentionedFeedbackEvents,
} from './feedbackService.js';

describe('feedbackService', () => {
  test('treats "мне такое нравится" as positive feedback', () => {
    expect(hasPositiveFeedback('мне такое нравится')).toBe(true);
    expect(hasPositiveFeedback('мне это нравится')).toBe(true);
  });

  test('does not treat negative feedback with "понрав" stem as positive', () => {
    expect(hasNegativeFeedback('Наследник мне не понравился совсем')).toBe(true);
    expect(hasPositiveFeedback('Наследник мне не понравился совсем')).toBe(false);
    expect(hasPositiveFeedback('мне не зашло')).toBe(false);
  });

  test('restores genre and event type from previous query when feedback is generic', () => {
    expect(
      inferFeedbackPreferencesFromContext({
        userMessage: 'мне такое нравится',
        previousUserQuery: 'хочу рок концерты',
      })
    ).toEqual({
      eventMention: null,
      eventType: 'концерты',
      genre: 'рок',
    });
  });

  test('prefers explicit extracted feedback details over previous query', () => {
    expect(
      inferFeedbackPreferencesFromContext({
        userMessage: 'мне такое нравится',
        previousUserQuery: 'хочу рок концерты',
        positiveFeedbackIntent: {
          eventDetails: {
            eventName: 'Юнона и Авось',
            eventType: 'театры',
            genre: 'опера',
          },
        },
      })
    ).toEqual({
      eventMention: 'Юнона и Авось',
      eventType: 'театры',
      genre: 'опера',
    });
  });

  test('finds several mentioned events inside one feedback message', () => {
    expect(
      findMentionedFeedbackEvents(
        [
          { title: 'Время, которое танцует', category: 'шоу' },
          { title: 'Дискотека Авария', category: 'концерты' },
          { title: 'Русская народная программа: Концерт', category: 'концерты' },
        ],
        'Мне не нравятся Время, которое танцует и Дискотека Авария'
      )
    ).toEqual([
      { title: 'Время, которое танцует', category: 'шоу' },
      { title: 'Дискотека Авария', category: 'концерты' },
    ]);
  });
});
