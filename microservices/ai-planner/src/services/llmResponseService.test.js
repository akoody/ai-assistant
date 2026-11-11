import {
  buildSafeEventDetailsText,
  buildFreshSearchResetPlan,
  canUseOfferTextWithoutJsonRetry,
  __testUtils,
  detectCategoryFromText,
  detectConcertGenreFromText,
  detectShowGenreFromText,
  detectTheaterGenreFromText,
  inferDirectPreferenceChange,
  normalizeCategory,
  resolveDetectedCategoryForSearch,
  resolveExplicitAnySelection,
  shouldTreatAsContextualPositiveFeedback,
  shouldRetryLanguageRepair,
} from './llmResponseService.js';
import { isAssistantIdentityQuestion } from './assistantIdentityService.js';

const CONCERT_GENRES = ['Рок', 'Поп', 'Джаз', 'Классика', 'Клубы', 'Хип-хоп'];

// Concert genre clarification shows five of the six genres in random order, then the
// generic choices.
function expectConcertGenreButtons(buttons) {
  expect(buttons).toHaveLength(7);
  expect(buttons.slice(5)).toEqual(['Любой', 'Покажи все']);
  const genres = buttons.slice(0, 5);
  expect(new Set(genres).size).toBe(5);
  genres.forEach((genre) => expect(CONCERT_GENRES).toContain(genre));
}

