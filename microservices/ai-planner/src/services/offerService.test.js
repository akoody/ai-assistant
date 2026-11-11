import { describe, expect, test } from '@jest/globals';
import {
  buildPreferenceCacheToken,
  buildSearchParamsFromSlots,
  buildSearchPlanFromSlots,
  canStopMoodCandidateCollection,
  canUsePopularCitySelection,
  filterEventsByFamilyFriendlyAge,
  inferChildAgeSlotFromConversation,
  preservePreferenceRouteCoverageAfterLlmFilter,
  rankEvents,
  selectEventsForOffer,
} from './offerService.js';

describe('offerService preference cache token', () => {
  test('changes token when dislikes change even without preference expansion', () => {
    const basePreferences = {
      genres: ['опера'],
      artists: [],
      eventTypes: ['театры'],
      dislikedGenres: [],
      dislikedArtists: [],
      dislikedEventTypes: [],
    };

    const withoutDislike = buildPreferenceCacheToken(basePreferences, false);
    const withDislike = buildPreferenceCacheToken(
      {
        ...basePreferences,
        dislikedGenres: ['рок'],
      },
      false
    );

    expect(withoutDislike).not.toBe(withDislike);
    expect(withoutDislike.startsWith('prefs:off:')).toBe(true);
    expect(withDislike.startsWith('prefs:off:')).toBe(true);
  });

  test('routes broad child-audience request to age-specific children section without stale keyword', () => {
    const params = buildSearchParamsFromSlots(
      [
        { name: 'город', value: 'Нижний Новгород' },
        { name: 'контекст_события', value: 'с_ребенком' },
        { name: 'возрастное_ограничение', value: 'дети' },
        { name: 'возраст_ребенка', value: '5' },
      ],
      'куда сходить с ребенком 5 лет ?'
    );

    expect(params.slug).toBe('/detskaya-afisha/for-kids-2-6/');
    expect(params.keyword).toBeUndefined();
  });

  test('infers 6 plus child age and routes to an age-specific children section', () => {
    const slots = inferChildAgeSlotFromConversation(
      [
        { name: 'город', value: 'Нижний Новгород' },
        { name: 'возрастное_ограничение', value: 'дети' },
        { name: 'тип_мероприятия', value: 'детям' },
      ],
      { userMessage: 'Представления для детей 6+' }
    );

    expect(slots).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'возраст_ребенка', value: '6' })])
    );

    const params = buildSearchParamsFromSlots(slots, 'Представления для детей 6+');
    expect(params.slug).toBe('/detskaya-afisha/for-kids-2-6/');
    expect(params.keyword).toBeUndefined();
  });

  test('ignores age-like artist slot in children request search params', () => {
    const params = buildSearchParamsFromSlots(
      [
        { name: 'город', value: 'Нижний Новгород' },
        { name: 'возрастное_ограничение', value: 'дети' },
        { name: 'возраст_ребенка', value: '4' },
        { name: 'исполнитель', value: '6+, можно 4 года' },
        { name: 'тип_мероприятия', value: 'детям' },
      ],
      'детям 6+, можно 4 года'
    );

    expect(params.slug).toBe('/detskaya-afisha/for-kids-2-6/');
    expect(params.keyword).toBeUndefined();
  });

  test('infers child age from spelled-out russian age phrase', () => {
    const slots = inferChildAgeSlotFromConversation(
      [
        { name: 'город', value: 'Нижний Новгород' },
        { name: 'возрастное_ограничение', value: 'дети' },
      ],
      { userMessage: 'Куда можно сегодня сходить с ребёнком с четырёх лет' }
    );

    expect(slots).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'возраст_ребенка', value: '4' })])
    );
  });

  test('routes детям + vague жанр детские + fallback "Детские концерты" to /detskaya-afisha/koncert/', () => {
    const params = buildSearchParamsFromSlots(
      [
        { name: 'город', value: 'Нижний Новгород' },
        { name: 'возрастное_ограничение', value: 'дети' },
        { name: 'тип_мероприятия', value: 'детям' },
        { name: 'жанр', value: 'детские' },
      ],
      'Детские концерты'
    );

    expect(params.slug).toBe('/detskaya-afisha/koncert/');
  });

  test('uses general search for artist request even if category slot is present', () => {
    const params = buildSearchParamsFromSlots(
      [
        { name: 'город', value: 'Пенза' },
        { name: 'исполнитель', value: 'Павел Воля' },
        { name: 'тип_мероприятия', value: 'концерты' },
      ],
      'хочу на Павла Волю в Пензе'
    );

    expect(params.slug).toBe('/category/');
    expect(params.domain).toBe('pnz.kassir.ru');
    expect(params.keyword).toBe('Павел Воля');
  });

  test('routes vague artist request to popular city selection instead of strict artist search', () => {
    const slots = [
      { name: 'город', value: 'Нижний Новгород' },
      { name: 'исполнитель', value: 'очень популярный артист' },
    ];

    const params = buildSearchParamsFromSlots(
      slots,
      'в Нижний Новгород должен приехать очень популярный артист, но я не помню кто'
    );
    const plan = buildSearchPlanFromSlots(
      slots,
      'в Нижний Новгород должен приехать очень популярный артист, но я не помню кто'
    );

    expect(
      canUsePopularCitySelection({
        slots,
        fallbackQuery:
          'в Нижний Новгород должен приехать очень популярный артист, но я не помню кто',
      })
    ).toBe(true);
    expect(params.slug.replace(/\/$/u, '')).toBe('/selection/luchshee-v-nijnem-novgorode');
    expect(params.keyword).toBeUndefined();
    expect(plan.popularSelectionSlug.replace(/\/$/u, '')).toBe(
      '/selection/luchshee-v-nijnem-novgorode'
    );
  });

  test('keeps broad popular request on city popular selection even when slots already inferred concerts', () => {
    const slots = [
      { name: 'город', value: 'Нижний Новгород' },
      { name: 'тип_мероприятия', value: 'концерты' },
    ];

    const params = buildSearchParamsFromSlots(slots, 'Найди что-то популярное');
    const plan = buildSearchPlanFromSlots(slots, 'Найди что-то популярное');

    expect(
      canUsePopularCitySelection({
        slots,
        fallbackQuery: 'Найди что-то популярное',
      })
    ).toBe(true);
    expect(params.slug.replace(/\/$/u, '')).toBe('/selection/luchshee-v-nijnem-novgorode');
    expect(params.keyword).toBeUndefined();
    expect(plan.popularSelectionSlug.replace(/\/$/u, '')).toBe(
      '/selection/luchshee-v-nijnem-novgorode'
    );
  });

  test('routes category-specific popular concerts request to concerts slug without keyword', () => {
    const slots = [
      { name: 'город', value: 'Нижний Новгород' },
      { name: 'тип_мероприятия', value: 'концерты' },
    ];

    const params = buildSearchParamsFromSlots(
      slots,
      'какие популярные концерты в Нижнем Новгороде'
    );

    expect(
      canUsePopularCitySelection({
        slots,
        fallbackQuery: 'какие популярные концерты в Нижнем Новгороде',
      })
    ).toBe(false);
    expect(params.slug).toBe('/bilety-na-koncert/');
    expect(params.sort).toBe(0);
    expect(params.domain).toBe('nn.kassir.ru');
    expect(params.keyword).toBeUndefined();
  });

  test('routes category-specific popular theater request to theater slug without popularity keyword', () => {
    const slots = [
      { name: 'город', value: 'Нижний Новгород' },
      { name: 'жанр', value: 'популярное' },
      { name: 'тип_мероприятия', value: 'театры' },
      { name: 'поисковый_запрос', value: 'популярные театры' },
    ];

    const params = buildSearchParamsFromSlots(slots, 'Хочу в театр на популярное');

    expect(
      canUsePopularCitySelection({
        slots,
        fallbackQuery: 'Хочу в театр на популярное',
      })
    ).toBe(false);
    expect(params.slug).toBe('/bilety-v-teatr/');
    expect(params.sort).toBe(0);
    expect(params.domain).toBe('nn.kassir.ru');
    expect(params.keyword).toBeUndefined();
  });

  test('routes broad multi-category event request with explicit date to city popular selection', () => {
    const userMessage =
      'Какие мероприятия,концерты, спектакли или другие интересные события можно посетить сегодня?';
    const slots = [
      { name: 'город', value: 'Нижний Новгород' },
      { name: 'настроение', value: 'энергичный' },
      { name: 'тип_мероприятия', value: 'концерты' },
      { name: 'жанр', value: 'спектакли' },
      { name: 'дата_события', value: 'сегодня', parsedDate: '2026-04-27T00:00:00.000Z' },
      { name: 'жанр_музыки', value: 'спектакли' },
    ];

    const params = buildSearchParamsFromSlots(slots, 'концерты театры', null, userMessage);
    const plan = buildSearchPlanFromSlots(slots, 'концерты театры', null, userMessage);

    expect(
      canUsePopularCitySelection({
        slots,
        fallbackQuery: 'концерты театры',
        userMessage,
      })
    ).toBe(true);
    expect(params.slug.replace(/\/$/u, '')).toBe('/selection/luchshee-v-nijnem-novgorode');
    expect(params.keyword).toBeUndefined();
    expect(params.date_from).toBe('27.04.2026');
    expect(params.date_to).toBe('27.04.2026');
    expect(plan.primaryParams.slug.replace(/\/$/u, '')).toBe(
      '/selection/luchshee-v-nijnem-novgorode'
    );
    expect(plan.primaryParams.keyword).toBeUndefined();
  });

  test('does not route plain museum category request to city popular selection', () => {
    const slots = [
      { name: 'город', value: 'Нижний Новгород' },
      { name: 'тип_мероприятия', value: 'музеи' },
    ];

    const params = buildSearchParamsFromSlots(slots, 'Музеи есть?');
    const plan = buildSearchPlanFromSlots(slots, 'Музеи есть?');

    expect(
      canUsePopularCitySelection({
        slots,
        fallbackQuery: 'Музеи есть?',
      })
    ).toBe(false);
    expect(params.slug).toBe('/bilety-v-muzei/');
    expect(plan.popularSelectionSlug).toBe(null);
  });

  test('does not treat date-like artist slot as strict named target', () => {
    const message = 'Хочу на следующих выходных на какой-нибудь спектакль';
    const slotsWithoutArtist = [
      { name: 'город', value: 'Нижний Новгород' },
      { name: 'тип_мероприятия', value: 'театры' },
    ];
    const params = buildSearchParamsFromSlots(
      [...slotsWithoutArtist, { name: 'исполнитель', value: 'следующих выходных' }],
      message
    );

    // The date phrase must not become an artist route or keyword: the search is the same
    // as for the request without the artist slot ("спектакль" maps to its theater genre).
    expect(params).toEqual(buildSearchParamsFromSlots(slotsWithoutArtist, message));
    expect(params.slug.startsWith('/bilety-v-teatr/')).toBe(true);
    expect(params.keyword).toBeUndefined();
  });

  test('does not treat mood-like artist slot as strict named target', () => {
    const params = buildSearchParamsFromSlots(
      [
        { name: 'город', value: 'Москва' },
        { name: 'тип_мероприятия', value: 'концерты' },
        { name: 'исполнитель', value: 'поднять настроение' },
      ],
      'Хочу что-нибудь чтобы поднять настроение'
    );

    expect(params.slug).toBe('/bilety-na-koncert/');
    expect(params.keyword).toBeUndefined();
  });

  test('does not treat dance genre-like artist slot as strict named target', () => {
    const params = buildSearchParamsFromSlots(
      [
        { name: 'город', value: 'Нижний Новгород' },
        { name: 'тип_мероприятия', value: 'театры' },
        { name: 'жанр', value: 'танец' },
        { name: 'исполнитель', value: 'танцы' },
      ],
      'Хочу на танцы'
    );

    expect(params.slug).toBe('/bilety-v-teatr/dance/');
    expect(params.keyword).toBeUndefined();
  });

  test('does not treat taxonomy genre duplicated in artist slot as strict named target', () => {
    const params = buildSearchParamsFromSlots(
      [
        { name: 'город', value: 'Нижний Новгород' },
        { name: 'тип_мероприятия', value: 'образование' },
        { name: 'жанр', value: 'мастер-классы' },
        { name: 'исполнитель', value: 'мастер-классы' },
      ],
      'Хочу на мастер-классы'
    );

    expect(params.slug).toBe('/obrazovanie-i-kursy/master-klassy/');
    expect(params.keyword).toBeUndefined();
  });

  test('uses explicit search query slot as keyword for planetarium requests', () => {
    const params = buildSearchParamsFromSlots(
      [
        { name: 'город', value: 'Нижний Новгород' },
        { name: 'поисковый_запрос', value: 'планетарий' },
      ],
      ''
    );

    expect(params.domain).toBe('nn.kassir.ru');
    expect(params.keyword).toBe('планетарий');
  });

  test('does not pass date-only поисковый_запрос into Kassir keyword for category search', () => {
    const params = buildSearchParamsFromSlots(
      [
        { name: 'город', value: 'Нижний Новгород' },
        { name: 'тип_мероприятия', value: 'концерты' },
        { name: 'дата_события', value: 'в субботу' },
        { name: 'поисковый_запрос', value: 'субботу' },
      ],
      ''
    );

    expect(params.slug).toBe('/bilety-na-koncert/');
    expect(params.keyword).toBeUndefined();
  });

  test('does not pass meta preference search query into Kassir keyword', () => {
    const params = buildSearchParamsFromSlots(
      [
        { name: 'город', value: 'Нижний Новгород' },
        { name: 'тип_мероприятия', value: 'концерты' },
        { name: 'предпочтения_жанры', value: 'рок' },
        { name: 'поисковый_запрос', value: 'из любимого' },
      ],
      'Найди что-то из любимого'
    );

    expect(params.slug).toBe('/bilety-na-koncert/rock/');
    expect(params.keyword).toBeUndefined();
  });

  test('does not pass preference phrasing like "по моим предпочтениям" into Kassir keyword', () => {
    const params = buildSearchParamsFromSlots(
      [
        { name: 'город', value: 'Нижний Новгород' },
        { name: 'тип_мероприятия', value: 'концерты' },
        { name: 'предпочтения_жанры', value: 'рок' },
        { name: 'поисковый_запрос', value: 'по моим предпочтениям' },
      ],
      'Подбери по моим предпочтениям'
    );

    expect(params.slug).toBe('/bilety-na-koncert/rock/');
    expect(params.keyword).toBeUndefined();
  });

  test('ignores preference-memory artist slot and keeps genre-based concert routing', () => {
    const params = buildSearchParamsFromSlots(
      [
        { name: 'город', value: 'Нижний Новгород' },
        { name: 'исполнитель', value: 'моего любимого жанра' },
        { name: 'тип_мероприятия', value: 'концерты' },
        { name: 'предпочтения_жанры', value: 'рок' },
      ],
      'Концерт моего любимого жанра'
    );

    expect(params.slug).toBe('/bilety-na-koncert/rock/');
    expect(params.keyword).toBeUndefined();
  });

  test('routes popular-tab quiz and holiday categories to dedicated slugs', () => {
    const quizParams = buildSearchParamsFromSlots(
      [
        { name: 'город', value: 'Нижний Новгород' },
        { name: 'тип_мероприятия', value: 'квизы' },
      ],
      'квизы'
    );

    const holidayParams = buildSearchParamsFromSlots(
      [
        { name: 'город', value: 'Нижний Новгород' },
        { name: 'тип_мероприятия', value: 'праздники' },
      ],
      'праздники'
    );

    expect(quizParams.slug).toBe('/bilety-na-quizi/');
    expect(holidayParams.slug).toBe('/bilety-special/');
  });

  test('routes hip-hop concert genre to hip-hop slug', () => {
    const paramsFromRap = buildSearchParamsFromSlots(
      [
        { name: 'город', value: 'Нижний Новгород' },
        { name: 'тип_мероприятия', value: 'концерты' },
        { name: 'жанр_музыки', value: 'рэп' },
      ],
      'Хип-хоп'
    );

    const paramsFromHipHop = buildSearchParamsFromSlots(
      [
        { name: 'город', value: 'Нижний Новгород' },
        { name: 'тип_мероприятия', value: 'концерты' },
        { name: 'жанр_музыки', value: 'хип-хоп' },
      ],
      'Хип-хоп'
    );

    expect(paramsFromRap.slug).toBe('/bilety-na-koncert/hip-hop/');
    expect(paramsFromRap.keyword).toBeUndefined();
    expect(paramsFromHipHop.slug).toBe('/bilety-na-koncert/hip-hop/');
    expect(paramsFromHipHop.keyword).toBeUndefined();
  });

  test('routes concert club and other genres to dedicated slugs', () => {
    const clubParams = buildSearchParamsFromSlots(
      [
        { name: 'город', value: 'Нижний Новгород' },
        { name: 'тип_мероприятия', value: 'концерты' },
        { name: 'жанр', value: 'клубы' },
      ],
      'Хочу что-нибудь клубное'
    );

    const otherParams = buildSearchParamsFromSlots(
      [
        { name: 'город', value: 'Нижний Новгород' },
        { name: 'тип_мероприятия', value: 'концерты' },
        { name: 'жанр', value: 'другое' },
      ],
      'Другое'
    );

    expect(clubParams.slug).toBe('/bilety-na-koncert/clubs/');
    expect(clubParams.keyword).toBeUndefined();
    expect(otherParams.slug).toBe('/bilety-na-koncert/otherkoncert/');
    expect(otherParams.keyword).toBeUndefined();
  });

  test('keeps stylized latin artist event during strict ranking', () => {
    const ranked = rankEvents(
      [
        {
          title: 'Xolidayboy',
          description: 'Большой концерт Xolidayboy в Пензе',
          date: '25 апреля 2026 г.',
          venue: 'СЗК Дизель-Арена',
        },
        {
          title: 'Алексей Брянцев',
          description: 'Концерт в Пензе',
          date: '14 апреля 2026 г.',
          venue: 'Киноконцертный зал Пенза',
        },
      ],
      [
        { name: 'исполнитель', value: 'холидей бой' },
        { name: 'город', value: 'Пенза' },
      ]
    );

    expect(ranked).toHaveLength(1);
    expect(ranked[0].title).toBe('Xolidayboy');
  });

  test('keeps single Kassir result for named event query even when title uses another spelling', () => {
    const ranked = rankEvents(
      [
        {
          title: 'Xolidayboy',
          description: 'Большой концерт Xolidayboy',
          date: '22 мая 2026 г.',
          venue: 'Дворец спорта Нагорный',
        },
      ],
      [
        { name: 'город', value: 'Нижний Новгород' },
        { name: 'название_мероприятия', value: 'Холодейбой' },
      ]
    );

    expect(ranked).toHaveLength(1);
    expect(ranked[0].title).toBe('Xolidayboy');
  });

  test('keeps event when search query matches venue name', () => {
    const ranked = rankEvents(
      [
        {
          title: 'Вселенная Гарри Поттера',
          description: 'Иммерсивное шоу под звёздным куполом',
          date: '24 апреля 2026 г.',
          venue: 'Планетарий 1',
        },
      ],
      [
        { name: 'город', value: 'Нижний Новгород' },
        { name: 'поисковый_запрос', value: 'планетарий' },
      ]
    );

    expect(ranked).toHaveLength(1);
    expect(ranked[0].venue).toBe('Планетарий 1');
  });

  test('builds mood search plan for fun mood instead of popular selection fallback', () => {
    const slots = [
      { name: 'город', value: 'Москва' },
      { name: 'настроение', value: 'веселье' },
    ];

    const plan = buildSearchPlanFromSlots(slots, 'посоветуй что-нибудь веселое');

    expect(
      canUsePopularCitySelection({ slots, fallbackQuery: 'посоветуй что-нибудь веселое' })
    ).toBe(false);
    expect(plan.moodProfileKey).toBe('fun');
    expect(plan.primaryParams.slug).toBe('/bilety-na-standup/');
    expect(plan.candidates.map((candidate) => candidate.params.slug)).toEqual([
      '/bilety-na-standup/',
      '/bilety-v-teatr/komedii/',
      '/bilety-na-shou/',
      '/bilety-na-koncert/humor/',
      '/bilety-na-koncert/shou/',
    ]);
  });

  test('builds romantic mood plan from dating context without explicit mood slot', () => {
    const slots = [
      { name: 'город', value: 'Москва' },
      { name: 'контекст_события', value: 'свидание' },
    ];

    const plan = buildSearchPlanFromSlots(slots, 'посоветуй что-нибудь романтичное');

    expect(plan.moodProfileKey).toBe('romantic');
    expect(plan.candidates.map((candidate) => candidate.params.slug)).toEqual([
      '/bilety-na-koncert/dzhaz/',
      '/bilety-na-koncert/klassika/',
      '/bilety-v-teatr/melodrama/',
      '/bilety-v-teatr/balet/',
      '/bilety-v-teatr/opera/',
      '/bilety-na-koncert/tvorcheskiy-vecher/',
    ]);
  });

  test('builds independent category routes for multiple stored preference genres', () => {
    const slots = [
      { name: 'город', value: 'Нижний Новгород' },
      { name: 'тип_мероприятия', value: 'театры' },
      { name: 'предпочтения_жанры', value: 'мюзикл' },
      { name: 'предпочтения_жанры', value: 'балет' },
    ];

    const plan = buildSearchPlanFromSlots(slots, 'показать другие варианты');

    expect(plan.primaryParams).toEqual({
      slug: '/bilety-v-teatr/myuzikl/',
      platformState: 'website',
      sort: 0,
      domain: 'nn.kassir.ru',
    });
    expect(plan.candidates.map((candidate) => candidate.params)).toEqual([
      {
        slug: '/bilety-v-teatr/myuzikl/',
        platformState: 'website',
        sort: 0,
        domain: 'nn.kassir.ru',
      },
      {
        slug: '/bilety-v-teatr/balet/',
        platformState: 'website',
        sort: 0,
        domain: 'nn.kassir.ru',
      },
    ]);
  });

  test('drops broad show root route when specific dance show genre slug exists', () => {
    const slots = [
      { name: 'город', value: 'Нижний Новгород' },
      { name: 'тип_мероприятия', value: 'шоу' },
      { name: 'жанр', value: 'танец' },
      { name: 'жанр', value: 'шоу' },
    ];

    const plan = buildSearchPlanFromSlots(slots, 'Хочу на танцы');

    expect(plan.primaryParams).toEqual({
      slug: '/bilety-na-shou/dance/',
      platformState: 'website',
      sort: 0,
      domain: 'nn.kassir.ru',
    });
    expect(plan.candidates.map((candidate) => candidate.params.slug)).toEqual([
      '/bilety-na-shou/dance/',
    ]);
  });

  test('builds multi-category dance routes for ambiguous show-all clarification mode', () => {
    const slots = [
      { name: 'город', value: 'Нижний Новгород' },
      { name: 'жанр', value: 'танец', source: 'ambiguous_genre_context' },
      { name: 'режим_поиска', value: 'ambiguous_category_show_all', source: 'planner_show_all' },
    ];

    const plan = buildSearchPlanFromSlots(slots, 'Покажи все');

    expect(plan.ambiguousCategoryShowAll).toBe(true);
    expect(plan.candidates.map((candidate) => candidate.label)).toEqual([
      'Театры',
      'Концерты',
      'Шоу',
    ]);
    expect(plan.candidates.map((candidate) => candidate.params.slug)).toEqual([
      '/bilety-v-teatr/dance/',
      '/bilety-na-koncert/dance/',
      '/bilety-na-shou/dance/',
    ]);
  });

  test('keeps family search broad and does not enable mood routing for calm family context', () => {
    const slots = [
      { name: 'город', value: 'Нижний Новгород' },
      { name: 'контекст_события', value: 'семейный' },
      { name: 'настроение', value: 'спокойный' },
    ];

    const plan = buildSearchPlanFromSlots(slots, 'хотим провести тихий вечер с семьёй');

    expect(plan.moodProfileKey).toBe(null);
    expect(plan.primaryParams.slug).toBe('/category/');
    expect(plan.candidates.map((candidate) => candidate.params.slug)).toEqual(['/category/']);
  });

  test('filters out 18 plus events for family context', () => {
    const filtered = filterEventsByFamilyFriendlyAge(
      [
        { title: 'Семейный спектакль', ageRestriction: '6+' },
        { title: 'Ночной концерт', ageRestriction: '18+' },
        { title: 'Выставка без маркировки', ageRestriction: null },
        { title: 'Клубное шоу', ageRestriction: '21+' },
      ],
      [{ name: 'контекст_события', value: 'семейный' }]
    );

    expect(filtered.map((event) => event.title)).toEqual([
      'Семейный спектакль',
      'Выставка без маркировки',
    ]);
  });

  test('balances ambiguous category show-all results across route keys', () => {
    const slots = [
      { name: 'город', value: 'Нижний Новгород' },
      { name: 'жанр', value: 'танец', source: 'ambiguous_genre_context' },
      { name: 'режим_поиска', value: 'ambiguous_category_show_all', source: 'planner_show_all' },
    ];

    const selected = selectEventsForOffer(
      [
        { title: 'Театр 1', __searchRouteKeys: ['ambiguous_category:theater'] },
        { title: 'Театр 2', __searchRouteKeys: ['ambiguous_category:theater'] },
        { title: 'Концерт 1', __searchRouteKeys: ['ambiguous_category:concerts'] },
        { title: 'Концерт 2', __searchRouteKeys: ['ambiguous_category:concerts'] },
        { title: 'Шоу 1', __searchRouteKeys: ['ambiguous_category:shows'] },
        { title: 'Шоу 2', __searchRouteKeys: ['ambiguous_category:shows'] },
      ],
      slots,
      5
    );

    expect(selected.map((event) => event.title)).toEqual([
      'Театр 1',
      'Концерт 1',
      'Шоу 1',
      'Театр 2',
      'Концерт 2',
    ]);
  });

  test('builds mood plan from mood-like fallback text even without extracted slot', () => {
    const slots = [{ name: 'город', value: 'Москва' }];

    const plan = buildSearchPlanFromSlots(slots, 'посоветуй что-нибудь весёлое');

    expect(plan.moodProfileKey).toBe('fun');
    expect(plan.primaryParams.slug).toBe('/bilety-na-standup/');
  });

  test('treats "поднять настроение" as fun mood and builds cheerful routes', () => {
    const slots = [{ name: 'город', value: 'Нижний Новгород' }];

    const plan = buildSearchPlanFromSlots(slots, 'хочу поднять настроение');

    expect(plan.moodProfileKey).toBe('fun');
    expect(plan.primaryParams.slug).toBe('/bilety-na-standup/');
    expect(plan.candidates.map((candidate) => candidate.params.slug)).toEqual([
      '/bilety-na-standup/',
      '/bilety-v-teatr/komedii/',
      '/bilety-na-shou/',
      '/bilety-na-koncert/humor/',
      '/bilety-na-koncert/shou/',
    ]);
  });

  test('builds fun mood plan from laughter phrasing in family request', () => {
    const slots = [
      { name: 'город', value: 'Нижний Новгород' },
      { name: 'контекст_события', value: 'с_семьей' },
    ];

    const plan = buildSearchPlanFromSlots(slots, 'хочу где-то посмеяться с семьёй');

    expect(plan.moodProfileKey).toBe('fun');
    expect(plan.primaryParams.slug).toBe('/bilety-v-teatr/komedii/');
    expect(plan.candidates.map((candidate) => candidate.params.slug)).toEqual([
      '/bilety-v-teatr/komedii/',
      '/bilety-na-shou/',
      '/bilety-na-koncert/humor/',
      '/bilety-na-koncert/shou/',
      '/bilety-na-standup/',
    ]);
  });

  test('does not collapse family fun mood plan to single show slug when generic show type is present', () => {
    const slots = [
      { name: 'город', value: 'Нижний Новгород' },
      { name: 'контекст_события', value: 'семейный' },
      { name: 'тип_мероприятия', value: 'шоу' },
    ];

    const plan = buildSearchPlanFromSlots(slots, 'хочу где-то посмеяться с семьёй');

    expect(plan.moodProfileKey).toBe('fun');
    expect(plan.candidates.map((candidate) => candidate.params.slug)).toEqual([
      '/bilety-v-teatr/komedii/',
      '/bilety-na-shou/',
      '/bilety-na-koncert/humor/',
      '/bilety-na-koncert/shou/',
      '/bilety-na-standup/',
    ]);
  });

  test('never falls back to popular selection when mood slot exists alongside generic search text', () => {
    const slots = [
      { name: 'город', value: 'Москва' },
      { name: 'настроение', value: 'веселье' },
      { name: 'поисковый_запрос', value: 'что-нибудь интересное' },
    ];

    expect(
      canUsePopularCitySelection({
        slots,
        fallbackQuery: 'хочу что-нибудь веселое в Москве',
      })
    ).toBe(false);
  });

  test('keeps mood multi-route plan when show-all query is restored in slots', () => {
    const slots = [
      { name: 'город', value: 'Москва' },
      { name: 'настроение', value: 'веселье' },
      { name: 'поисковый_запрос', value: 'все' },
    ];

    const plan = buildSearchPlanFromSlots(slots, 'покажи все');

    expect(plan.moodProfileKey).toBe('fun');
    expect(plan.candidates.map((candidate) => candidate.source)).toEqual([
      'mood:fun:standup',
      'mood:fun:theater-comedy',
      'mood:fun:shows',
      'mood:fun:concert-humor',
      'mood:fun:concert-show',
    ]);
  });

  test('keeps mood routing inside concerts when explicit event type is already known', () => {
    const slots = [
      { name: 'город', value: 'Москва' },
      { name: 'настроение', value: 'грусть' },
      { name: 'тип_мероприятия', value: 'концерты' },
      { name: 'поисковый_запрос', value: 'все' },
    ];

    const plan = buildSearchPlanFromSlots(slots, 'покажи все');

    expect(plan.moodProfileKey).toBe('comfort');
    expect(plan.candidates.map((candidate) => candidate.params.slug)).toEqual([
      '/bilety-na-koncert/dzhaz/',
      '/bilety-na-koncert/klassika/',
      '/bilety-na-koncert/instrumentalnaya-muzyka/',
    ]);
  });

  test('prefers fun events when user asks for a cheerful mood', () => {
    const ranked = rankEvents(
      [
        {
          title: 'Выставка классической живописи',
          description: 'Тихая музейная экспозиция',
          venue: 'Галерея',
          categories: ['Выставка'],
          date: '12 апреля 2026 г.',
        },
        {
          title: 'Большой стендап вечер',
          description: 'Юмор, комедия и импровизация',
          venue: 'Клуб',
          categories: ['Стендап', 'Шоу'],
          date: '12 апреля 2026 г.',
        },
      ],
      [
        { name: 'настроение', value: 'веселье' },
        { name: 'город', value: 'Москва' },
      ]
    );

    expect(ranked[0].title).toBe('Большой стендап вечер');
  });

  test('prefers laugh-oriented family events over unrelated calm shows', () => {
    const ranked = rankEvents(
      [
        {
          title: 'Горячий Джаз',
          description: 'Вечер джазовой музыки с оркестром',
          venue: 'Дом актёра',
          categories: ['Концерт'],
          date: '29 апреля 2026 г.',
        },
        {
          title: 'Однажды в России',
          description: 'Юмористическое шоу для широкой аудитории',
          venue: 'МТС Live Холл',
          categories: ['Шоу', 'Юмор'],
          date: '25 апреля 2026 г.',
        },
      ],
      [
        { name: 'город', value: 'Нижний Новгород' },
        { name: 'контекст_события', value: 'семейный' },
        { name: 'настроение', value: 'Хочу где-то посмеяться с семьёй' },
        { name: 'тип_мероприятия', value: 'шоу' },
      ]
    );

    expect(ranked[0].title).toBe('Однажды в России');
  });

  test('does not apply strict text filtering for generic mood query "поднять настроение"', () => {
    const ranked = rankEvents(
      [
        {
          title: 'Большой стендап вечер',
          description: 'Юмористическое шоу и импровизация',
          venue: 'Клуб',
          categories: ['Стендап', 'Шоу'],
          date: '25 апреля 2026 г.',
        },
        {
          title: 'Музыкальный концерт',
          description: 'Популярные хиты',
          venue: 'Концертный зал',
          categories: ['Концерт'],
          date: '26 апреля 2026 г.',
        },
      ],
      [
        { name: 'город', value: 'Нижний Новгород' },
        { name: 'поисковый_запрос', value: 'поднять настроение' },
      ]
    );

    expect(ranked).toHaveLength(2);
  });

  test('diversifies broad fun mood results across several routes', () => {
    const slots = [
      { name: 'город', value: 'Москва' },
      { name: 'настроение', value: 'веселье' },
    ];

    const selected = selectEventsForOffer(
      [
        {
          title: 'Стендап A',
          venue: 'Клуб 1',
          category: 'Стендап',
          __searchRouteKeys: ['mood:fun:standup'],
        },
        {
          title: 'Стендап B',
          venue: 'Клуб 2',
          category: 'Стендап',
          __searchRouteKeys: ['mood:fun:standup'],
        },
        {
          title: 'Комедия в театре',
          venue: 'Театр',
          category: 'Театр',
          extraCategories: ['Комедии'],
          __searchRouteKeys: ['mood:fun:theater-comedy'],
        },
        {
          title: 'Большое шоу',
          venue: 'Площадка',
          category: 'Шоу',
          __searchRouteKeys: ['mood:fun:shows'],
        },
        {
          title: 'Юмор-концерт',
          venue: 'Зал',
          category: 'Концерт',
          extraCategories: ['Юмор'],
          __searchRouteKeys: ['mood:fun:concert-humor'],
        },
        {
          title: 'Концертное шоу',
          venue: 'Арена',
          category: 'Концерт',
          extraCategories: ['Шоу'],
          __searchRouteKeys: ['mood:fun:concert-show'],
        },
      ],
      slots,
      6
    );

    expect(selected.slice(0, 4).map((event) => event.__searchRouteKeys[0])).toEqual([
      'mood:fun:standup',
      'mood:fun:theater-comedy',
      'mood:fun:shows',
      'mood:fun:concert-humor',
    ]);
  });

  test('diversifies romantic mood results across several routes', () => {
    const slots = [
      { name: 'город', value: 'Москва' },
      { name: 'настроение', value: 'романтика' },
      { name: 'контекст_события', value: 'свидание' },
    ];

    const selected = selectEventsForOffer(
      [
        {
          title: 'Джаз при свечах',
          venue: 'Джаз-клуб',
          category: 'Концерт',
          __searchRouteKeys: ['mood:romantic:concert-jazz'],
        },
        {
          title: 'Классика при свечах',
          venue: 'Усадьба',
          category: 'Концерт',
          __searchRouteKeys: ['mood:romantic:concert-classic'],
        },
        {
          title: 'Мелодрама на двоих',
          venue: 'Театр',
          category: 'Театр',
          __searchRouteKeys: ['mood:romantic:theater-melodrama'],
        },
        {
          title: 'Лебединое озеро',
          venue: 'Большой театр',
          category: 'Театр',
          extraCategories: ['Балет'],
          __searchRouteKeys: ['mood:romantic:theater-ballet'],
        },
        {
          title: 'Евгений Онегин',
          venue: 'Оперный театр',
          category: 'Театр',
          extraCategories: ['Опера'],
          __searchRouteKeys: ['mood:romantic:theater-opera'],
        },
        {
          title: 'Творческий вечер',
          venue: 'Концертный зал',
          category: 'Концерт',
          extraCategories: ['Творческий вечер'],
          __searchRouteKeys: ['mood:romantic:creative-evening'],
        },
      ],
      slots,
      6
    );

    expect(selected.slice(0, 5).map((event) => event.__searchRouteKeys[0])).toEqual([
      'mood:romantic:concert-jazz',
      'mood:romantic:concert-classic',
      'mood:romantic:theater-melodrama',
      'mood:romantic:theater-ballet',
      'mood:romantic:theater-opera',
    ]);
  });

  test('restores missing stored preference genres after global llm filter collapse', () => {
    const slots = [
      { name: 'город', value: 'Нижний Новгород' },
      { name: 'тип_мероприятия', value: 'театры' },
      { name: 'предпочтения_жанры', value: 'драма' },
      { name: 'предпочтения_жанры', value: 'балет' },
    ];

    const basePool = [
      { title: 'Лифт', venue: 'Театр драмы', __searchRouteKeys: ['genre:драма'] },
      { title: 'Гамлет', venue: 'Театр драмы', __searchRouteKeys: ['genre:драма'] },
      {
        title: 'Лебединое озеро',
        venue: 'Театр оперы и балета',
        __searchRouteKeys: ['genre:балет'],
      },
    ];

    const filteredEvents = [
      { title: 'Лифт', venue: 'Театр драмы' },
      { title: 'Гамлет', venue: 'Театр драмы' },
    ];

    const restored = preservePreferenceRouteCoverageAfterLlmFilter(
      filteredEvents,
      basePool,
      slots,
      3
    );

    expect(restored.slice(0, 3).map((event) => event.__searchRouteKeys?.[0])).toEqual([
      'genre:драма',
      'genre:балет',
      'genre:драма',
    ]);
  });

  test('does not stop mood collection before first page of every route is visited', () => {
    const plan = buildSearchPlanFromSlots(
      [
        { name: 'город', value: 'Москва' },
        { name: 'настроение', value: 'романтика' },
      ],
      'посоветуй что-нибудь романтичное'
    );

    expect(
      canStopMoodCandidateCollection({
        searchPlan: plan,
        candidateIndex: 1,
        page: 2,
        searchCandidates: plan.candidates,
      })
    ).toBe(false);

    expect(
      canStopMoodCandidateCollection({
        searchPlan: plan,
        candidateIndex: plan.candidates.length - 1,
        page: 1,
        searchCandidates: plan.candidates,
      })
    ).toBe(true);
  });
});
