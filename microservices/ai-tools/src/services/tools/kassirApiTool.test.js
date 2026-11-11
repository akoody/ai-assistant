import { describe, expect, test } from '@jest/globals';
import { __testUtils } from './kassirApiTool.js';

describe('kassirApiTool artist search safeguards', () => {
  test('does not exclude standup when the request is explicitly about an artist', () => {
    expect(
      __testUtils.shouldExcludeStandupForConcertRequest({
        effectiveKeyword: 'Павел Воля',
        querySuggestion: {
          intent: 'artist',
          searchQuery: 'Павел Воля',
        },
        slots: [
          { name: 'исполнитель', value: 'Павел Воля' },
          { name: 'тип_мероприятия', value: 'концерты' },
        ],
        lastUserMessage: 'хочу на Павла Волю в Пензе',
      })
    ).toBe(false);
  });

  test('keeps excluding standup for generic concert-only searches', () => {
    expect(
      __testUtils.shouldExcludeStandupForConcertRequest({
        effectiveKeyword: 'концерты',
        querySuggestion: {
          intent: 'category',
          searchQuery: 'концерты',
        },
        slots: [{ name: 'тип_мероприятия', value: 'концерты' }],
        lastUserMessage: 'хочу на концерт в Пензе',
      })
    ).toBe(true);
  });

  test('does not infer strict artist intent from vague artist slot', () => {
    const suggestion = __testUtils.buildQuerySuggestionFromParams({
      keyword: '',
      slots: [
        { name: 'город', value: 'Нижний Новгород' },
        { name: 'исполнитель', value: 'очень популярный артист' },
      ],
      lastUserMessage:
        'в Нижний Новгород должен приехать очень популярный артист, но я не помню кто',
    });

    const resolution = __testUtils.buildStrictSearchResolution({
      slots: [{ name: 'исполнитель', value: 'очень популярный артист' }],
      effectiveKeyword: '',
      originalKeyword: '',
    });

    expect(suggestion.intent).toBe('generic');
    expect(resolution.strictSource).toBe(null);
    expect(resolution.strictValue).toBe('');
  });

  test('does not apply mood keyword fallback for specific planner slug routes', () => {
    expect(
      __testUtils.shouldApplyMoodKeywordFallback({
        hasMoodSlot: true,
        moodValue: 'веселье',
        effectiveIntent: 'mood',
        effectiveKeyword: '',
        keywordSource: 'specific-slug',
        shouldSkipGeneratedKeywordForSpecificSlug: true,
        isRomanticContext: false,
      })
    ).toBe(false);
  });

  test('keeps mood keyword fallback for generic mood searches without specific slug', () => {
    expect(
      __testUtils.shouldApplyMoodKeywordFallback({
        hasMoodSlot: true,
        moodValue: 'веселье',
        effectiveIntent: 'mood',
        effectiveKeyword: '',
        keywordSource: 'llm',
        shouldSkipGeneratedKeywordForSpecificSlug: false,
        isRomanticContext: false,
      })
    ).toBe(true);
  });

  test('allows mood fallback for params-based mood-like phrases', () => {
    expect(
      __testUtils.shouldApplyMoodKeywordFallback({
        hasMoodSlot: true,
        moodValue: 'веселье',
        effectiveIntent: 'mood',
        effectiveKeyword: '',
        keywordSource: 'params',
        allowParamMoodKeyword: true,
        shouldSkipGeneratedKeywordForSpecificSlug: false,
        isRomanticContext: false,
      })
    ).toBe(true);
  });

  test('infers fun mood from "поддержать настроение" phrasing', () => {
    expect(
      __testUtils.inferMoodValueFromText('У меня хорошее настроение, хочу его поддержать')
    ).toBe('веселье');
  });

  test('does not route illusionist keyword to shows slug', () => {
    const strategy = __testUtils.resolveSearchSlugStrategy({
      slug: '/category/',
      effectiveKeyword: 'иллюзионист',
      querySuggestion: {
        intent: 'generic',
        searchQuery: 'иллюзионист',
      },
      slots: [{ name: 'поисковый_запрос', value: 'иллюзионист' }],
      lastUserMessage: 'Иллюзионист',
    });

    expect(strategy).toEqual(
      expect.objectContaining({
        slugs: ['/category/'],
        reason: 'default-root-slug',
      })
    );
  });

  test('preserves full multi-word keyword when planner marks it as event title', () => {
    const suggestion = __testUtils.buildQuerySuggestionFromParams({
      keyword: 'Летучий корабль',
      slots: [{ name: 'название_мероприятия', value: 'Летучий корабль' }],
      lastUserMessage: 'Летучий корабль',
    });

    expect(
      __testUtils.shouldPreserveFullKeywordForNamedTarget(suggestion, [
        { name: 'название_мероприятия', value: 'Летучий корабль' },
      ])
    ).toBe(true);

    expect(
      __testUtils.shouldPreserveFullKeywordForNamedTarget(
        { intent: 'generic', searchQuery: 'летучий корабль' },
        [{ name: 'поисковый_запрос', value: 'летучий корабль' }]
      )
    ).toBe(false);
  });
});