describe('llmResponseService genre/category inference', () => {
  test('answers duration questions with event duration instead of date-only details', () => {
    const response = buildSafeEventDetailsText(
      {
        title: 'Дублеры',
        date: '14 мая 2026 г.',
        time: '19:00',
        venue: 'МТС Live Холл Нижний Новгород',
        city: 'Нижний Новгород',
        durationMinutes: 180,
        priceMin: 2000,
        priceMax: 5000,
      },
      'Сколько длятся дублёры?'
    );

    expect(response).toContain('Длительность «Дублеры» — 3 часа.');
    expect(response).toContain('Дата и время: 14 мая 2026 г., 19:00.');
  });

  test('recognizes standalone slash commands and builds deterministic redirect', () => {
    expect(__testUtils.extractSlashCommand('/info')).toBe('/info');
    expect(__testUtils.extractSlashCommand('/start@widgetkassirbot')).toBe('/start');
    expect(__testUtils.extractSlashCommand(' /START ')).toBe('/start');
    expect(__testUtils.extractSlashCommand('На каком языке ты написан?')).toBe(null);
  });

  test('sanitizes slash commands before off-topic llm prompt', () => {
    expect(
      __testUtils.buildOffTopicUserContent({ userMessage: '/restart', slashCommand: '/restart' })
    ).toContain('служебную slash-команду');
    expect(
      __testUtils.buildOffTopicUserContent({ userMessage: '/restart', slashCommand: '/restart' })
    ).not.toContain('/restart');
  });

  test('rejects feminine self-reference in off-topic redirect text', () => {
    expect(
      __testUtils.isSafeOffTopicRedirectText(
        'Поняла ваш вопрос, но по этой теме не сориентирую. Давайте лучше выберем мероприятие: что вам сейчас интересно?'
      )
    ).toBe(false);
  });

  test('detects assistant identity questions with extra spaces before punctuation', () => {
    expect(isAssistantIdentityQuestion('Ты человек ?')).toBe(true);
    expect(isAssistantIdentityQuestion('Вы бот ?')).toBe(true);
    expect(isAssistantIdentityQuestion('Ты человек???')).toBe(true);
  });

  test('detects domain-like single performer-role query for fallback keyword', () => {
    expect(__testUtils.resolveDomainLikeSearchQueryFromMessage('Иллюзионист')).toBe('иллюзионист');
    expect(__testUtils.resolveDomainLikeSearchQueryFromMessage('Хочу на иллюзиониста')).toBe(
      'иллюзионист'
    );
    expect(__testUtils.resolveDomainLikeSearchQueryFromMessage('Фокусники в городе')).toBe(
      'фокусник'
    );
  });

  test('normalizes meaningful fallback query and rejects trivial values', () => {
    expect(__testUtils.normalizeFallbackSearchQuery('иллюзиониста')).toBe('иллюзионист');
    expect(__testUtils.normalizeFallbackSearchQuery('все')).toBe(null);
    expect(__testUtils.normalizeFallbackSearchQuery('')).toBe(null);
  });

  test('deriveFallbackQuery and normalizeFallbackSearchQuery omit calendar-only wording', () => {
    expect(__testUtils.deriveFallbackQuery('Куда сходить в субботу?', [])).toBe('');
    expect(__testUtils.normalizeFallbackSearchQuery('субботу')).toBe(null);
    expect(__testUtils.normalizeFallbackSearchQuery('ближайшие выходные')).toBe(null);
    expect(__testUtils.normalizeFallbackSearchQuery('рок в субботу')).toBe('рок');
  });

  test('routes broad assistant requests through the off-topic LLM gate before search', () => {
    expect(__testUtils.looksLikeQuestionText('Подскажи погоду')).toBe(true);
    expect(__testUtils.looksLikeQuestionText('Расскажи последние новости')).toBe(true);
    expect(__testUtils.looksLikeQuestionText('Посоветуй что-нибудь интересное')).toBe(true);
  });

  test('deriveFallbackQuery does not turn any-date reset into search keyword', () => {
    expect(
      __testUtils.deriveFallbackQuery('Не хочу 21 апреля, любую дату давай', [
        { name: 'дата_события', value: 'любая' },
      ])
    ).toBe('');
  });

  test('resolveExplicitAnySelection recognizes explicit any-date clarification answer', () => {
    expect(
      resolveExplicitAnySelection({
        normalizedUserMessage: 'любая дата',
        lastAssistantButtons: [
          'Сегодня',
          'Завтра',
          'Ближайшие выходные',
          'На следующей неделе',
          'Любая',
        ],
      })
    ).toMatchObject({
      isExplicitAnyDate: true,
    });
  });

  test('detects meta preference genre slots so planner can prefer memory injection', () => {
    expect(__testUtils.isMetaPreferenceReferenceSlot({ name: 'жанр', value: 'любимый жанр' })).toBe(
      true
    );
    expect(
      __testUtils.isMetaPreferenceReferenceSlot({ name: 'жанр', value: 'свой любимый жанр' })
    ).toBe(true);
    expect(__testUtils.isMetaPreferenceReferenceSlot({ name: 'жанр', value: 'балет' })).toBe(false);
  });

  test('does not route explicit favorite-search requests into preference-memory confirmation', () => {
    const preferenceMemoryReferenceIntent = {
      name: 'preference_memory_reference',
      confidence: 0.95,
      memoryType: 'taste',
      source: 'llm',
    };
    const recommendationsIntent = {
      name: 'recommendations_request',
      confidence: 0.95,
      source: 'llm',
    };

    expect(
      __testUtils.isPreferenceMemoryConfirmationQuestion(
        'Найди что-то из любимого',
        preferenceMemoryReferenceIntent
      )
    ).toBe(false);
    expect(
      __testUtils.shouldPreferPreferenceMemoryMetaRouting(
        'Найди что-то из любимого',
        preferenceMemoryReferenceIntent,
        recommendationsIntent
      )
    ).toBe(false);
  });

  test('detects direct memory-confirmation question in russian', () => {
    const preferenceMemoryReferenceIntent = {
      name: 'preference_memory_reference',
      confidence: 0.95,
      memoryType: 'genre',
      source: 'llm',
    };

    expect(
      __testUtils.isPreferenceMemoryConfirmationQuestion(
        'Ты помнишь мои предпочтения?',
        preferenceMemoryReferenceIntent
      )
    ).toBe(true);
  });

  test('preference-memory fallback no longer uses the rigid canned wording', () => {
    const response = __testUtils.buildPreferenceMemoryConfirmationFallbackResponse({
      userId: 'user-1',
      sessionId: 'session-1',
      userPreferences: { genres: ['рок'] },
      memoryType: 'genre',
      userMessage: 'Ты помнишь, что я люблю?',
    });

    expect(response.message).toMatch(/рок/u);
    expect(response.message).not.toMatch(/буду учитывать это в следующих подборках/u);
  });

  test('never invents a search query slot in the planner: keywords come only from LLM slots', () => {
    // Heuristic planner keywords were disabled on purpose: they leaked noise such as
    // "с отцом" into the search. Domain-like words are still recognised, but not saved.
    expect(__testUtils.resolveDomainLikeSearchQueryFromMessage('Иллюзионист')).toBe('иллюзионист');
    const withFallback = __testUtils.augmentSlotsWithQuery([], 'иллюзиониста', {
      userMessage: 'Иллюзионист',
      offTopicIntent: null,
    });

    expect(withFallback).toEqual([]);

    const withOffTopic = __testUtils.augmentSlotsWithQuery([], '', {
      userMessage: 'Иллюзионист',
      offTopicIntent: { name: 'off_topic', confidence: 0.95 },
    });
    expect(withOffTopic).toEqual([]);
  });

  test('guards off-topic event probe to named-event-like phrases', () => {
    expect(__testUtils.shouldProbeOffTopicEventSearch('Летучий корабль')).toBe(true);
    expect(__testUtils.shouldProbeOffTopicEventSearch('хочу на Летучий корабль')).toBe(true);
    expect(__testUtils.shouldProbeOffTopicEventSearch('Однажды в России')).toBe(true);
    expect(__testUtils.shouldProbeOffTopicEventSearch('Вивальди')).toBe(true);
    expect(__testUtils.shouldProbeOffTopicEventSearch('ЛСП')).toBe(true);
    expect(__testUtils.shouldProbeOffTopicEventSearch('лсп')).toBe(true);
    expect(__testUtils.shouldProbeOffTopicEventSearch('ддт')).toBe(true);
    expect(__testUtils.shouldProbeOffTopicEventSearch('хочу на лсп')).toBe(true);
    expect(__testUtils.shouldProbeOffTopicEventSearch('вивальди')).toBe(false);
    expect(__testUtils.shouldProbeOffTopicEventSearch('Кино')).toBe(false);
    expect(__testUtils.shouldProbeOffTopicEventSearch('погода')).toBe(false);
    expect(__testUtils.shouldProbeOffTopicEventSearch('спасибо')).toBe(false);
    expect(__testUtils.shouldProbeOffTopicEventSearch('курс доллара')).toBe(false);
    expect(__testUtils.shouldProbeOffTopicEventSearch('как написать SQL join')).toBe(false);
  });

  test('finds ambiguous genre slots for explicit short named-event requests', () => {
    expect(
      __testUtils.findAmbiguousNamedEventSlots(
        [{ name: 'жанр_музыки', value: 'лсп', confidence: 0.95 }],
        'Хочу на лсп'
      )
    ).toEqual([
      expect.objectContaining({
        name: 'жанр_музыки',
        value: 'лсп',
      }),
    ]);

    expect(
      __testUtils.findAmbiguousNamedEventSlots(
        [{ name: 'жанр_музыки', value: 'лсп', confidence: 0.95 }],
        'лсп'
      )
    ).toEqual([
      expect.objectContaining({
        name: 'жанр_музыки',
        value: 'лсп',
      }),
    ]);
  });

  test('does not probe Kassir for generic non-event purchase off-topic', () => {
    expect(__testUtils.shouldProbeOffTopicEventSearch('Хочу купить выдру')).toBe(false);
    expect(__testUtils.shouldProbeOffTopicEventSearch('Куплю выдру')).toBe(false);
    expect(__testUtils.shouldProbeOffTopicEventSearch('Хочу купить билет на Летучий корабль')).toBe(
      true
    );
  });

  test('guards single-word off-topic event probe candidates', () => {
    expect(__testUtils.isLikelySingleWordNamedEventProbeCandidate('Вивальди')).toBe(true);
    expect(__testUtils.isLikelySingleWordNamedEventProbeCandidate('Vivaldi')).toBe(true);
    expect(__testUtils.isLikelySingleWordNamedEventProbeCandidate('ЛСП')).toBe(true);
    expect(__testUtils.isLikelySingleWordNamedEventProbeCandidate('лсп')).toBe(true);
    expect(__testUtils.isLikelySingleWordNamedEventProbeCandidate('ддт')).toBe(true);
    expect(__testUtils.isLikelySingleWordNamedEventProbeCandidate('вивальди')).toBe(false);
    expect(__testUtils.isLikelySingleWordNamedEventProbeCandidate('погода')).toBe(false);
    expect(__testUtils.isLikelySingleWordNamedEventProbeCandidate('спасибо')).toBe(false);
    expect(__testUtils.isLikelySingleWordNamedEventProbeCandidate('SQL')).toBe(false);
  });

  test('preserves fresh preference acknowledgement when rebuilding offer text from cards', () => {
    const text = __testUtils.buildStrictOfferTextFromEvents(
      'Запомнил, что вам нравится опера. Вот несколько вариантов интересующих вас мероприятий в Нижнем Новгороде:',
      [
        {
          title: 'Богема',
          date: '4 июня 2026 г.',
          time: '19:00',
          venue: 'Театр оперы и балета',
          description: 'Опера Джакомо Пуччини.',
          priceMin: 500,
          priceMax: 3000,
        },
      ],
      { fallbackIntro: 'Вот интересный вариант:', hasKnownEventType: true }
    );

    expect(text).toContain('Запомнил, что вам нравится опера. Вот интересный вариант:');
    expect(text).toContain('1. Богема');
  });

  test('matches off-topic probe result by event title tokens', () => {
    expect(
      __testUtils.offTopicProbeEventMatchesCandidate(
        { title: 'Летучий корабль. Музыкальный спектакль' },
        'Летучий корабль'
      )
    ).toBe(true);

    expect(
      __testUtils.offTopicProbeEventMatchesCandidate({ title: 'Корабли и море' }, 'Летучий корабль')
    ).toBe(false);
  });

  test('matches off-topic probe result by nested Kassir title fields', () => {
    expect(
      __testUtils.extractOffTopicProbeEventTitleCandidates({
        object: {
          title: 'Летучий корабль',
          activity: { title: 'Музыкальный спектакль' },
        },
      })
    ).toEqual(['Летучий корабль', 'Музыкальный спектакль']);

    expect(
      __testUtils.offTopicProbeEventMatchesCandidate(
        { object: { title: 'Летучий корабль' } },
        'Летучий корабль'
      )
    ).toBe(true);
  });

  test('trusts a single exact keyword hit for off-topic event probe', () => {
    expect(
      __testUtils.shouldTrustSingleOffTopicProbeHit({
        candidate: 'Летучий корабль',
        events: [{ object: { id: 123 } }],
        searchResolution: {
          requestedKeyword: 'Летучий корабль',
          appliedKeyword: 'Летучий корабль',
          strictQuerySuppressed: false,
        },
      })
    ).toBe(true);

    expect(
      __testUtils.shouldTrustSingleOffTopicProbeHit({
        candidate: 'Кино',
        events: [{ object: { id: 123 } }],
        searchResolution: {
          requestedKeyword: 'Кино',
          appliedKeyword: 'Кино',
          strictQuerySuppressed: false,
        },
      })
    ).toBe(false);

    expect(
      __testUtils.shouldTrustSingleOffTopicProbeHit({
        candidate: 'Вивальди',
        events: [{ object: { id: 123 } }],
        searchResolution: {
          requestedKeyword: 'Вивальди',
          appliedKeyword: 'Вивальди',
          strictQuerySuppressed: false,
        },
      })
    ).toBe(true);

    expect(
      __testUtils.shouldTrustSingleOffTopicProbeHit({
        candidate: 'Летучий корабль',
        events: [{ object: { id: 123 } }, { object: { id: 456 } }],
        searchResolution: {
          requestedKeyword: 'Летучий корабль',
          appliedKeyword: 'Летучий корабль',
          strictQuerySuppressed: false,
        },
      })
    ).toBe(false);
  });

  test('builds event-name slots for off-topic Kassir probe without duplicating old filters', () => {
    const slots = __testUtils.buildOffTopicEventProbeSlots({
      userMessage: 'Летучий корабль',
      currentSlots: [
        { name: 'город', value: 'Нижний Новгород' },
        { name: 'тип_мероприятия', value: 'концерты' },
      ],
    });

    expect(slots).toEqual([
      { name: 'город', value: 'Нижний Новгород' },
      expect.objectContaining({ name: 'название_мероприятия', value: 'Летучий корабль' }),
      expect.objectContaining({ name: 'поисковый_запрос', value: 'Летучий корабль' }),
    ]);
  });

  test('detects and rewrites ambiguous multi-word genre as event title after probe', () => {
    const ambiguousSlots = __testUtils.findAmbiguousNamedEventSlots(
      [
        { name: 'город', value: 'Нижний Новгород' },
        { name: 'жанр', value: 'летучий корабль' },
      ],
      'хочу на Летучий корабль'
    );

    expect(ambiguousSlots).toEqual([
      expect.objectContaining({ name: 'жанр', value: 'летучий корабль' }),
    ]);

    const rewritten = __testUtils.replaceAmbiguousSlotsWithNamedEventSlots(
      [
        { name: 'город', value: 'Нижний Новгород' },
        { name: 'жанр', value: 'летучий корабль' },
      ],
      ambiguousSlots,
      'хочу на Летучий корабль'
    );

    expect(rewritten).toEqual([
      { name: 'город', value: 'Нижний Новгород' },
      expect.objectContaining({ name: 'название_мероприятия', value: 'Летучий корабль' }),
      expect.objectContaining({ name: 'поисковый_запрос', value: 'Летучий корабль' }),
    ]);
  });

  test('does not mistake city-only museum browse query for previously shown event details', () => {
    const historyEvents = [
      {
        title: 'Евгений Гришковец "Когда я боюсь" Нижний Новгород 2026',
        city: 'Нижний Новгород',
      },
    ];

    expect(
      __testUtils.findMentionedEvents(historyEvents, 'Покажи все музеи Нижнего Новгорода', {
        slots: [
          { name: 'тип_мероприятия', value: 'музеи' },
          { name: 'город', value: 'Нижний Новгород' },
        ],
      })
    ).toEqual([]);
  });

  test('repeats offer for same explicit category request instead of falling back to general dialog', () => {
    expect(
      __testUtils.shouldRepeatOfferForSameRecommendationRequest({
        shouldSkipOfferGeneration: false,
        offerEvents: null,
        session: { quickOfferSent: true, finalOfferSent: false },
        allRequiredCollected: true,
        wantsRecommendations: true,
        hasSpecificEventType: true,
        showAllRequested: false,
        isShowMoreRequest: false,
        isChangeCityRequest: false,
        isChangeDateRequest: false,
        isChangePreferencesRequest: false,
        isHealthComplaintRequest: false,
        isEventDetailsRequest: false,
        slotsChanged: false,
        categoryChanged: false,
        isExplicitAnyBudget: false,
        isExplicitAnyDate: false,
      })
    ).toBe(true);

    expect(
      __testUtils.shouldRepeatOfferForSameRecommendationRequest({
        shouldSkipOfferGeneration: false,
        offerEvents: null,
        session: { quickOfferSent: true, finalOfferSent: false },
        allRequiredCollected: true,
        wantsRecommendations: true,
        hasSpecificEventType: false,
        showAllRequested: false,
        isShowMoreRequest: false,
        isChangeCityRequest: false,
        isChangeDateRequest: false,
        isChangePreferencesRequest: false,
        isHealthComplaintRequest: false,
        isEventDetailsRequest: false,
        slotsChanged: false,
        categoryChanged: false,
        isExplicitAnyBudget: false,
        isExplicitAnyDate: false,
      })
    ).toBe(false);
  });

  test('extracts explicit price cap from thousands phrasing', () => {
    expect(__testUtils.extractPriceCapFromText('Хочу на концерт не дороже 3 тысяч')).toBe(3000);
    expect(__testUtils.extractPriceCapFromText('Хочу куда-нибудь до 3 тыс')).toBe(3000);
    expect(__testUtils.extractPriceCapFromText('Хочу куда-нибудь до 3к')).toBe(3000);
    expect(__testUtils.extractPriceCapFromText('Хочу куда-нибудь до 3 тыщи')).toBe(3000);
  });

  test('maps theater genres to theater category', () => {
    expect(detectCategoryFromText('Привет, хочу на Оперу в МСК или Питере')).toBe('театры');
    expect(detectCategoryFromText('Хочу на балет в Москве')).toBe('театры');
    expect(detectCategoryFromText('Хочу на мюзикл в Питере')).toBe('театры');
    expect(normalizeCategory('оперу')).toBe('театры');
  });

  test('detects children category from child-audience wording with e/yo variants', () => {
    expect(detectCategoryFromText('куда сходить с ребенком 5 лет')).toBe('детям');
    expect(detectCategoryFromText('куда сходить с ребёнком 5 лет')).toBe('детям');
  });

  test('does not let authoritative off-topic intent be overridden by local category detection', () => {
    const authoritativeOffTopic = { name: 'off_topic', confidence: 0.95, source: 'llm' };

    expect(__testUtils.resolveLocalCategoryForRouting('Курс доллара', authoritativeOffTopic)).toBe(
      null
    );
    expect(
      __testUtils.resolveLocalCategoryForRouting('курс евро сегодня', authoritativeOffTopic)
    ).toBe(null);
    expect(__testUtils.resolveLocalCategoryForRouting('курсы валют', authoritativeOffTopic)).toBe(
      null
    );
    expect(__testUtils.resolveLocalCategoryForRouting('доллар курс', authoritativeOffTopic)).toBe(
      null
    );
    expect(detectCategoryFromText('Хочу на курсы по фотографии')).toBe('образование');
    expect(__testUtils.resolveLocalCategoryForRouting('Хочу на курсы по фотографии', null)).toBe(
      'образование'
    );
  });

  test('ignores off-topic intent for trusted quick button actions', () => {
    const offTopicIntent = { name: 'off_topic', confidence: 0.95, source: 'llm' };

    expect(
      __testUtils.shouldIgnoreOffTopicForTrustedUiAction({
        offTopicIntent,
        isQuickCategorySelection: true,
      })
    ).toBe(true);

    expect(
      __testUtils.shouldIgnoreOffTopicForTrustedUiAction({
        offTopicIntent,
        isButtonEcho: true,
      })
    ).toBe(true);

    expect(
      __testUtils.shouldIgnoreOffTopicForTrustedUiAction({
        offTopicIntent,
        isQuickCategorySelection: false,
        isButtonEcho: false,
      })
    ).toBe(false);
  });

  test('detects theater genre from text', () => {
    expect(detectTheaterGenreFromText('Привет, хочу на Оперу в МСК или Питере')).toBe('опера');
    expect(detectTheaterGenreFromText('Хочу на балет в Москве')).toBe('балет');
    expect(detectTheaterGenreFromText('Хочу на мюзикл в Питере')).toBe('мюзикл');
    expect(detectTheaterGenreFromText('Хочу на следующих выходных на какой-нибудь спектакль')).toBe(
      'спектакли'
    );
  });

  test('does not match theater genre/category by substring inside longer words', () => {
    expect(detectTheaterGenreFromText('Оператора позови')).toBe(null);
    expect(detectCategoryFromText('Оператора позови')).toBe(null);
  });

  test('does not classify popular theater request as concerts', () => {
    expect(detectCategoryFromText('Хочу на популярный спектакль')).toBe('театры');
    expect(detectConcertGenreFromText('Хочу на популярный спектакль')).toBe(null);
    expect(detectTheaterGenreFromText('Хочу на популярный спектакль')).toBe('спектакли');
  });

  test('does not classify unrelated word substrings as concert genres', () => {
    expect(detectCategoryFromText('Урок актерского мастерства')).toBe(null);
    expect(detectConcertGenreFromText('Урок актерского мастерства')).toBe(null);
  });

  test('maps concert genres to concert category and genre slot', () => {
    expect(detectCategoryFromText('Хочу на джаз в Москве')).toBe('концерты');
    expect(detectCategoryFromText('Хочу на рок в Питере')).toBe('концерты');
    expect(detectCategoryFromText('Хочу на поп концерт')).toBe('концерты');
    expect(detectConcertGenreFromText('Хочу на джаз в Москве')).toEqual({
      slotName: 'жанр_музыки',
      value: 'джаз',
    });
    expect(detectConcertGenreFromText('Хочу на электронную музыку в Питере')).toEqual({
      slotName: 'жанр_музыки',
      value: 'электронная музыка',
    });
    expect(detectConcertGenreFromText('Хочу что-нибудь клубное в Москве')).toEqual({
      slotName: 'жанр',
      value: 'клубы',
    });
  });

  test('detects show genres from text without widening to generic shows', () => {
    expect(detectCategoryFromText('Хочу на цирк в Нижнем Новгороде')).toBe('шоу');
    expect(detectShowGenreFromText('Хочу на цирк в Нижнем Новгороде')).toBe('цирк');
    expect(detectShowGenreFromText('Покажи стендап шоу')).toBe('стендап');
  });

  test('resolves taxonomy genres into parent category and genre slot generically', () => {
    expect(__testUtils.resolveTaxonomyGenreEntryByValue('опера')).toMatchObject({
      category: 'театры',
      slotName: 'жанр',
      genre: 'опера',
    });
    expect(__testUtils.resolveTaxonomyGenreEntryByValue('джаз')).toMatchObject({
      category: 'концерты',
      slotName: 'жанр_музыки',
      genre: 'джаз',
    });
    expect(__testUtils.resolveTaxonomyGenreEntryByValue('клубы')).toMatchObject({
      category: 'концерты',
      slotName: 'жанр',
      genre: 'клубы',
    });
    expect(__testUtils.resolveTaxonomyGenreEntryByValue('стендап')).toBe(null);
    expect(
      __testUtils.resolveTaxonomyGenreEntryByValue('стендап', { preferredCategory: 'шоу' })
    ).toMatchObject({
      category: 'шоу',
      slotName: 'жанр',
      genre: 'стендап',
    });
  });

  test('finds taxonomy genre in free text using current category context', () => {
    expect(__testUtils.resolveTaxonomyGenreEntryFromText('хочу на мастер-классы')).toMatchObject({
      category: 'образование',
      slotName: 'жанр',
      genre: 'мастер-классы',
    });
    expect(
      __testUtils.resolveTaxonomyGenreEntryFromText('другое', { preferredCategory: 'концерты' })
    ).toMatchObject({
      category: 'концерты',
      slotName: 'жанр',
      genre: 'другое',
    });
    expect(
      __testUtils.resolveTaxonomyGenreEntryFromText('цирк', { preferredCategory: 'шоу' })
    ).toMatchObject({
      category: 'шоу',
      slotName: 'жанр',
      genre: 'цирк / клоунада',
    });
  });

  test('asks for category choice when genre is ambiguous across multiple categories', () => {
    expect(
      __testUtils.resolveAmbiguousGenreCategoryChoice({
        userMessage: 'Хочу на танцы',
        slots: [],
      })
    ).toEqual({
      genre: 'танец',
      categories: ['театры', 'концерты', 'шоу'],
      buttons: ['Театры', 'Концерты', 'Шоу', 'Покажи все'],
    });
  });

  test('resolves ambiguous category clarification plan for ambiguous genre', () => {
    expect(
      __testUtils.resolveClarificationPlan({
        slots: [
          { name: 'жанр', value: 'танец', source: 'ambiguous_genre_context' },
          { name: 'город', value: 'Нижний Новгород' },
        ],
        vagueRequestInfo: { missingDetails: ['тип_мероприятия'] },
        targetHint: 'ambiguous_category',
      })
    ).toEqual({
      target: 'ambiguous_category',
      buttons: ['Театры', 'Концерты', 'Шоу', 'Покажи все'],
      knownEventType: '',
    });
  });

  test('builds fallback clarification text for ambiguous genre category choice', () => {
    const response = __testUtils.buildClarificationActionResponse({
      target: 'ambiguous_category',
      slots: [
        { name: 'жанр', value: 'танец', source: 'ambiguous_genre_context' },
        { name: 'город', value: 'Нижний Новгород' },
      ],
      knownCity: 'Нижний Новгород',
    });

    expect(response.message).toBe(
      'Жанр "танец" встречается в нескольких категориях в Нижний Новгород. Что вам ближе или показать все?'
    );
    expect(response.buttons).toEqual(['Театры', 'Концерты', 'Шоу', 'Покажи все']);
  });

  test('accepts category-style wording for ambiguous genre clarification target', () => {
    expect(
      __testUtils.isClarificationCandidateAligned({
        text: 'Какой формат танцевального события вам больше нравится?',
        buttons: ['Театры', 'Концерты', 'Шоу', 'Покажи все'],
        target: 'ambiguous_category',
        expectedButtons: ['Театры', 'Концерты', 'Шоу', 'Покажи все'],
      })
    ).toBe(true);
  });

  test('keeps ambiguous genre on show-all reset and drops only category slots', () => {
    const resetNames = __testUtils.buildShowAllResetSlotNames({
      effectiveSlots: [
        { name: 'жанр', value: 'танец' },
        { name: 'тип_мероприятия', value: 'театры' },
      ],
      clarificationTarget: 'ambiguous_category',
    });

    expect(resetNames.has('жанр')).toBe(false);
    expect(resetNames.has('жанр_музыки')).toBe(false);
    expect(resetNames.has('тип_мероприятия')).toBe(true);
  });

  test('upgrades category clarification target to ambiguous_category from snapshot context', () => {
    expect(
      __testUtils.resolveClarificationTargetFromSessionContext({
        clarificationTarget: 'category',
        lastAssistantButtons: ['Театры', 'Концерты', 'Шоу', 'Покажи все'],
        slotsSnapshot: [
          { name: 'жанр', value: 'танец', source: 'ambiguous_genre_context' },
          { name: 'город', value: 'Нижний Новгород' },
        ],
      })
    ).toBe('ambiguous_category');
  });

  test('detects quiz and holiday categories from text', () => {
    expect(detectCategoryFromText('Хочу на квизы в Нижнем Новгороде')).toBe('квизы');
    expect(detectCategoryFromText('Покажи праздничные мероприятия в Казани')).toBe('праздники');
    expect(normalizeCategory('квизы')).toBe('квизы');
    expect(normalizeCategory('праздники')).toBe('праздники');
  });

  test('detects direct preference switch from rock to opera', () => {
    expect(
      inferDirectPreferenceChange('мне больше не нравятся рок концерты, я хочу теперь оперу', [
        { name: 'жанр_музыки', value: 'рок' },
        { name: 'тип_мероприятия', value: 'театры' },
      ])
    ).toMatchObject({
      dislikedGenres: ['рок'],
      preferredGenre: 'опера',
      preferredEventType: 'театры',
      canApplyDirectly: true,
      shouldPersistPositivePreference: false,
    });
  });

  test('does not treat ordinary theater search as preference change', () => {
    expect(
      inferDirectPreferenceChange('Хочу на популярный спектакль', [
        { name: 'тип_мероприятия', value: 'театры' },
      ])
    ).toMatchObject({
      preferredGenre: null,
      preferredEventType: null,
      hasAnyUpdates: false,
      canApplyDirectly: false,
      shouldPersistPositivePreference: false,
    });
  });

  test('does not treat broad multi-category discovery request as preference switch', () => {
    expect(
      inferDirectPreferenceChange(
        'Какие мероприятия, концерты, спектакли или другие интересные события можно посетить сегодня?',
        [
          { name: 'тип_мероприятия', value: 'концерты' },
          { name: 'жанр', value: 'спектакли' },
          { name: 'дата_события', value: 'сегодня' },
        ]
      )
    ).toMatchObject({
      preferredGenre: null,
      preferredEventType: null,
      hasAnyUpdates: false,
      canApplyDirectly: false,
      shouldPersistPositivePreference: false,
    });
  });

  test('treats look-at-opera request as immediate search target, not stored preference', () => {
    expect(
      inferDirectPreferenceChange('я больше не люблю рок, давай посмотрим оперу', [
        { name: 'жанр_музыки', value: 'рок' },
        { name: 'тип_мероприятия', value: 'театры' },
      ])
    ).toMatchObject({
      dislikedGenres: ['рок'],
      preferredGenre: 'опера',
      preferredEventType: 'театры',
      canApplyDirectly: true,
      shouldPersistPositivePreference: false,
    });
  });

  test('detects cyrillic positive cue after punctuation in mixed preference change', () => {
    expect(
      inferDirectPreferenceChange('я больше не люблю рок. покажи оперу', [
        { name: 'жанр_музыки', value: 'рок' },
        { name: 'тип_мероприятия', value: 'театры' },
      ])
    ).toMatchObject({
      dislikedGenres: ['рок'],
      preferredGenre: 'опера',
      preferredEventType: 'театры',
      canApplyDirectly: true,
      shouldPersistPositivePreference: false,
    });
  });

  test('detects direct target inside a single clause mixed preference change', () => {
    expect(
      inferDirectPreferenceChange('не люблю рок и хочу оперу', [
        { name: 'жанр_музыки', value: 'рок' },
        { name: 'тип_мероприятия', value: 'театры' },
      ])
    ).toMatchObject({
      dislikedGenres: ['рок'],
      preferredGenre: 'опера',
      preferredEventType: 'театры',
      canApplyDirectly: true,
      shouldPersistPositivePreference: false,
    });
  });

  test('persists positive side only when user states stable preference explicitly', () => {
    expect(
      inferDirectPreferenceChange('рок мне больше не нравится, теперь предпочитаю оперу', [
        { name: 'жанр_музыки', value: 'рок' },
        { name: 'тип_мероприятия', value: 'театры' },
      ])
    ).toMatchObject({
      dislikedGenres: ['рок'],
      preferredGenre: 'опера',
      preferredEventType: 'театры',
      canApplyDirectly: true,
      shouldPersistPositivePreference: true,
    });
  });

  test('keeps negative-only preference changes as incomplete for immediate search', () => {
    expect(
      inferDirectPreferenceChange('мне больше не нравятся рок концерты', [
        { name: 'жанр_музыки', value: 'рок' },
        { name: 'тип_мероприятия', value: 'концерты' },
      ])
    ).toMatchObject({
      dislikedGenres: ['рок'],
      preferredGenre: null,
      preferredEventType: null,
      canApplyDirectly: false,
    });
  });

  test('fresh-search reset treats opera target as new theater focus in mixed preference change', () => {
    const directPreferenceChange = inferDirectPreferenceChange(
      'я больше не люблю рок, давай посмотрим оперу',
      [
        { name: 'жанр_музыки', value: 'рок' },
        { name: 'тип_мероприятия', value: 'театры' },
      ]
    );

    expect(
      buildFreshSearchResetPlan({
        userMessage: 'я больше не люблю рок, давай посмотрим оперу',
        currentSlots: [
          { name: 'город', value: 'Нижний Новгород' },
          { name: 'тип_мероприятия', value: 'концерты' },
          { name: 'жанр_музыки', value: 'рок' },
        ],
        newlyExtractedSlots: [{ name: 'жанр_музыки', value: 'классика' }],
        directPreferenceChange,
      })
    ).toMatchObject({
      reasons: expect.arrayContaining([
        'категория сменилась на "театры"',
        'жанр сместился к "опера"',
      ]),
      carryOverSlots: [{ name: 'город', value: 'Нижний Новгород' }],
    });
  });

  test('fresh-search reset does not treat circus alias as category switch to parent shows', () => {
    expect(
      buildFreshSearchResetPlan({
        userMessage: 'хочу на цирк',
        currentSlots: [
          { name: 'город', value: 'Нижний Новгород' },
          { name: 'тип_мероприятия', value: 'цирк' },
          { name: 'дата_события', value: '7 июня' },
        ],
        previousSessionSlots: [
          { name: 'город', value: 'Нижний Новгород' },
          { name: 'тип_мероприятия', value: 'цирк' },
          { name: 'дата_события', value: '7 июня' },
        ],
        newlyExtractedSlots: [
          { name: 'тип_мероприятия', value: 'шоу' },
          { name: 'жанр', value: 'цирк' },
        ],
      })
    ).toBeNull();
  });

  test('direct preference target overrides fallback category detection for search', () => {
    expect(
      resolveDetectedCategoryForSearch({
        newlyExtractedSlots: [{ name: 'жанр_музыки', value: 'классика' }],
        fallbackQuery: 'концерты театры',
        userMessage: 'я больше не люблю рок, давай посмотрим оперу',
        detectedIntents: [{ name: 'change_preferences', trigger: 'я больше не люблю рок' }],
        isChangePreferencesRequest: true,
        directPreferenceChange: inferDirectPreferenceChange(
          'я больше не люблю рок, давай посмотрим оперу',
          [
            { name: 'жанр_музыки', value: 'рок' },
            { name: 'тип_мероприятия', value: 'театры' },
          ]
        ),
      })
    ).toBe('театры');
  });

  test('forces children category for "детские концерты" even when event type slot is concerts', () => {
    expect(
      resolveDetectedCategoryForSearch({
        userMessage: 'Детские концерты',
        newlyExtractedSlots: [
          { name: 'тип_мероприятия', value: 'концерты' },
          { name: 'жанр', value: 'детские' },
        ],
      })
    ).toBe('детям');
  });

  test('forces children category from child audience context even with concerts category', () => {
    expect(
      resolveDetectedCategoryForSearch({
        userMessage: 'Подбери концерты для ребенка 7 лет',
        newlyExtractedSlots: [
          { name: 'тип_мероприятия', value: 'концерты' },
          { name: 'возрастное_ограничение', value: 'дети' },
        ],
      })
    ).toBe('детям');
  });

  test('does not derive search category from event-details intent trigger wording', () => {
    expect(
      resolveDetectedCategoryForSearch({
        userMessage: 'Наследник сколько длится по времени?',
        detectedIntents: [
          {
            name: 'event_details_request',
            trigger: 'сколько длится его концерт?',
            evidence: 'Наследник сколько длится по времени?',
          },
        ],
      })
    ).toBe(null);
  });

  test('does not infer opera target without genre/category slots from ai-slots', () => {
    const directPreferenceChange = inferDirectPreferenceChange(
      'я больше не люблю рок, давай посмотрим оперу',
      []
    );

    expect(directPreferenceChange).toMatchObject({
      dislikedGenres: [],
      preferredGenre: null,
      preferredEventType: null,
      canApplyDirectly: false,
    });
  });

  test('fresh-search reset compares against previous snapshot instead of DB slots polluted by current child request', () => {
    expect(
      buildFreshSearchResetPlan({
        userMessage: 'куда сходить с ребенком 5 лет ?',
        currentSlots: [
          { name: 'город', value: 'Нижний Новгород' },
          { name: 'жанр', value: 'цирк / клоунада' },
          { name: 'тип_мероприятия', value: 'шоу' },
          { name: 'контекст_события', value: 'с_ребенком' },
          { name: 'возрастное_ограничение', value: 'дети' },
          { name: 'возраст_ребенка', value: '5' },
        ],
        previousSessionSlots: [
          { name: 'город', value: 'Нижний Новгород' },
          { name: 'жанр', value: 'цирк / клоунада' },
          { name: 'тип_мероприятия', value: 'шоу' },
        ],
        newlyExtractedSlots: [
          { name: 'контекст_события', value: 'с_ребенком' },
          { name: 'возрастное_ограничение', value: 'дети' },
          { name: 'возраст_ребенка', value: '5' },
        ],
      })
    ).toMatchObject({
      reasons: expect.arrayContaining([
        'новый фильтр аудитории "дети"',
        'новый контекст "с ребенком"',
      ]),
      carryOverSlots: [{ name: 'город', value: 'Нижний Новгород' }],
    });
  });

  test('fresh-search reset drops stale genre context for unknown popular artist discovery query', () => {
    expect(
      buildFreshSearchResetPlan({
        userMessage: 'в Нижний Новгород должен приехать очень популярный артист, но я не помню кто',
        currentSlots: [
          { name: 'город', value: 'Нижний Новгород' },
          { name: 'жанр_музыки', value: 'рок' },
          { name: 'тип_мероприятия', value: 'концерты' },
        ],
        previousSessionSlots: [
          { name: 'город', value: 'Нижний Новгород' },
          { name: 'жанр_музыки', value: 'рок' },
          { name: 'тип_мероприятия', value: 'концерты' },
        ],
        newlyExtractedSlots: [{ name: 'город', value: 'Нижний Новгород' }],
      })
    ).toMatchObject({
      reasons: expect.arrayContaining(['новый широкий поиск по артистам в городе']),
      carryOverSlots: [{ name: 'город', value: 'Нижний Новгород' }],
    });
  });

  test('does not reset known date when category is selected via ui button', () => {
    expect(
      buildFreshSearchResetPlan({
        userMessage: 'Концерты',
        currentSlots: [
          { name: 'город', value: 'Санкт-Петербург' },
          { name: 'дата_события', value: 'воскресенье' },
        ],
        previousSessionSlots: [
          { name: 'город', value: 'Санкт-Петербург' },
          { name: 'дата_события', value: 'воскресенье' },
        ],
        newlyExtractedSlots: [{ name: 'тип_мероприятия', value: 'концерты', source: 'ui' }],
      })
    ).toBeNull();
  });

  test('does not reset known date when category button echo was also extracted by AI slots', () => {
    expect(
      buildFreshSearchResetPlan({
        userMessage: 'Концерты',
        currentSlots: [
          { name: 'город', value: 'Санкт-Петербург' },
          { name: 'дата_события', value: 'воскресенье' },
        ],
        previousSessionSlots: [
          { name: 'город', value: 'Санкт-Петербург' },
          { name: 'дата_события', value: 'воскресенье' },
        ],
        newlyExtractedSlots: [{ name: 'тип_мероприятия', value: 'концерты', confidence: 0.95 }],
        hasMatchedUiButtonEcho: true,
      })
    ).toBeNull();
  });

  test('does not reset known date when genre is selected from clarification buttons', () => {
    expect(
      buildFreshSearchResetPlan({
        userMessage: 'Хип-хоп',
        currentSlots: [
          { name: 'город', value: 'Нижний Новгород' },
          { name: 'дата_события', value: 'следующая неделя' },
          { name: 'бюджет', value: '3000' },
          { name: 'тип_мероприятия', value: 'концерты' },
        ],
        previousSessionSlots: [
          { name: 'город', value: 'Нижний Новгород' },
          { name: 'дата_события', value: 'следующая неделя' },
          { name: 'бюджет', value: '3000' },
          { name: 'тип_мероприятия', value: 'концерты' },
        ],
        newlyExtractedSlots: [{ name: 'жанр_музыки', value: 'рэп', confidence: 0.95 }],
        hasClarificationFollowUpSelection: true,
      })
    ).toBeNull();
  });

  test('does not force concerts category for artist-only named target', () => {
    expect(
      __testUtils.resolveNamedTargetSlotReset(
        [{ name: 'исполнитель', value: 'Павел Воля' }],
        'хочу на Павла Волю в Пензе'
      )
    ).toMatchObject({
      injectConcertCategory: false,
      slotsToRemove: expect.any(Set),
    });
  });

  test('treats persisted show-all query as active broad-search state', () => {
    expect(__testUtils.hasPersistedShowAllQuery([{ name: 'поисковый_запрос', value: 'все' }])).toBe(
      true
    );

    expect(__testUtils.isShowAllSearchQueryValue('Покажи всё')).toBe(true);
    expect(
      __testUtils.hasPersistedShowAllQuery([{ name: 'поисковый_запрос', value: 'концерты' }])
    ).toBe(false);
  });

  test('show-all in category clarification resets event type but keeps time filter', () => {
    const resetSlotNames = __testUtils.buildShowAllResetSlotNames({
      effectiveSlots: [
        { name: 'тип_мероприятия', value: 'концерты' },
        { name: 'время_события', value: 'днем' },
        { name: 'дата_события', value: '18 апреля' },
      ],
      clarificationTarget: 'category',
    });

    expect(resetSlotNames.has('тип_мероприятия')).toBe(true);
    expect(resetSlotNames.has('время_события')).toBe(false);
    expect(resetSlotNames.has('дата_события')).toBe(false);
    expect(resetSlotNames.has('поисковый_запрос')).toBe(true);
  });

  test('show-all in time clarification still resets time filter', () => {
    const resetSlotNames = __testUtils.buildShowAllResetSlotNames({
      effectiveSlots: [{ name: 'тип_мероприятия', value: 'концерты' }],
      clarificationTarget: 'time',
    });

    expect(resetSlotNames.has('тип_мероприятия')).toBe(false);
    expect(resetSlotNames.has('время_события')).toBe(true);
    expect(resetSlotNames.has('концерт_время')).toBe(true);
  });

  test('skips vague clarification when mood plan is already available for city + mood', () => {
    expect(
      __testUtils.shouldSkipVagueClarificationForMoodPlan({
        slots: [
          { name: 'город', value: 'Москва' },
          { name: 'настроение', value: 'веселье' },
        ],
        fallbackQuery: 'посоветуй что-нибудь веселое',
        hasValidCity: true,
      })
    ).toBe(true);

    expect(
      __testUtils.shouldSkipVagueClarificationForMoodPlan({
        slots: [
          { name: 'город', value: 'Москва' },
          { name: 'настроение', value: 'веселье' },
          { name: 'тип_мероприятия', value: 'концерты' },
        ],
        fallbackQuery: 'посоветуй что-нибудь веселое',
        hasValidCity: true,
      })
    ).toBe(false);
  });

  test('skips vague clarification for laugh-oriented family request when city is known', () => {
    expect(
      __testUtils.shouldSkipVagueClarificationForMoodPlan({
        slots: [
          { name: 'город', value: 'Нижний Новгород' },
          { name: 'контекст_события', value: 'с_семьей' },
        ],
        fallbackQuery: 'хочу где-то посмеяться с семьёй',
        hasValidCity: true,
      })
    ).toBe(true);
  });

  test('builds fallback city prompt for broad mood request without inventing categories', () => {
    const response = __testUtils.buildMoodCityPromptResponse({
      moodValue: 'веселье',
      seed: 'test-seed',
    });

    expect(response.buttons).toEqual([
      'Москва',
      'Санкт-Петербург',
      'Екатеринбург',
      'Новосибирск',
      'Казань',
      'Нижний Новгород',
      'Другой город',
    ]);
    expect(response.message.toLowerCase()).toContain('город');
    expect(response.message.toLowerCase()).not.toContain('энерг');
  });

  test('replaces false no-results with city clarification when search was not run', async () => {
    const response = await __testUtils.buildNoSearchClarificationResponse({
      slots: [],
      hasValidCity: false,
      userMessage: 'Не знаю, что хочу. Посоветуй',
      userId: 'user-1',
      sessionId: 'session-1',
    });

    expect(response.message.toLowerCase()).toContain('город');
    expect(response.message.toLowerCase()).not.toContain('не найден');
    expect(response.buttons).toEqual([
      'Москва',
      'Санкт-Петербург',
      'Екатеринбург',
      'Новосибирск',
      'Казань',
      'Нижний Новгород',
      'Другой город',
    ]);
  });

  test('replaces false no-results with category clarification when city is already known', async () => {
    const response = await __testUtils.buildNoSearchClarificationResponse({
      slots: [{ name: 'город', value: 'Москва' }],
      hasValidCity: true,
      userMessage: 'Посоветуй что-нибудь',
      userId: 'user-1',
      sessionId: 'session-1',
    });

    expect(response.message).toMatch(/\?$/u);
    expect(response.message).toMatch(/Москве/u);
    expect(response.message.toLowerCase()).not.toContain('не найден');
    expect(response.buttons).toEqual(
      expect.arrayContaining(['Концерты', 'Театры', 'Выставки', 'Музеи'])
    );
  });

  test('accepts only city-first llm text for broad mood request', () => {
    expect(
      __testUtils.isSafeMoodCityPromptText('Подберу что-нибудь повеселее. В каком городе ищем?', {
        moodValue: 'веселье',
      })
    ).toBe(true);

    expect(
      __testUtils.isSafeMoodCityPromptText(
        'Подберу что-то под ваше настроение. В каком городе искать?',
        { moodValue: 'грусть' }
      )
    ).toBe(true);

    expect(
      __testUtils.isSafeMoodCityPromptText(
        'Вижу, у вас много энергии! Что вам больше по душе: концерты или спорт?',
        { moodValue: 'веселье' }
      )
    ).toBe(false);

    expect(
      __testUtils.isSafeMoodCityPromptText(
        'Под это настроение можно посмотреть концерты или театр. В каком городе искать?',
        { moodValue: 'веселье' }
      )
    ).toBe(false);

    expect(
      __testUtils.isSafeMoodCityPromptText('В котором городе вы хотите найти мероприятие?', {
        moodValue: 'грусть',
      })
    ).toBe(false);
  });

  test('prefers recommendations over health complaint for soft mood plus explicit event request', () => {
    expect(
      __testUtils.shouldPreferRecommendationsOverHealthComplaint({
        userMessage: 'Мне грустно, хочу на концерт',
        healthComplaintIntent: { name: 'health_complaint', confidence: 0.9 },
        recommendationsIntent: { name: 'recommendations_request', confidence: 0.9 },
      })
    ).toBe(true);

    expect(
      __testUtils.shouldPreferRecommendationsOverHealthComplaint({
        userMessage: 'Мне плохо и тревожно, хочу на концерт',
        healthComplaintIntent: { name: 'health_complaint', confidence: 0.9 },
        recommendationsIntent: { name: 'recommendations_request', confidence: 0.9 },
      })
    ).toBe(false);
  });

  test('does not treat negative event feedback as contextual positive feedback', () => {
    expect(
      shouldTreatAsContextualPositiveFeedback({
        userMessage: 'Наследник мне не понравился совсем',
        hasRecentOfferContext: true,
        sessionSlots: [{ name: 'тип_мероприятия', value: 'театры' }],
      })
    ).toBe(false);
  });

  test('builds complaint start response for disliked event instead of positive ack', () => {
    expect(__testUtils.buildEventDislikeComplaintStartResponse()).toEqual({
      replyKind: 'complaint_start',
      message:
        'Понял, этот вариант больше не показываю. Что именно не подошло, чтобы следующий подбор был точнее?',
      buttons: ['Не подошел жанр', 'Не устроила цена', 'Начать с чистого листа'],
      replyData: {
        eventTitles: [],
      },
      offer: null,
    });
  });

  test('builds complaint start response for multiple disliked events', () => {
    expect(
      __testUtils.buildEventDislikeComplaintStartResponse([
        'Время, которое танцует',
        'Дискотека Авария',
      ])
    ).toEqual({
      replyKind: 'complaint_start',
      message:
        'Понял, варианты «Время, которое танцует» и «Дискотека Авария» больше не показываю. ' +
        'Что именно не подошло, чтобы следующий подбор был точнее?',
      buttons: ['Не подошел жанр', 'Не устроила цена', 'Начать с чистого листа'],
      replyData: {
        eventTitles: ['Время, которое танцует', 'Дискотека Авария'],
      },
      offer: null,
    });
  });

  test('accepts broader natural complaint-start phrasings from llm', () => {
    expect(
      __testUtils.isSafeComplaintFlowText(
        'Жаль, что «Корни» не зашли. В чем именно проблема: жанр, цена или хочется просто начать заново?',
        { replyKind: 'complaint_start' }
      )
    ).toBe(true);
  });

  test('accepts empathetic complaint-start reply that asks only about the rejection reason', () => {
    expect(
      __testUtils.isSafeComplaintFlowText(
        'Понимаю, Филипп Киркоров мог совсем не зайти. Что именно смутило: сам артист, жанр, цена или что-то еще?',
        { replyKind: 'complaint_start' }
      )
    ).toBe(true);
  });

  test('accepts complaint-start reply with "что именно вас смутило" phrasing', () => {
    expect(
      __testUtils.isSafeComplaintFlowText(
        'Понимаю, что вам не понравился Филипп Киркоров. Что именно вас смутило? Может быть, жанр или цена билета?',
        { replyKind: 'complaint_start' }
      )
    ).toBe(true);
  });

  test('rejects complaint-start reply that jumps into new genre discovery', () => {
    expect(
      __testUtils.isSafeComplaintFlowText(
        'Жаль, что Филипп Киркоров вам не подошел. Давайте я помогу найти что-то другое. Вы ищете что-то более спокойное или интересует какой-то конкретный жанр?',
        { replyKind: 'complaint_start' }
      )
    ).toBe(false);
  });

  test('rejects awkward complaint-flow reply with broken grammar and unsolicited suggestions', () => {
    expect(
      __testUtils.isSafeComplaintFlowText(
        "Рад уделить внимание вашим предпочтениям. Видите ли, 'Мастер и Маргарита' и 'Серебряное копытце' отличные варианты, но понимаю, что их не подошло. Давайте попробуем найти что-то другое. Как насчет спектаклей в жанре комедии или музыкальных шоу?",
        { replyKind: 'complaint_start' }
      )
    ).toBe(false);
  });

  test('deduplicates disliked event titles in complaint response ignoring case', () => {
    expect(
      __testUtils.buildEventDislikeComplaintStartResponse([
        'Мастер и Маргарита',
        'мастер и маргарита',
      ])
    ).toEqual({
      replyKind: 'complaint_start',
      message:
        'Понял, варианты «Мастер и Маргарита» больше не показываю. Что именно не подошло, чтобы следующий подбор был точнее?',
      buttons: ['Не подошел жанр', 'Не устроила цена', 'Начать с чистого листа'],
      replyData: {
        eventTitles: ['Мастер и Маргарита'],
      },
      offer: null,
    });
  });

  test('normalizes assistant button label typos before sending response', () => {
    expect(__testUtils.normalizeAssistantButtonLabel('Танцевальные вечеиринки')).toBe(
      'Танцевальные вечеринки'
    );
    expect(__testUtils.normalizeAssistantButtonLabel('стэндап')).toBe('Стендап');
  });

  test('detects remembered preference confirmation question without turning it into search request', () => {
    expect(
      __testUtils.isPreferenceMemoryConfirmationQuestion('Мне нравится рок, ты запомнил?', {
        name: 'preference_memory_reference',
        memoryType: 'genre',
      })
    ).toBe(true);

    expect(
      __testUtils.isPreferenceMemoryConfirmationQuestion('Покажи что я люблю', {
        name: 'preference_memory_reference',
        memoryType: 'general',
      })
    ).toBe(false);

    expect(
      __testUtils.isPreferenceMemoryConfirmationQuestion('Мне нравится рок, ты запомнил', {
        name: 'preference_memory_reference',
        memoryType: 'genre',
      })
    ).toBe(true);

    expect(
      __testUtils.shouldPreferPreferenceMemoryMetaRouting('Мне нравится рок, ты запомнил', {
        name: 'preference_memory_reference',
        memoryType: 'genre',
        source: 'llm',
        confidence: 0.95,
      })
    ).toBe(true);

    expect(
      __testUtils.shouldPreferPreferenceMemoryMetaRouting('Мне нравится рок, подбери что-нибудь', {
        name: 'preference_memory_reference',
        memoryType: 'genre',
        source: 'llm',
        confidence: 0.95,
      })
    ).toBe(false);
  });

  test('builds concise remembered preference fallback reply', () => {
    const response = __testUtils.buildPreferenceMemoryConfirmationFallbackResponse({
      userId: 'user-1',
      sessionId: 'session-1',
      userPreferences: {
        genres: ['рок'],
        artists: [],
        eventTypes: ['концерты'],
      },
      memoryType: 'genre',
      userMessage: 'Мне нравится рок, ты запомнил?',
    });

    expect(response.buttons).toEqual([]);
    expect(response.offer).toBeNull();
    expect(response.message).toMatch(/рок/u);
    expect(response.message).not.toMatch(/буду учитывать это в следующих подборках/u);
  });

  test('accepts already-remembered phrasing and rejects fresh-save phrasing for memory confirmation', () => {
    expect(
      __testUtils.isSafePreferenceMemoryConfirmationText(
        'Да, уже помню: вам нравится рок. Буду учитывать это в следующих подборках.'
      )
    ).toBe(true);

    expect(
      __testUtils.isSafePreferenceMemoryConfirmationText(
        'Вспоминаю, что вам понравился рок. Подберу что-то похожее!'
      )
    ).toBe(false);

    expect(
      __testUtils.isSafePreferenceMemoryConfirmationText(
        'Понял вас. В дальнейшем буду учитывать ваше предпочтение за рок-музыку.'
      )
    ).toBe(false);
  });

  test('accepts natural complaint-start phrasings about what bothered the user', () => {
    expect(
      __testUtils.isSafeComplaintFlowText(
        'Понятно, «Корни» не пришлись вам по душе. Что именно вас смущало в этом мероприятии?',
        { replyKind: 'complaint_start' }
      )
    ).toBe(true);

    expect(
      __testUtils.isSafeComplaintFlowText(
        'Разочаровало мероприятие «Корни»? Мне очень жаль это слышать. Что конкретно вас расстроило?',
        { replyKind: 'complaint_start' }
      )
    ).toBe(true);
  });

  test('does not treat heuristic date reply as UI clarification when message is off-topic', () => {
    expect(
      __testUtils.shouldIgnoreRecoveredUiSlotForOffTopic({
        offTopicIntent: { name: 'off_topic', confidence: 0.95 },
        inferredUiSlot: null,
        inferredDateReplySlot: {
          name: 'дата_события',
          value: 'сегодня',
          source: 'heuristic_date_reply',
        },
        isButtonEcho: false,
        isQuickCategorySelection: false,
      })
    ).toBe(true);

    expect(
      __testUtils.shouldIgnoreRecoveredUiSlotForOffTopic({
        offTopicIntent: null,
        inferredUiSlot: null,
        inferredDateReplySlot: {
          name: 'дата_события',
          value: 'сегодня',
          source: 'heuristic_date_reply',
        },
        isButtonEcho: false,
        isQuickCategorySelection: false,
      })
    ).toBe(false);
  });

  test('does not restore date from history when off-topic reset disabled history carry-over', () => {
    expect(
      __testUtils.inferDateSlotFromConversation({
        userMessage: 'Концерты',
        history: [{ role: 'user', content: 'Какая сегодня погода?' }],
        includeHistory: false,
      })
    ).toBeNull();

    expect(
      __testUtils.inferDateSlotFromConversation({
        userMessage: 'Концерты',
        history: [{ role: 'user', content: 'Какая сегодня погода?' }],
        includeHistory: true,
      })
    ).toMatchObject({
      name: 'дата_события',
      value: 'сегодня',
      source: 'heuristic_date_context',
    });

    expect(
      __testUtils.inferDateSlotFromConversation({
        userMessage: 'Покажи все',
        history: [{ role: 'user', content: 'Какая сегодня погода?' }],
        includeHistory: false,
      })
    ).toBeNull();
  });

  test('capitalizes off-topic redirect text start', () => {
    expect(
      __testUtils.normalizeOffTopicRedirectText('это не ответ по теме. Что вам интересно?')
    ).toBe('Это не ответ по теме. Что вам интересно?');
  });

  test('builds fresher off-topic fallback without stale opening', () => {
    const response = __testUtils.buildOffTopicRedirectResponse({
      normalizedCity: 'Пенза',
      hasValidCity: true,
      seed: 'weather-seed',
    });

    expect(response.message[0]).toBe(response.message[0].toUpperCase());
    expect(response.message.toLowerCase()).not.toContain('это не совсем моя тема');
    expect(response.message.toLowerCase()).not.toContain('с таким вопросом я не подскажу');
    expect(response.message.toLowerCase()).not.toContain('по этой теме');
    expect(response.message.toLowerCase()).not.toContain('по этой части');
    expect(response.message.toLowerCase()).not.toContain('по такой теме');
    expect(response.message.toLowerCase()).not.toContain('справку здесь не дам');
    expect(response.message.toLowerCase()).not.toContain('подобрать помогу');
    expect(response.buttons).toEqual(['Концерты', 'Театры', 'Выставки', 'Музеи', 'Покажи все']);
  });

  test('builds contextual off-topic fallback for weather requests', () => {
    const response = __testUtils.buildOffTopicRedirectResponse({
      normalizedCity: 'Нижний Новгород',
      hasValidCity: true,
      seed: 'weather-seed',
      userMessage: 'Подскажи погоду',
    });

    expect(response.message.toLowerCase()).toMatch(/погод|прогноз/);
    expect(response.message).toContain('Нижнем Новгороде');
    expect(response.message).not.toContain('городе Нижний Новгород');
    expect(response.message).not.toContain('Могу быть полезен с афишей');
    expect(response.message).not.toMatch(/^С погодой не сориентирую/u);
    expect(response.buttons).toEqual(['Концерты', 'Театры', 'Выставки', 'Музеи', 'Покажи все']);
  });

  test('builds contextual off-topic fallback for generic purchase requests', () => {
    const response = __testUtils.buildOffTopicRedirectResponse({
      normalizedCity: 'Нижний Новгород',
      hasValidCity: true,
      seed: 'purchase-seed',
      userMessage: 'Хочу купить выдру',
    });

    expect(response.message).toContain('покупкой выдры');
    expect(response.message).toContain('Нижнем Новгороде');
    expect(response.message.toLowerCase()).not.toContain('с таким запросом');
    expect(response.buttons).toEqual(['Концерты', 'Театры', 'Выставки', 'Музеи', 'Покажи все']);
  });

  test('strips duplicated off-topic button categories from llm text', () => {
    expect(
      __testUtils.stripOffTopicButtonCategoryDuplication(
        'С погодой не сориентирую, но помогу выбрать, куда сходить в Нижнем Новгороде. Чем интересуетесь? Концерты, театры, выставки или музеи?'
      )
    ).toBe(
      'С погодой не сориентирую, но помогу выбрать, куда сходить в Нижнем Новгороде. Чем интересуетесь?'
    );

    expect(
      __testUtils.stripOffTopicButtonCategoryDuplication(
        'С погодой не сориентирую, зато помогу выбрать, куда сходить в Нижнем Новгороде. Интересуют концерты или театры?'
      )
    ).toBe(
      'С погодой не сориентирую, зато помогу выбрать, куда сходить в Нижнем Новгороде. Что вам сейчас интереснее?'
    );
  });

  test('rejects repetitive off-topic openings', () => {
    expect(
      __testUtils.isSafeOffTopicRedirectText(
        'По этой теме не подскажу, зато помогу выбрать мероприятие в Нижнем Новгороде. Что вам сейчас интересно?'
      )
    ).toBe(false);

    expect(
      __testUtils.isSafeOffTopicRedirectText(
        'По этой части не сориентирую, зато помогу с афишей в Нижнем Новгороде. Что хотите посмотреть?'
      )
    ).toBe(false);
  });

  test('rejects awkward off-topic redirect phrasing from logs', () => {
    expect(
      __testUtils.isSafeOffTopicRedirectText(
        'Погода меня не специализируется, зато могу найти интересное мероприятие для вас в Санкт-Петербурге. Какие события вам сейчас подойдут?'
      )
    ).toBe(false);

    expect(
      __testUtils.isSafeOffTopicRedirectText(
        'Погода меня не интересует, но я помогу выбрать мероприятие в Нижнем Новгороде. Какие именно вы ищете? Концерты, театры или что-то другое?'
      )
    ).toBe(false);

    expect(
      __testUtils.isSafeOffTopicRedirectText(
        'Погода не интересует, но помогу выбрать, куда сходить в Нижнем Новгороде. Интересуют концерты или театры?'
      )
    ).toBe(false);

    expect(
      __testUtils.isSafeOffTopicRedirectText(
        'Этот вопрос не интересует, зато помогу с афишей в Нижнем Новгороде. Что вам показать?'
      )
    ).toBe(false);

    expect(
      __testUtils.isSafeOffTopicRedirectText(
        'Погода безразлична, но помогу выбрать, куда сходить в Нижнем Новгороде. Что вам показать?'
      )
    ).toBe(false);

    expect(
      __testUtils.isSafeOffTopicRedirectText(
        'По точному прогнозу погоды не подскажу, зато помогу выбрать мероприятие в Нижнем Новгороде. Что вас интересует больше всего?'
      )
    ).toBe(false);

    expect(
      __testUtils.isSafeOffTopicRedirectText(
        'По точному прогнозу погоды не помогу, но могу подобрать для вас интересное мероприятие в Нижнем Новгороде. Чего вы хотели бы посмотреть сегодня?'
      )
    ).toBe(false);

    expect(
      __testUtils.isSafeOffTopicRedirectText(
        'С погодой не сориентирую, зато помогу выбрать, куда сходить в Нижнем Новгороде. Что вам сейчас интереснее?'
      )
    ).toBe(true);
  });

  test('rejects off-topic replies that reuse the previous opening frame', () => {
    const previousAssistantText =
      'С погодой не сориентирую, зато помогу выбрать, куда сходить в Нижнем Новгороде. Какие мероприятия вас интересуют?';

    expect(
      __testUtils.isSafeOffTopicRedirectText(
        'С погодой не помогу, но могу выбрать, куда сходить в Нижнем Новгороде. Что вам сейчас ближе?',
        { previousAssistantText }
      )
    ).toBe(false);

    expect(
      __testUtils.isSafeOffTopicRedirectText(
        'Я не проверяю внешние данные, но с афишей Нижнего Новгорода помогу. Какой формат досуга подобрать?',
        { previousAssistantText }
      )
    ).toBe(true);
  });

  test('rejects off-topic replies that repeat the user topic', () => {
    expect(
      __testUtils.isSafeOffTopicRedirectText(
        'Куплю выдру? Извините, с этим я не помогу. Может быть, вам интересны какие-то мероприятия в Нижнем Новгороде? Например, концерты или выставки?',
        {
          userMessage: 'Хочу купить выдру',
          allowedLeakText: 'Нижний Новгород',
        }
      )
    ).toBe(false);

    expect(
      __testUtils.isSafeOffTopicRedirectText(
        'С покупкой выдры не помогу, зато могу подсказать, куда сходить в Нижнем Новгороде. Что вам сейчас интересно?',
        {
          userMessage: 'Хочу купить выдру',
          allowedLeakText: 'Нижний Новгород',
        }
      )
    ).toBe(true);

    expect(
      __testUtils.isSafeOffTopicRedirectText(
        'К сожалению, сейчас я могу помочь вам выбрать мероприятия и афишу в Нижнем Новгороде. Интересует что-то конкретное? Например, концерты или выставки?',
        {
          userMessage: 'Хочу слона',
          allowedLeakText: 'Нижний Новгород',
        }
      )
    ).toBe(false);

    expect(
      __testUtils.isSafeOffTopicRedirectText(
        'Поиск слонов не входит в мои возможности. Помогу выбрать интересное мероприятие в Нижнем Новгороде. Хорошо бы знать, вам нужно что-то конкретное? Например, концерты или выставки?',
        {
          userMessage: 'Хочу слона',
          allowedLeakText: 'Нижний Новгород',
        }
      )
    ).toBe(false);

    expect(
      __testUtils.isSafeOffTopicRedirectText(
        'С погодой не помогу, зато могу подсказать интересное мероприятие в Нижнем Новгороде. Что вам сейчас интересно посмотреть или сделать?',
        {
          userMessage: 'Что по погоде?',
          allowedLeakText: 'Нижний Новгород',
        }
      )
    ).toBe(true);

    expect(
      __testUtils.isSafeOffTopicRedirectText(
        'Со слоном не подскажу, зато могу подсказать интересные мероприятия в Нижнем Новгороде. Что вам сейчас интересно?',
        {
          userMessage: 'Хочу слона',
          allowedLeakText: 'Нижний Новгород',
        }
      )
    ).toBe(true);

    expect(
      __testUtils.isSafeOffTopicRedirectText(
        'С со слоном не подскажу, зато помогу выбрать, куда сходить в Нижнем Новгороде. Что сейчас интересно?',
        {
          userMessage: 'Хочу слона',
          allowedLeakText: 'Нижний Новгород',
        }
      )
    ).toBe(false);

    expect(
      __testUtils.isSafeOffTopicRedirectText(
        'Тут не помогу, но с афишей Нижнего Новгорода разберусь. Какой формат досуга подобрать?',
        {
          userMessage: 'Какая погода в Нижнем Новгороде?',
          allowedLeakText: 'Нижний Новгород',
        }
      )
    ).toBe(true);
  });

  test('rejects slash-command semantic leakage in off-topic replies', () => {
    expect(__testUtils.hasSlashCommandSemanticLeak('Конечно, давайте начнём сначала.')).toBe(true);
    expect(
      __testUtils.isSafeOffTopicRedirectText(
        'Конечно, давайте начнём сначала. Чем интересуются вы в Нижнем Новгороде?',
        { slashCommand: '/restart' }
      )
    ).toBe(false);
  });

  test('rejects awkward repeated slash-command phrasing', () => {
    expect(
      __testUtils.isSafeOffTopicRedirectText(
        'Конечно, давайте лучше начнём подбирать интересные мероприятия в Нижнем Новгороде. Чем вам сейчас заинтересуетесь?',
        { slashCommand: '/start' }
      )
    ).toBe(false);
  });

  test('global language-quality guard catches awkward phrasing across branches', () => {
    expect(
      __testUtils.hasLowQualityRussianPhrasing(
        'Погода меня не специализируется, зато могу найти интересное мероприятие для вас в Санкт-Петербурге. Какие события вам сейчас подойдут?'
      )
    ).toBe(true);

    expect(
      __testUtils.hasLowQualityRussianPhrasing(
        'Какую дату интересует? Сегодня, завтра, ближайшие выходные или на следующей неделе?'
      )
    ).toBe(true);

    expect(__testUtils.hasLowQualityRussianPhrasing('Какая дата вас интересует?')).toBe(false);
  });

  test('treats bare "любой" as genre reset only in genre-button context', () => {
    expect(
      resolveExplicitAnySelection({
        normalizedUserMessage: 'любой',
        lastAssistantButtons: ['Комедия', 'Драма', 'Мюзикл', 'Любой', 'Покажи все'],
      })
    ).toMatchObject({
      isExplicitAnyGenre: true,
      isExplicitAnyBudget: false,
      isExplicitAnyDate: false,
    });
  });

  test('treats bare "любой" as budget reset only in budget-button context', () => {
    expect(
      resolveExplicitAnySelection({
        normalizedUserMessage: 'любой',
        lastAssistantButtons: ['До 500₽', 'До 1000₽', 'До 3000₽', 'До 5000₽', 'Не важно'],
      })
    ).toMatchObject({
      isExplicitAnyGenre: false,
      isExplicitAnyBudget: true,
      isExplicitAnyDate: false,
    });
  });

  test('treats "не важно" as budget reset in budget-button context', () => {
    expect(
      resolveExplicitAnySelection({
        normalizedUserMessage: 'не важно',
        lastAssistantButtons: ['До 500₽', 'До 1000₽', 'До 3000₽', 'До 5000₽', 'Не важно'],
      })
    ).toMatchObject({
      isExplicitAnyGenre: false,
      isExplicitAnyBudget: true,
      isExplicitAnyDate: false,
    });
  });

  test('does not treat bare "любой" as budget without clarification context', () => {
    expect(
      resolveExplicitAnySelection({
        normalizedUserMessage: 'любой',
        lastAssistantButtons: ['Нижний театр', 'Оперный дом имени М.П. Мусоргского'],
      })
    ).toMatchObject({
      isExplicitAnyGenre: false,
      isExplicitAnyBudget: false,
      isExplicitAnyDate: false,
    });
  });

  test('preserves answered any-budget signal while removing numeric budget filters', () => {
    expect(
      __testUtils.applyExplicitAnyBudgetSelectionToSlots([
        { name: 'город', value: 'Нижний Новгород' },
        { name: 'цена_до', value: '3000' },
      ])
    ).toEqual([
      { name: 'город', value: 'Нижний Новгород' },
      { name: 'бюджет', value: 'любой', confidence: 1.0, source: 'explicit_any_budget' },
    ]);
  });

  test('treats generic positive feedback as contextual preference signal when recent offer exists', () => {
    expect(
      shouldTreatAsContextualPositiveFeedback({
        userMessage: 'мне такое нравится',
        hasRecentOfferContext: true,
        sessionSlots: [],
      })
    ).toBe(true);
  });

  test('treats generic positive feedback as contextual preference signal when session slots exist', () => {
    expect(
      shouldTreatAsContextualPositiveFeedback({
        userMessage: 'мне такое нравится',
        hasRecentOfferContext: false,
        sessionSlots: [
          { name: 'город', value: 'Нижний Новгород' },
          { name: 'тип_мероприятия', value: 'концерты' },
          { name: 'жанр_музыки', value: 'рок' },
        ],
      })
    ).toBe(true);
  });

  test('does not let regex positive-feedback fallback override an AI-detected intent', () => {
    expect(
      shouldTreatAsContextualPositiveFeedback({
        userMessage: 'Чтобы было интересно с ребёнком 11 лет',
        hasRecognizedIntent: true,
        hasRecentOfferContext: false,
        sessionSlots: [
          { name: 'город', value: 'Нижний Новгород' },
          { name: 'возрастное_ограничение', value: 'дети' },
          { name: 'контекст_события', value: 'семейный' },
          { name: 'возраст_ребенка', value: '11' },
        ],
      })
    ).toBe(false);
  });

  test('still allows regex positive-feedback fallback only when AI did not detect any intent', () => {
    expect(
      shouldTreatAsContextualPositiveFeedback({
        userMessage: 'Нам было интересно',
        hasRecognizedIntent: false,
        hasRecentOfferContext: false,
        sessionSlots: [
          { name: 'город', value: 'Нижний Новгород' },
          { name: 'тип_мероприятия', value: 'концерты' },
        ],
      })
    ).toBe(true);
  });

  test('does not treat generic positive phrase as feedback without event context', () => {
    expect(
      shouldTreatAsContextualPositiveFeedback({
        userMessage: 'мне такое нравится',
        hasRecentOfferContext: false,
        sessionSlots: [{ name: 'город', value: 'Нижний Новгород' }],
      })
    ).toBe(false);
  });

  test('guards clarification that invents specific theaters without grounded events', () => {
    expect(
      __testUtils.shouldGuardUngroundedClarificationResponse({
        needsClarification: true,
        offerEvents: null,
        text: 'В Нижнем Новгороде есть несколько интересных театров. Вам подойдёт что-нибудь из этих вариантов?\n\n1. ТЮЗ им. А. С. Пушкина\n2. Театр драмы им. Фёдора Михайловича Достоевского',
        buttons: ['ТЮЗ им. А. С. Пушкина', 'Театр драмы им. Фёдора Михайловича Достоевского'],
        slots: [
          { name: 'город', value: 'Нижний Новгород' },
          { name: 'тип_мероприятия', value: 'театры' },
          { name: 'аудитория_спутник', value: 'пожилой' },
        ],
        vagueRequestInfo: { missingDetails: ['жанр'] },
      })
    ).toMatchObject({
      shouldGuard: true,
      reason: 'clarification_alignment',
      plan: expect.objectContaining({
        target: 'genre',
      }),
    });
  });

  test('rejects unsupported district clarification when city is already known', () => {
    expect(
      __testUtils.asksForUnsupportedAreaClarification(
        'Чтобы выбрать мероприятие для посещения с бабушкой, мне нужно знать ваш город. Вы уже сказали, что ищете в Нижнем Новгороде. В каком районе вы планируете встретиться?',
        ['Центральный', 'Западный', 'Восточный']
      )
    ).toBe(true);

    expect(
      __testUtils.isSafeKnownCityClarificationText(
        'Чтобы выбрать мероприятие для посещения с бабушкой, мне нужно знать ваш город. Вы уже сказали, что ищете в Нижнем Новгороде. В каком районе вы планируете встретиться?'
      )
    ).toBe(false);
  });

  test('treats conflicting relative date wording as unaligned with known date context', () => {
    expect(
      __testUtils.isKnownDateContextAligned(
        'В Санкт-Петербурге послезавтра можно найти развлечения. Что вас интересует?',
        'послезавтра'
      )
    ).toBe(true);

    expect(
      __testUtils.isKnownDateContextAligned(
        'Здравствуйте! Завтра в Санкт-Петербурге можно посмотреть что-то интересное. В каком виде свободного времени вы ищете мероприятие?',
        'послезавтра'
      )
    ).toBe(false);
  });

  test('known-city clarification fallback does not reuse original text with conflicting date', () => {
    const result = __testUtils.buildKnownCityClarificationFallbackResult({
      originalText:
        'Здравствуйте! Завтра в Санкт-Петербурге можно посмотреть что-то интересное. В каком виде свободного времени вы ищете мероприятие?',
      originalButtons: ['Концерты', 'Театры', 'Выставки', 'Музеи', 'Стендап', 'Покажи все'],
      buttons: ['Концерты', 'Театры', 'Выставки', 'Музеи', 'Стендап', 'Покажи все'],
      target: 'category',
      knownCity: 'Санкт-Петербург',
      knownDate: 'послезавтра',
      slots: [
        { name: 'город', value: 'Санкт-Петербург' },
        { name: 'дата_события', value: 'послезавтра' },
      ],
    });

    expect(result).toEqual({
      message: 'Что вам было бы интереснее послезавтра в Санкт-Петербурге?',
      buttons: ['Концерты', 'Театры', 'Выставки', 'Музеи', 'Покажи все'],
      offer: null,
    });
  });

  test('treats truncated assistant phrase as low-quality response', () => {
    expect(
      __testUtils.hasLowQualityRussianPhrasing('На 1 мая в Нижнем Новгороде концертов с участием')
    ).toBe(true);
    expect(
      __testUtils.hasLowQualityRussianPhrasing('На 1 мая в Нижнем Новгороде ничего не найдено.')
    ).toBe(false);
  });

  test('treats concrete answer to pending date clarification as fresh-search trigger', () => {
    expect(
      __testUtils.shouldTreatAsClarificationFollowUpSelection({
        clarificationAsked: true,
        clarificationTarget: 'date',
        newlyExtractedSlots: [{ name: 'дата_события', value: '1 мая' }],
        userMessage: '1 мая',
      })
    ).toBe(true);

    expect(
      __testUtils.shouldTreatAsClarificationFollowUpSelection({
        clarificationAsked: true,
        clarificationTarget: 'date',
        newlyExtractedSlots: [],
        userMessage: 'спасибо',
      })
    ).toBe(false);
  });

  test('sanitizes health complaint buttons to grounded search actions', () => {
    expect(
      __testUtils.sanitizeHealthComplaintButtons(
        ['Подобрать концерты', 'Найти место для выхода злости', 'Не сейчас'],
        'мне плохо'
      )
    ).toEqual(['Найти концерт', 'Найти театр', 'Найти выставку', 'Может, позже']);

    expect(__testUtils.sanitizeHealthComplaintButtons([], 'у меня депрессия')).toEqual([
      'Найти театр',
      'Найти выставку',
      'Найти музей',
      'Может, позже',
    ]);
  });

  test('does not append scripted transition to health reply', () => {
    expect(
      __testUtils.finalizeHealthComplaintText(
        'Мне очень жаль, что вы чувствуете себя так. Важно обратиться к специалистам за поддержкой и советом.',
        'чувствую себя разбитым'
      )
    ).toBe(
      'Мне очень жаль, что вы чувствуете себя так. Важно обратиться к специалистам за поддержкой и советом.'
    );
  });

  test('simplifies awkward health complaint wording from screenshot scenario', () => {
    expect(
      __testUtils.finalizeHealthComplaintText(
        'Мне очень жаль слышать, что у вас сейчас так сложно. Важно обратиться к специалистам за профессиональной помощью. Мероприятия иногда могут поднять настроение и дать силы, но не забывайте про помощь медиков.',
        'у меня депрессия'
      )
    ).toBe(
      'Мне жаль, что вам сейчас плохо. Если состояние не отпускает, лучше поговорить со специалистом. Если захотите немного переключиться, я помогу подобрать спокойное мероприятие. Если становится хуже, обратитесь за срочной помощью.'
    );
  });

  test('rewrites exact logged health complaint cliche', () => {
    const result = __testUtils.finalizeHealthComplaintText(
      'Мне очень жаль, что у вас так тяжело. Я не могу давать профессиональный совет, но иногда искусство может помочь найти силы. Может быть, спокойная выставка или душевный спектакль вам подойдут?',
      'У меня депрессия'
    );

    expect(result).toBe(
      'Мне жаль, что вам сейчас плохо. Советы по состоянию лучше оставлять специалисту; если хочется немного переключиться, я помогу подобрать спокойное мероприятие без обещаний.'
    );
    expect(result).not.toMatch(/что\s+у\s+вас\s+так\s+тяжело/u);
    expect(result).not.toMatch(/искусство\s+может\s+помочь\s+найти\s+силы/u);
    expect(result).not.toMatch(/душевный\s+спектакль/u);
  });

  test('keeps normal health phrases while fixing only awkward wording', () => {
    const first = __testUtils.finalizeHealthComplaintText(
      'Мне очень жаль, что вам сейчас плохо. Я не врач и не психолог, поэтому не могу помочь вам профессионально. Если хотите немного переключиться, я могу подобрать спокойное мероприятие.',
      'У меня депрессия'
    );
    const second = __testUtils.finalizeHealthComplaintText(
      'Мне очень жаль, что у вас так сложилась ситуация. Я не врач и не психолог, поэтому не могу заменить специалиста. Если хотите немного переключиться, можно подобрать спокойное мероприятие.',
      'У меня депрессия'
    );

    expect(first).toBe(
      'Мне очень жаль, что вам сейчас плохо. Я не врач и не психолог, поэтому не могу помочь вам профессионально. Если хотите немного переключиться, я могу подобрать спокойное мероприятие.'
    );
    expect(second).toBe(
      'Жаль, что вам сейчас плохо. Я не врач и не психолог, поэтому не могу заменить специалиста. Если хотите немного переключиться, можно подобрать спокойное мероприятие.'
    );
    expect(first).toContain('Мне очень жаль');
    expect(second).not.toContain('так сложилась ситуация');
  });

  test('keeps LLM health reply with existing transition unchanged', () => {
    expect(
      __testUtils.finalizeHealthComplaintText(
        'Понимаю, что сейчас непросто. Я не заменю врача или психолога. Если хочется немного отвлечься, подберу что-то спокойное из афиши.',
        'У меня депрессия'
      )
    ).toBe(
      'Понимаю, что сейчас непросто. Я не заменю врача или психолога. Если хочется немного отвлечься, подберу что-то спокойное из афиши.'
    );
  });

  test('keeps fallback-style health reply unchanged without appending transition', () => {
    expect(
      __testUtils.finalizeHealthComplaintText(
        'Понимаю, что хочется хоть немного выдохнуть. Я не врач и не психолог, поэтому не могу давать медицинские или психологические советы. Могу подобрать тихий формат на вечер, если вам сейчас хочется отвлечься.',
        'У меня депрессия'
      )
    ).toBe(
      'Понимаю, что хочется хоть немного выдохнуть. Я не врач и не психолог, поэтому не могу давать медицинские или психологические советы. Могу подобрать тихий формат на вечер, если вам сейчас хочется отвлечься.'
    );
  });

  test('fixes broken tak sebya health phrasing without adding duplicate transition', () => {
    expect(
      __testUtils.finalizeHealthComplaintText(
        'Мне жаль, что вы сейчас так себя чувствуете. Я не врач и не психолог, но может быть, вам подойдет спокойное мероприятие?',
        'У меня депрессия'
      )
    ).toBe(
      'Мне жаль, что вам сейчас плохо. Я не врач и не психолог, но может быть, вам подойдет спокойное мероприятие?'
    );
  });

  test('fixes latest health wording and blocks only explicitly bad health phrases', () => {
    expect(
      __testUtils.finalizeHealthComplaintText(
        'Мне жаль, что вы сейчас так себя чувствуете. Я не врач и не психолог, но может быть, стоит выбрать что-то спокойное для переключения внимания?',
        'У меня депрессия'
      )
    ).toBe(
      'Мне жаль, что вам сейчас плохо. Я не врач и не психолог, но может быть, стоит выбрать что-то спокойное для переключения внимания?'
    );

    expect(
      __testUtils.finalizeHealthComplaintText(
        'Мне жаль, что вы так себя чувствуете. Я не врач и не психолог, но может быть, подобрать вам спокойное мероприятие поможет немного расслабиться?',
        'У меня депрессия'
      )
    ).toBe(
      'Мне жаль, что вам сейчас плохо. Я не врач и не психолог, но может быть, подобрать вам спокойное мероприятие поможет немного расслабиться?'
    );
    expect(
      __testUtils.isSafeHealthComplaintText(
        'Мне жаль, что вы так себя чувствуете. Я не врач и не психолог, но может быть, подобрать вам спокойное мероприятие поможет немного расслабиться?'
      )
    ).toBe(true);
    expect(
      __testUtils.isSafeHealthComplaintText(
        'Я понимаю, что это непросто. Я не врач и не психолог, но могу помочь найти интересующее мероприятие, если хотите отвлечься.'
      )
    ).toBe(true);
    expect(
      __testUtils.isSafeHealthComplaintText(
        'Мне жаль, что вы чувствуете себя так. Я не врач, но может быть, стоит посетить спокойное выставку или театр? Это может помочь немного отвлечься.'
      )
    ).toBe(false);
    expect(
      __testUtils.isSafeHealthComplaintText(
        'Я не врач и не психолог, но могу помочь с подбором досуга. Скажете, если хочется посмотреть что-то спокойное.'
      )
    ).toBe(true);
    expect(
      __testUtils.isSafeHealthComplaintText(
        'Жаль, что вам приходится через это проходить. Я не врач и не психолог, но могу бережно помочь с подбором спокойного досуга.'
      )
    ).toBe(true);
    expect(
      __testUtils.isSafeHealthComplaintText(
        'Жаль, что вам сейчас плохо. Я не врач и не психолог; могу только помочь с афишей, если хочется переключиться.'
      )
    ).toBe(true);
    expect(
      __testUtils.isSafeHealthComplaintText(
        'Жаль, что вы чувствуете себя не очень хорошо. Может быть, стоит посмотреть спектакль или выставку? Это поможет отвлечься и почувствовать себя лучше.'
      )
    ).toBe(false);
    expect(
      __testUtils.isSafeHealthComplaintText(
        'Жаль, что вам не очень хорошо. Я могу предложить подобрать интересное мероприятие, чтобы немного отвлечься.'
      )
    ).toBe(false);
    expect(
      __testUtils.isSafeHealthComplaintText(
        'Жаль, что вам неудобно. Может быть, прогулка по выставке или спокойный спектакль помогут погладить нервы?'
      )
    ).toBe(false);
    expect(
      __testUtils.isSafeHealthComplaintText(
        'Мне жаль, что вам сейчас очень плохо. Медицинскую или психологическую поддержку я не заменю, но могу бережно помочь с афишей: если хочется тихо переключиться, подберу что-то спокойное без давления.'
      )
    ).toBe(true);
    expect(
      __testUtils.isSafeHealthComplaintText(
        'Очень жаль, что вы с этим столкнулись. Советы по состоянию лучше оставлять специалисту; со своей стороны могу аккуратно подобрать спокойный вариант из афиши, без лишнего шума.'
      )
    ).toBe(true);
  });

  test('flags apologetic health wording from logged scenario', () => {
    const loggedReply =
      'Извините, что у вас сейчас такое неприятное состояние. Мы не занимаемся медицинской помощью, но может быть, стоит посмотреть афишу на нашем сайте? Вдруг какой-то спектакль или выставка вам придет по душе.';

    expect(__testUtils.isSafeHealthComplaintText(loggedReply)).toBe(false);
    expect(
      __testUtils.finalizeHealthComplaintText(loggedReply, 'мне как то плохо', {
        seed: 'logged-apology-health',
        allowStructuredFallback: true,
      })
    ).not.toMatch(/^(?:Извините|Простите)/u);
  });

  test('flags formal apology and non-afisha advice in health wording', () => {
    const reply =
      'Прошу прощения за ваше состояние, я не могу помочь с физическим самочувствием, но если вам хочется найти что-то интересное для посещения, мы можем предложить афишу различных мероприятий. Может, позже вы решите выйти из дома и подышать свежим воздухом?';

    expect(__testUtils.isSafeHealthComplaintText(reply)).toBe(false);
    expect(
      __testUtils.finalizeHealthComplaintText(reply, 'мне как то плохо', {
        seed: 'formal-apology-health',
        allowStructuredFallback: true,
      })
    ).not.toMatch(/^(?:Извините|Простите|Прошу прощения)/u);
  });

  test('replaces awkward health wording after failed llm retries', () => {
    const reply =
      'Понимаю, что вам сейчас неудобно. У меня нет возможности помочь с вашим состоянием напрямую, но если вам интересна афиша мероприятий, я могу помочь найти что-то подходящее для вас.';

    const result = __testUtils.finalizeHealthComplaintText(reply, 'мне как то плохо', {
      seed: 'awkward-health-retry',
      enforceSafeFallback: true,
    });

    expect(__testUtils.isSafeHealthComplaintText(reply)).toBe(false);
    expect(result).not.toContain('неудобно');
    expect(result).not.toContain('состоянием напрямую');
    expect(result).not.toContain('если вам интересна афиша мероприятий');
    expect(result).toMatch(/(жаль|понимаю|поддержк|специалист|афиш)/iu);
  });

  test('replaces health wording that misses medical or psychological boundary', () => {
    const reply =
      'Жаль, что вам не очень хорошо. Я могу предложить подобрать интересное мероприятие, чтобы немного отвлечься.';

    const result = __testUtils.finalizeHealthComplaintText(reply, 'мне как то плохо', {
      seed: 'missing-health-boundary',
      enforceSafeFallback: true,
    });

    expect(__testUtils.isSafeHealthComplaintText(reply)).toBe(false);
    expect(result).not.toBe(reply);
    expect(result).toMatch(/(медицинск|психологическ|специалист|врач|психолог)/iu);
    expect(result).toMatch(/(афиш|подбер|подобрать|вариант)/iu);
  });

  test('rewrites copied health prompt example while keeping the same structure', () => {
    const scriptedText =
      'Мне жаль, что вам сейчас тяжело. Я не врач и не психолог, поэтому не буду давать советы по состоянию; если становится хуже, лучше обратиться за помощью.\n\n' +
      'Если захотите немного отвлечься, я помогу подобрать спокойное мероприятие.';

    const result = __testUtils.finalizeHealthComplaintText(scriptedText, 'У меня депрессия.', {
      seed: 'health-script-test-seed',
    });

    expect(__testUtils.isScriptedHealthComplaintText(scriptedText)).toBe(true);
    expect(result).not.toBe(scriptedText);
    expect(result).not.toMatch(/что\s+(?:у вас|вам сейчас)\s+так\s+тяжело/u);
    expect(result).not.toMatch(/искусство\s+(?:может\s+)?помога/u);
    expect(result).toMatch(/(врач|психолог|медицинские|психологические)/u);
    expect(result).toMatch(/(отвлечься|переключиться)/u);
  });

  test('keeps LLM health text instead of structured fallback when fallback is disabled', () => {
    const scriptedText =
      'Мне жаль, что вам сейчас тяжело. Я не врач и не психолог, поэтому не буду давать советы по состоянию; если становится хуже, лучше обратиться за помощью.\n\n' +
      'Если захотите немного отвлечься, я помогу подобрать спокойное мероприятие.';

    expect(
      __testUtils.finalizeHealthComplaintText(scriptedText, 'У меня депрессия.', {
        allowStructuredFallback: false,
      })
    ).toBe(scriptedText);
  });

  test('removes foreign words and non-afisha personal advice from health LLM text', () => {
    const result = __testUtils.finalizeHealthComplaintText(
      'Мне очень жаль слышать об этом. Может быть, стоит найти что-нибудь спокойное и расслабляющее для себя? Например, прогулку или чтение книги. Если вам будет легче поговорить, я всегда готов escuchar, но не забывайте, что для такой серьезной проблемы лучше обратиться к специалисту.',
      'У меня депрессия.',
      { allowStructuredFallback: false }
    );

    expect(result).toBe(
      'Мне жаль, что вам сейчас плохо. Если хочется немного переключиться, можно подобрать спокойный вариант из афиши. Если состояние не отпускает, лучше обратиться к специалисту.'
    );
    expect(result).not.toMatch(/[A-Za-z]/u);
    expect(result).not.toMatch(/прогулк|чтени|книг/u);
  });

  test('fixes awkward health wording and does not duplicate existing transition', () => {
    const result = __testUtils.finalizeHealthComplaintText(
      'Я очень понимаю, как вы сейчас чувствуете. Я не врач и не психолог, поэтому не могу дать конкретные советы, но если ваше состояние ухудшается или продолжается, стоит обратиться к специалисту. Если бы вы хотели отвлечься на минутку, можно подобрать спокойное мероприятие, например, посмотреть спектакль или выставку.',
      'У меня депрессия.'
    );

    expect(result).toBe(
      'Понимаю, что вам сейчас плохо. Я не врач и не психолог, поэтому не могу дать конкретные советы, но если ваше состояние ухудшается или продолжается, стоит обратиться к специалисту. Если захотите немного отвлечься, я помогу подобрать спокойное мероприятие.'
    );
    expect(result).not.toContain('как вы сейчас чувствуете');
    expect(result).not.toMatch(
      /Если захотите немного отвлечься.*Если захотите немного отвлечься/su
    );
    expect(result).not.toContain('например');
  });

  test('keeps existing soft transition in health reply and preserves paragraphs', () => {
    expect(
      __testUtils.finalizeHealthComplaintText(
        'Мне очень жаль, что вам тяжело.\n\nЕсли захотите отвлечься, могу подобрать интересные мероприятия.',
        'мне плохо'
      )
    ).toBe(
      'Мне очень жаль, что вам тяжело.\n\nЕсли захотите отвлечься, могу подобрать интересные мероприятия.'
    );
  });

  test('uses angry mood categories for scream-like requests', () => {
    expect(
      __testUtils.resolveHealthComplaintFallbackCategoryButtons('хочу поорать и выпустить пар')
    ).toEqual(['Найти концерт', 'Найти стендап', 'Найти спортивное событие']);

    expect(
      __testUtils.sanitizeHealthComplaintButtons(
        ['Найти место для выхода злости', 'Подобрать концерты'],
        'хочу поорать и выпустить пар'
      )
    ).toEqual(['Найти концерт', 'Найти стендап', 'Найти спортивное событие', 'Может, позже']);
  });

  test('forces narrow category clarification for angry mood outlet requests', () => {
    expect(
      __testUtils.looksLikeAngryMoodOutletRequest('настроение отвратительное, где можно поорать?')
    ).toBe(true);
    expect(__testUtils.buildAngryMoodCategoryClarificationResponse()).toEqual({
      message: 'Похоже, хочется выпустить пар. Что вам сейчас ближе?',
      buttons: ['Концерты', 'Стендап', 'Спорт'],
      offer: null,
    });
  });

  test('treats maybe later quick reply as a safe deferral action', () => {
    expect(__testUtils.isMaybeLaterReplyText('Может, позже')).toBe(true);
    expect(__testUtils.buildMaybeLaterResponse()).toEqual({
      message: 'Хорошо. Если захотите вернуться к подбору мероприятий, я помогу.',
      buttons: [],
      offer: null,
    });
  });

  test('treats category clarification buttons with exhibitions as category rather than genre', () => {
    expect(
      __testUtils.isClarificationCandidateAligned({
        text: 'Что бы вы хотели сделать послезавтра в Санкт-Петербурге?',
        buttons: ['Концерты', 'Театры', 'Выставки', 'Музеи', 'Покажи все'],
        target: 'category',
        expectedButtons: ['Концерты', 'Театры', 'Выставки', 'Музеи', 'Покажи все'],
      })
    ).toBe(true);
  });

  test('rejects generic follow-up text for genre clarification target', () => {
    expect(
      __testUtils.isClarificationTextSpecificForTarget(
        'Что именно вас интересует в воскресенье в Санкт-Петербурге?',
        { target: 'genre', knownEventType: 'концерты' }
      )
    ).toBe(false);

    expect(
      __testUtils.isClarificationTextSpecificForTarget(
        'Какой жанр концертов вам ближе на воскресенье в Санкт-Петербурге?',
        { target: 'genre', knownEventType: 'концерты' }
      )
    ).toBe(true);
  });

  test('treats near-duplicate clarification opening as fallback-worthy repetition', () => {
    expect(
      __testUtils.shouldReplaceClarificationWithFallback(
        'Что именно вас интересует в воскресенье в Санкт-Петербурге?',
        [
          {
            role: 'assistant',
            content: 'Что именно вас интересует на воскресенье в Санкт-Петербурге?',
          },
        ]
      )
    ).toBe(true);
  });

  test('known-city clarification fallback keeps known city and date in category prompt', () => {
    const result = __testUtils.buildKnownCityClarificationFallbackResult({
      originalText:
        'Здравствуйте! Уже завтра ищете что-то интересное? В каком городе вы хотите посетить событие?',
      originalButtons: ['Санкт-Петербург'],
      buttons: ['Концерты', 'Театры', 'Выставки', 'Музеи', 'Покажи все'],
      target: 'category',
      knownCity: 'Санкт-Петербург',
      knownDate: 'послезавтра',
      slots: [
        { name: 'город', value: 'Санкт-Петербург' },
        { name: 'дата_события', value: 'послезавтра' },
      ],
    });

    expect(result).toEqual({
      message: 'Что вам было бы интереснее послезавтра в Санкт-Петербурге?',
      buttons: ['Концерты', 'Театры', 'Выставки', 'Музеи', 'Покажи все'],
      offer: null,
    });
  });

  test('known-city clarification fallback uses explicit genre wording for concerts', () => {
    const result = __testUtils.buildKnownCityClarificationFallbackResult({
      originalText: 'Что именно вас интересует в воскресенье в Санкт-Петербурге?',
      originalButtons: [
        'Рок',
        'Поп',
        'Джаз',
        'Классика',
        'Клубы',
        'Хип-хоп',
        'Любой',
        'Покажи все',
      ],
      buttons: ['Рок', 'Поп', 'Джаз', 'Классика', 'Клубы', 'Хип-хоп', 'Любой', 'Покажи все'],
      target: 'genre',
      knownCity: 'Санкт-Петербург',
      knownDate: 'воскресенье',
      knownEventType: 'концерты',
      slots: [
        { name: 'город', value: 'Санкт-Петербург' },
        { name: 'дата_события', value: 'воскресенье' },
        { name: 'тип_мероприятия', value: 'концерты' },
      ],
    });

    expect(result).toMatchObject({
      message: 'Какой жанр концертов вам ближе на воскресенье в Санкт-Петербурге?',
      offer: null,
    });
    expectConcertGenreButtons(result.buttons);
  });

  test('builds genre clarification with genitive event type label', () => {
    const result = __testUtils.buildClarificationActionResponse({
      target: 'genre',
      knownEventType: 'концерты',
      knownCity: 'Санкт-Петербург',
      knownDate: 'воскресенье',
      slots: [
        { name: 'город', value: 'Санкт-Петербург' },
        { name: 'дата_события', value: 'воскресенье' },
        { name: 'тип_мероприятия', value: 'концерты' },
      ],
    });

    expect(result).toMatchObject({
      message: 'Какой жанр концертов вам ближе на воскресенье в Санкт-Петербурге?',
      offer: null,
    });
    expectConcertGenreButtons(result.buttons);
  });

  test('offers random popular-event categories plus show-all for broad popular request', () => {
    const firstButtons = __testUtils.getPopularCategoryClarificationButtons('popular-seed');
    const secondButtons = __testUtils.getPopularCategoryClarificationButtons('popular-seed');

    expect(firstButtons).toEqual(secondButtons);
    expect(firstButtons).toHaveLength(5);
    expect(firstButtons[firstButtons.length - 1]).toBe('Покажи все');
    expect(new Set(firstButtons).size).toBe(5);
  });

  test('detects when broad popular request should ask category before search', () => {
    expect(
      __testUtils.shouldUsePopularSelectionCategoryClarification({
        userMessage: 'что популярного в Нижнем Новгороде',
        slots: [{ name: 'город', value: 'Нижний Новгород' }],
        knownCity: 'Нижний Новгород',
      })
    ).toBe(true);

    expect(
      __testUtils.shouldUsePopularSelectionCategoryClarification({
        userMessage: 'какие популярные концерты в Нижнем Новгороде',
        slots: [
          { name: 'город', value: 'Нижний Новгород' },
          { name: 'тип_мероприятия', value: 'концерты' },
        ],
        knownCity: 'Нижний Новгород',
      })
    ).toBe(false);
  });

  test('uses correct genre subject for theater clarifications', () => {
    const result = __testUtils.buildClarificationActionResponse({
      target: 'genre',
      knownEventType: 'театры',
      knownCity: 'Санкт-Петербург',
      knownDate: 'суббота',
      slots: [
        { name: 'город', value: 'Санкт-Петербург' },
        { name: 'дата_события', value: 'суббота' },
        { name: 'тип_мероприятия', value: 'театры' },
      ],
    });

    expect(result).toEqual({
      message: 'Какой жанр спектаклей вам ближе на субботу в Санкт-Петербурге?',
      buttons: ['Комедия', 'Драма', 'Мюзикл', 'Детский', 'Классика', 'Любой', 'Покажи все'],
      offer: null,
    });
  });

  test('formats budget clarification with relative month and city context naturally', () => {
    const result = __testUtils.buildClarificationActionResponse({
      target: 'budget',
      knownCity: 'Нижний Новгород',
      knownDate: 'следующий месяц',
      slots: [
        { name: 'город', value: 'Нижний Новгород' },
        { name: 'дата_события', value: 'следующий месяц' },
      ],
    });

    expect(result).toEqual({
      message: 'Какой бюджет на билет вам подходит в следующем месяце в Нижнем Новгороде?',
      buttons: ['До 500₽', 'До 1000₽', 'До 3000₽', 'До 5000₽', 'Не важно'],
      offer: null,
    });
  });

  test('formats time clarification for known concerts and next-week date naturally', () => {
    const result = __testUtils.buildClarificationActionResponse({
      target: 'time',
      knownEventType: 'концерты',
      knownCity: 'Нижний Новгород',
      knownDate: 'следующая неделя',
      slots: [
        { name: 'город', value: 'Нижний Новгород' },
        { name: 'тип_мероприятия', value: 'концерты' },
        { name: 'дата_события', value: 'следующая неделя' },
      ],
    });

    expect(result).toEqual({
      message: 'Когда вам удобнее посетить концерт на следующей неделе в Нижнем Новгороде?',
      buttons: ['Утром', 'Днем', 'Вечером', 'Ночью', 'Любое время', 'Покажи все'],
      offer: null,
    });
  });

  test('formats known weekday slots naturally in clarification context', () => {
    const result = __testUtils.buildClarificationActionResponse({
      target: 'genre',
      knownEventType: 'театры',
      knownCity: 'Санкт-Петербург',
      knownDate: 'суббота',
      slots: [
        { name: 'город', value: 'Санкт-Петербург' },
        { name: 'дата_события', value: 'суббота' },
        { name: 'тип_мероприятия', value: 'театры' },
      ],
    });

    expect(result.message).toBe('Какой жанр спектаклей вам ближе на субботу в Санкт-Петербурге?');
  });

  test('formats known weekend slots naturally in clarification context', () => {
    expect(
      __testUtils.buildClarificationActionResponse({
        target: 'time',
        knownEventType: 'концерты',
        knownCity: 'Нижний Новгород',
        knownDate: 'следующие выходные',
        slots: [
          { name: 'город', value: 'Нижний Новгород' },
          { name: 'тип_мероприятия', value: 'концерты' },
          { name: 'дата_события', value: 'следующие выходные' },
        ],
      }).message
    ).toBe('Когда вам удобнее посетить концерт на следующих выходных в Нижнем Новгороде?');

    expect(
      __testUtils.buildClarificationActionResponse({
        target: 'time',
        knownEventType: 'концерты',
        knownCity: 'Нижний Новгород',
        knownDate: 'ближайшие выходные',
        slots: [
          { name: 'город', value: 'Нижний Новгород' },
          { name: 'тип_мероприятия', value: 'концерты' },
          { name: 'дата_события', value: 'ближайшие выходные' },
        ],
      }).message
    ).toBe('Когда вам удобнее посетить концерт в ближайшие выходные в Нижнем Новгороде?');
  });

  test('known-city fallback does not produce raw nominative next-week slot text', () => {
    const result = __testUtils.buildKnownCityClarificationFallbackResult({
      originalText:
        'Какое время дня вам подходит для концертов в Нижнем Новгороде в следующую неделю?',
      originalButtons: ['Утром', 'Днем', 'Вечerом', 'Ночью', 'Любое время', 'Покажи все'],
      buttons: ['Утром', 'Днем', 'Вечером', 'Ночью', 'Любое время', 'Покажи все'],
      target: 'time',
      knownEventType: 'концерты',
      knownCity: 'Нижний Новгород',
      knownDate: 'следующая неделя',
      history: [],
    });

    expect(result).toEqual({
      message: 'Когда вам удобнее посетить концерт на следующей неделе в Нижнем Новгороде?',
      buttons: ['Утром', 'Днем', 'Вечером', 'Ночью', 'Любое время', 'Покажи все'],
      offer: null,
    });
  });

  test('accepts mixed-script evening button typo as a time clarification button', () => {
    expect(__testUtils.normalizeAssistantButtonLabel('Вечerом')).toBe('Вечером');
    expect(
      __testUtils.isClarificationCandidateAligned({
        text: 'Какое время дня вам подходит для концертов?',
        buttons: ['Утром', 'Днем', 'Вечerом', 'Ночью', 'Любое время', 'Покажи все'],
        target: 'time',
        expectedButtons: ['Утром', 'Днем', 'Вечером', 'Ночью', 'Любое время', 'Покажи все'],
      })
    ).toBe(true);
  });

  test('builds popular category clarification with known city context', () => {
    const result = __testUtils.buildClarificationActionResponse({
      target: 'category',
      knownCity: 'Нижний Новгород',
      slots: [{ name: 'город', value: 'Нижний Новгород' }],
      preferPopularSelectionCategories: true,
      seed: 'nn-popular-category',
    });

    expect(result.message).toBe(
      'Какая категория популярных событий вам интереснее в Нижнем Новгороде?'
    );
    expect(result.buttons).toHaveLength(5);
    expect(result.buttons[result.buttons.length - 1]).toBe('Покажи все');
    expect(new Set(result.buttons).size).toBe(5);
    expect(result.offer).toBeNull();
  });

  test('does not guard grounded theater-genre clarification buttons', () => {
    expect(
      __testUtils.shouldGuardUngroundedClarificationResponse({
        needsClarification: true,
        offerEvents: null,
        text: 'Какой жанр спектакля вам ближе?',
        buttons: ['Комедия', 'Драма', 'Мюзикл', 'Детский', 'Классика', 'Любой', 'Покажи все'],
        slots: [
          { name: 'город', value: 'Нижний Новгород' },
          { name: 'тип_мероприятия', value: 'театры' },
        ],
        vagueRequestInfo: { missingDetails: ['жанр'] },
      })
    ).toMatchObject({
      shouldGuard: false,
    });
  });

  test('keeps first offer text instead of forcing JSON retry when cards are already available', () => {
    expect(
      canUseOfferTextWithoutJsonRetry({
        offerEvents: [{ title: 'TROE' }],
        assistantText: 'Вот несколько вариантов:\n\n1. TROE',
        isEventDetailsRequest: false,
      })
    ).toBe(true);

    expect(
      canUseOfferTextWithoutJsonRetry({
        offerEvents: [{ title: 'TROE' }],
        assistantText: '',
        isEventDetailsRequest: false,
      })
    ).toBe(false);
  });

  test('skips expensive language repair for offer lists with existing cards', () => {
    expect(
      shouldRetryLanguageRepair({
        responseHasNonCyrillic: true,
        offerEvents: [{ title: 'Magic Cello Band' }],
        assistantText: 'Вот несколько вариантов:\n\n1. Magic Cello Band',
        isEventDetailsRequest: false,
      })
    ).toBe(false);

    expect(
      shouldRetryLanguageRepair({
        responseHasNonCyrillic: true,
        offerEvents: [],
        assistantText: 'Magic Cello Band',
        isEventDetailsRequest: false,
      })
    ).toBe(true);
  });

  test('rejects awkward clarification phrases from logs', () => {
    expect(
      __testUtils.isSafeKnownCityClarificationText(
        'Здравствуйте! Хотите найти мероприятие на воскресенье в Санкт-Петербурге. В каком жанре или чем именно вас интересует?',
        { knownCity: 'Санкт-Петербург', knownDate: 'воскресенье' }
      )
    ).toBe(false);

    expect(
      __testUtils.isSafeKnownCityClarificationText(
        'Какую дату интересует? Сегодня, завтра, ближайшие выходные или на следующей неделе?',
        {}
      )
    ).toBe(false);

    expect(
      __testUtils.isSafeKnownCityClarificationText(
        'В Санкт-Петербурге в воскресенье есть разные варианты. Что тебя больше интересует: концерты, театры, выставки или музеи?',
        { knownCity: 'Санкт-Петербург', knownDate: 'воскресенье' }
      )
    ).toBe(false);

    expect(
      __testUtils.isSafeKnownCityClarificationText(
        'Какой бюджет на билет вам подходит следующий месяц в Нижнем Новгороде?',
        { knownCity: 'Нижний Новгород', knownDate: 'следующий месяц' }
      )
    ).toBe(false);
  });

  test('guards clarification answer that narrows known month to invented dates', () => {
    const result = __testUtils.shouldGuardUngroundedClarificationResponse({
      needsClarification: true,
      offerEvents: [],
      text: 'С 24 по 27 мая в Нижнем Новгороде что вам было бы интереснее?',
      buttons: ['Концерты', 'Театры', 'Выставки', 'Музеи', 'Покажи все'],
      slots: [
        { name: 'город', value: 'Нижний Новгород' },
        {
          name: 'дата_события',
          value: 'май',
          dateRange: {
            startDate: new Date('2026-05-01T00:00:00.000Z'),
            endDate: new Date('2026-05-31T23:59:59.999Z'),
          },
        },
      ],
      vagueRequestInfo: {
        isVague: true,
        missingDetails: ['тип_мероприятия', 'бюджет'],
      },
    });

    expect(result).toMatchObject({
      shouldGuard: true,
      reason: 'known_date_mismatch',
    });
  });

  test('known-city fallback preserves month wording instead of invented day range', () => {
    const result = __testUtils.buildKnownCityClarificationFallbackResult({
      originalText: 'С 24 по 27 мая в Нижнем Новгороде что вам было бы интереснее?',
      originalButtons: ['Концерты', 'Театры', 'Выставки', 'Музеи', 'Покажи все'],
      buttons: ['Концерты', 'Театры', 'Выставки', 'Музеи', 'Покажи все'],
      target: 'category',
      knownCity: 'Нижний Новгород',
      knownDate: 'май',
      history: [],
    });

    expect(result).toEqual({
      message: 'Что вам было бы интереснее в мае в Нижнем Новгороде?',
      buttons: ['Концерты', 'Театры', 'Выставки', 'Музеи', 'Покажи все'],
      offer: null,
    });
  });

  test('known-city fallback does not reuse awkward original phrase from logs', () => {
    const result = __testUtils.buildKnownCityClarificationFallbackResult({
      originalText:
        'Здравствуйте! Хотите найти мероприятие на воскресенье в Санкт-Петербурге. В каком жанре или чем именно вас интересует?',
      originalButtons: ['Концерты', 'Театры', 'Выставки', 'Музеи', 'Покажи все'],
      buttons: ['Концерты', 'Театры', 'Выставки', 'Музеи', 'Покажи все'],
      target: 'category',
      knownCity: 'Санкт-Петербург',
      knownDate: 'воскресенье',
      history: [],
    });

    expect(result).toEqual({
      message: 'Что вам было бы интереснее на воскресенье в Санкт-Петербурге?',
      buttons: ['Концерты', 'Театры', 'Выставки', 'Музеи', 'Покажи все'],
      offer: null,
    });
  });

  test('detects pseudo-offer clarification without cards and rewrites it to a category question', () => {
    expect(
      __testUtils.looksLikeOfferTextWithoutCards(
        'Вот несколько интересных вариантов для вас в Нижнем Новгороде:'
      )
    ).toBe(true);

    expect(
      __testUtils.looksLikeOfferTextWithoutCards(
        'Вот несколько интересных вариантов для вас вНижнем Новгороде:'
      )
    ).toBe(true);

    expect(
      __testUtils.looksLikeOfferTextWithoutCards(
        'Вот несколько вариантов, на которые вы можете обратить внимание с 24 по 27 апреля в Нижнем Новгороде. В каком направлении вас больше интересует?'
      )
    ).toBe(true);

    expect(
      __testUtils.buildCardlessOfferFallbackResponse({
        slots: [
          { name: 'город', value: 'Нижний Новгород' },
          { name: 'дата_события', value: 'с 24 по 27 апреля' },
        ],
        hasValidCity: true,
        cityName: 'Нижний Новгород',
      })
    ).toEqual({
      message: 'Что вам было бы интереснее с 24 по 27 апреля в Нижнем Новгороде?',
      buttons: ['Концерты', 'Театры', 'Выставки', 'Музеи', 'Покажи все'],
      offer: null,
    });
  });

  test('show more follow-up with known city and prior cards bypasses vague clarification reset', () => {
    expect(
      __testUtils.shouldBypassVagueClarificationForShowMore({
        isShowMoreRequest: true,
        hasPreviouslyShownEvents: true,
        hasValidCity: true,
      })
    ).toBe(true);
  });

  test('show more does not bypass vague clarification without prior shown events', () => {
    expect(
      __testUtils.shouldBypassVagueClarificationForShowMore({
        isShowMoreRequest: true,
        hasPreviouslyShownEvents: false,
        hasValidCity: true,
      })
    ).toBe(false);
  });

  test('keeps mood-aware genre clarification buttons without explicit category', () => {
    expect(
      __testUtils.getGenreClarificationButtons('', null, [
        { name: 'город', value: 'Нижний Новгород' },
        { name: 'настроение', value: 'веселье' },
        { name: 'контекст_события', value: 'с_семьей' },
      ])
    ).toEqual(['Стендап', 'Комедия', 'Шоу', 'Юмористический концерт', 'Любой', 'Покажи все']);

    expect(
      __testUtils.buildOfferClarificationButtons([
        { name: 'город', value: 'Нижний Новгород' },
        { name: 'настроение', value: 'веселье' },
        { name: 'контекст_события', value: 'с_семьей' },
      ])
    ).toEqual(['Уточнить жанр', 'Уточнить бюджет', 'Уточнить время']);
  });

  test('resolves fun mood family clarification to format buttons even without category slot', () => {
    expect(
      __testUtils.resolveClarificationPlan({
        slots: [
          { name: 'город', value: 'Нижний Новгород' },
          { name: 'контекст_события', value: 'семейный' },
          { name: 'настроение', value: 'Хочу где-то посмеяться с семьёй' },
        ],
        vagueRequestInfo: {
          missingDetails: ['тип_мероприятия', 'бюджет', 'время'],
        },
        seed: 'fun-family-plan',
      })
    ).toEqual({
      target: 'genre',
      buttons: ['Стендап', 'Комедия', 'Шоу', 'Юмористический концерт', 'Любой', 'Покажи все'],
      knownEventType: '',
    });
  });

  test('builds deterministic known-city clarification without asking city again for fun family request', () => {
    const response = __testUtils.buildClarificationActionResponse({
      target: 'genre',
      knownEventType: '',
      slots: [
        { name: 'город', value: 'Нижний Новгород' },
        { name: 'контекст_события', value: 'семейный' },
        { name: 'настроение', value: 'Хочу где-то посмеяться с семьёй' },
      ],
      knownCity: 'Нижний Новгород',
    });

    expect(response.message).toBe('Что вам ближе по формату в Нижнем Новгороде?');
    expect(response.message.toLowerCase()).not.toContain('каком городе');
    expect(response.buttons).toEqual([
      'Стендап',
      'Комедия',
      'Шоу',
      'Юмористический концерт',
      'Любой',
      'Покажи все',
    ]);
  });
});

describe('findMentionedEvent vs assistant quick-reply labels', () => {
  const history = [
    { title: 'Русская народная программа: Концерт' },
    { title: 'Дискотека Авария' },
    { title: 'Время, которое танцует' },
  ];

  test('treats «Найти концерт» as navigation, not a mention of an event title ending with «Концерт»', () => {
    expect(__testUtils.looksLikeAssistantCatalogNavigationMessage('Найти концерт')).toBe(true);
    expect(__testUtils.findMentionedEvent(history, 'Найти концерт', null)).toBe(null);
  });

  test('still resolves an event when the user names it explicitly', () => {
    expect(
      __testUtils.looksLikeAssistantCatalogNavigationMessage('Расскажи про Дискотека Авария')
    ).toBe(false);
    expect(__testUtils.findMentionedEvent(history, 'Дискотека Авария', null)).toEqual(history[1]);
  });

  test('resolves multiple events from one feedback message', () => {
    expect(
      __testUtils.findMentionedEvents(
        history,
        'Мне не нравятся Время, которое танцует и Дискотека Авария',
        null
      )
    ).toEqual([history[2], history[1]]);
  });

  test('recognizes category chips and clarification buttons as navigation', () => {
    expect(__testUtils.looksLikeAssistantCatalogNavigationMessage('Концерты')).toBe(true);
    expect(__testUtils.looksLikeAssistantCatalogNavigationMessage('Уточнить бюджет')).toBe(true);
    expect(__testUtils.looksLikeAssistantCatalogNavigationMessage('Показать другие варианты')).toBe(
      true
    );
  });
});
