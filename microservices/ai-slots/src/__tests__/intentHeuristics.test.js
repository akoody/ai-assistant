import { describe, expect, test } from '@jest/globals';
import { applyIntentHeuristics } from '../services/intentHeuristics.js';

describe('intentHeuristics', () => {
  test('drops all intents for standalone slash commands', () => {
    const result = applyIntentHeuristics(
      '/info',
      [
        { name: 'technical_meta_question', confidence: 0.95, source: 'llm' },
        { name: 'off_topic', confidence: 0.82, source: 'llm' },
      ],
      []
    );

    expect(result).toEqual([
      {
        name: 'off_topic',
        confidence: 0.99,
        trigger: '/info',
        source: 'slash_command',
      },
    ]);
  });

  test('drops off_topic and keeps recommendations intent for opera request', () => {
    const result = applyIntentHeuristics(
      'Привет, хочу на Оперу в МСК или Питере',
      [{ name: 'off_topic', confidence: 0.95, source: 'heuristic' }],
      [
        { name: 'город', value: 'Москва', confidence: 0.9 },
        { name: 'город', value: 'Санкт-Петербург', confidence: 0.9 },
      ]
    );

    expect(result.some((intent) => intent?.name === 'off_topic')).toBe(false);
    expect(result.some((intent) => intent?.name === 'recommendations_request')).toBe(true);
  });

  test('treats genre/category leisure requests as recommendations', () => {
    const cases = [
      'Хочу на джаз в Москве',
      'Хочу на балет в Питере',
      'Хочу на стендап в Москве',
      'Хочу на выставку в Москве',
      'Хочу на экскурсию в Питере',
      'Хочу на мюзикл в Москве',
      'Хочу на кино в Питере',
      'Хочу в музей в Москве',
      'Хочу на фестиваль в Питере',
      'Хочу на квест в Москве',
      'Хочу на спорт в Питере',
      'Хочу на лекцию в Москве',
      'Хочу на мастер-класс в Питере',
      'Хочу на детский спектакль в Москве',
      'Хочу на рок в Питере',
      'Хочу на поп концерт в Москве',
      'Хочу на рэп в Питере',
      'Хочу на классику в Москве',
      'Хочу на электронную музыку в Питере',
      'Хочу на шансон в Москве',
      'Хочу на танцевальное шоу в Питере',
      'Хочу на распродажу в Москве',
      'Хочу на скидки в Питере',
      'Хочу на прогулку по городу в Москве',
    ];

    cases.forEach((text) => {
      const result = applyIntentHeuristics(text, [], []);
      expect(result.some((intent) => intent?.name === 'recommendations_request')).toBe(true);
      expect(result.some((intent) => intent?.name === 'off_topic')).toBe(false);
    });
  });

  test('does not treat generic non-event purchase requests as ticket purchase', () => {
    ['Хочу купить выдру', 'Куплю выдру'].forEach((text) => {
      const result = applyIntentHeuristics(text, [], []);

      expect(result.some((intent) => intent?.name === 'buy_ticket')).toBe(false);
      expect(result.some((intent) => intent?.name === 'recommendations_request')).toBe(false);
      expect(result).toContainEqual({
        name: 'off_topic',
        confidence: 0.95,
        trigger: text,
        source: 'heuristic',
      });
    });
  });

  test('removes model buy_ticket intent for generic non-event purchase requests', () => {
    const result = applyIntentHeuristics(
      'Куплю выдру',
      [
        { name: 'buy_ticket', confidence: 0.9, source: 'llm' },
        { name: 'recommendations_request', confidence: 0.85, source: 'llm' },
        { name: 'off_topic', confidence: 0.8, source: 'llm' },
      ],
      [{ name: 'поисковый_запрос', value: 'выдра', confidence: 0.9 }]
    );

    expect(result.some((intent) => intent?.name === 'buy_ticket')).toBe(false);
    expect(result.some((intent) => intent?.name === 'recommendations_request')).toBe(false);
    expect(result.some((intent) => intent?.name === 'off_topic')).toBe(true);
  });

  test('treats generic non-event desire as off-topic despite search query slot', () => {
    const result = applyIntentHeuristics(
      'Хочу слона',
      [{ name: 'recommendations_request', confidence: 0.9, source: 'llm' }],
      [{ name: 'поисковый_запрос', value: 'слон', confidence: 0.95 }]
    );

    expect(result.some((intent) => intent?.name === 'recommendations_request')).toBe(false);
    expect(result).toContainEqual({
      name: 'off_topic',
      confidence: 0.95,
      trigger: 'Хочу слона',
      source: 'heuristic',
    });
  });

  test('does not treat broad assistant-request verbs as recommendations by themselves', () => {
    ['Подскажи погоду', 'Какая сегодня погода?', 'Расскажи последние новости'].forEach((text) => {
      const result = applyIntentHeuristics(
        text,
        [{ name: 'recommendations_request', confidence: 0.94, source: 'heuristic' }],
        []
      );

      expect(result.some((intent) => intent?.name === 'recommendations_request')).toBe(false);
      expect(result.some((intent) => intent?.name === 'off_topic')).toBe(true);
    });
  });

  test('preserves authoritative model off-topic for external info requests', () => {
    const result = applyIntentHeuristics(
      'Подскажи погоду',
      [
        { name: 'off_topic', confidence: 0.95, source: 'llm' },
        { name: 'recommendations_request', confidence: 0.8, source: 'heuristic' },
      ],
      []
    );

    expect(result.some((intent) => intent?.name === 'recommendations_request')).toBe(false);
    expect(result.some((intent) => intent?.name === 'off_topic')).toBe(true);
  });

  test('keeps ticket purchase intent for explicit ticket and event purchase requests', () => {
    [
      'Хочу купить билет',
      'Хочу купить билеты на концерт',
      'Хочу купить на спектакль',
      'Хочу купить концерт',
      'Хочу купить в музей',
      'Куплю билет',
      'Куплю билеты на концерт',
      'Куплю на спектакль',
    ].forEach((text) => {
      const result = applyIntentHeuristics(text, [], []);

      expect(result).toContainEqual({
        name: 'buy_ticket',
        confidence: 0.95,
        trigger: text,
        source: 'heuristic',
      });
      expect(result.some((intent) => intent?.name === 'off_topic')).toBe(false);
    });
  });

  test('does not mark standalone city reply as off_topic', () => {
    const result = applyIntentHeuristics(
      'Пенза',
      [{ name: 'off_topic', confidence: 0.95, source: 'heuristic' }],
      [{ name: 'город', value: 'Пенза', confidence: 0.9 }]
    );

    expect(result.some((intent) => intent?.name === 'off_topic')).toBe(false);
  });

  test('treats open-ended recommendation request as recommendations instead of off_topic', () => {
    const result = applyIntentHeuristics(
      'Не знаю, что хочу. Посоветуй',
      [{ name: 'off_topic', confidence: 0.95, source: 'heuristic' }],
      []
    );

    expect(result.some((intent) => intent?.name === 'off_topic')).toBe(false);
    expect(result.some((intent) => intent?.name === 'recommendations_request')).toBe(true);
  });

  test('treats category clarification quick reply as non-off-topic', () => {
    const result = applyIntentHeuristics(
      'Уточнить категорию',
      [{ name: 'off_topic', confidence: 0.92, source: 'llm' }],
      []
    );

    expect(result.some((intent) => intent?.name === 'off_topic')).toBe(false);
  });

  test('treats planetarium keyword as domain request instead of off_topic', () => {
    const result = applyIntentHeuristics(
      'Планетарий',
      [{ name: 'off_topic', confidence: 0.95, source: 'heuristic' }],
      []
    );

    expect(result.some((intent) => intent?.name === 'off_topic')).toBe(false);
    expect(result.some((intent) => intent?.name === 'recommendations_request')).toBe(true);
  });

  test('treats illusionist one-word query as recommendations instead of off_topic', () => {
    const result = applyIntentHeuristics(
      'Иллюзионист',
      [{ name: 'off_topic', confidence: 0.95, source: 'heuristic' }],
      []
    );

    expect(result.some((intent) => intent?.name === 'off_topic')).toBe(false);
    expect(result.some((intent) => intent?.name === 'recommendations_request')).toBe(true);
  });

  test('treats unknown popular artist arrival query as recommendations instead of off_topic', () => {
    const result = applyIntentHeuristics(
      'в Нижний Новгород должен приехать очень популярный артист, но я не помню кто',
      [{ name: 'off_topic', confidence: 0.95, source: 'heuristic' }],
      [{ name: 'город', value: 'Нижний Новгород', confidence: 0.9 }]
    );

    expect(result.some((intent) => intent?.name === 'off_topic')).toBe(false);
    expect(result.some((intent) => intent?.name === 'recommendations_request')).toBe(true);
  });

  test('treats vague leisure phrasing as recommendations instead of off_topic', () => {
    [
      'Хочу что-нибудь интересное',
      'Хочу куда-нибудь сходить',
      'Подскажи, чем заняться вечером',
      'Посоветуй, куда выбраться',
      'Хочу где-нибудь погулять',
      'Помоги провести вечер',
      'Ищу, куда пойти',
      'Порекомендуй, как провести время',
    ].forEach((text) => {
      const result = applyIntentHeuristics(
        text,
        [{ name: 'off_topic', confidence: 0.95, source: 'heuristic' }],
        []
      );

      expect(result.some((intent) => intent?.name === 'off_topic')).toBe(false);
      expect(result.some((intent) => intent?.name === 'recommendations_request')).toBe(true);
    });
  });

  test('treats angry mood outlet request as recommendations instead of off_topic', () => {
    const result = applyIntentHeuristics(
      'настроение отвратительное, где можно поорать?',
      [{ name: 'off_topic', confidence: 0.95, source: 'heuristic' }],
      []
    );

    expect(result.some((intent) => intent?.name === 'off_topic')).toBe(false);
    expect(result.some((intent) => intent?.name === 'recommendations_request')).toBe(true);
  });

  test('drops off_topic for explicit negative feedback about an event', () => {
    const result = applyIntentHeuristics(
      'этот спектакль мне совсем не понравился',
      [{ name: 'off_topic', confidence: 0.95, source: 'llm' }],
      []
    );

    expect(result.some((intent) => intent?.name === 'off_topic')).toBe(false);
  });

  test('classifies complaint about previous selection separately from off_topic', () => {
    const result = applyIntentHeuristics(
      'В прошлый раз ты подобрал что-то совсем мимо',
      [{ name: 'off_topic', confidence: 0.95, source: 'llm' }],
      []
    );

    expect(result.some((intent) => intent?.name === 'off_topic')).toBe(false);
    expect(result.some((intent) => intent?.name === 'recommendation_complaint')).toBe(true);
    expect(result.find((intent) => intent?.name === 'recommendation_complaint')).toMatchObject({
      complaintType: 'relevance',
      intensity: 'medium',
    });
  });

  test('classifies criticism towards assistant separately from off_topic', () => {
    const result = applyIntentHeuristics(
      'Ты подбираешь какую-то фигню',
      [{ name: 'off_topic', confidence: 0.95, source: 'llm' }],
      []
    );

    expect(result.some((intent) => intent?.name === 'off_topic')).toBe(false);
    expect(result.some((intent) => intent?.name === 'assistant_criticism')).toBe(true);
    expect(result.find((intent) => intent?.name === 'assistant_criticism')).toMatchObject({
      criticismType: 'hostility',
      intensity: 'high',
      replyStyleHint: 'deescalating',
    });
  });

  test('enriches model criticism intents with structured profile', () => {
    const result = applyIntentHeuristics(
      'Мне не нравится твой тон',
      [{ name: 'assistant_criticism', confidence: 0.95, source: 'llm' }],
      []
    );

    expect(result.find((intent) => intent?.name === 'assistant_criticism')).toMatchObject({
      criticismType: 'tone_style',
      intensity: 'low',
      replyStyleHint: 'calmer',
    });
  });

  test('detects soft assistant criticism heuristically', () => {
    const result = applyIntentHeuristics('Ты мне не нравишься', [], []);

    expect(result.find((intent) => intent?.name === 'assistant_criticism')).toMatchObject({
      criticismType: 'generic',
      intensity: 'low',
      replyStyleHint: 'neutral',
    });
  });

  test('does not let heuristic assistant criticism override authoritative llm memory intent', () => {
    const result = applyIntentHeuristics(
      'Мне нравится рок, ты запомнил?',
      [
        {
          name: 'preference_memory_reference',
          confidence: 0.95,
          source: 'llm',
          memoryType: 'genre',
        },
      ],
      [{ name: 'жанр_музыки', value: 'рок', confidence: 0.95 }]
    );

    expect(result.some((intent) => intent?.name === 'preference_memory_reference')).toBe(true);
    expect(result.some((intent) => intent?.name === 'assistant_criticism')).toBe(false);
  });

  test('does not keep overspecified criticism type when user stated only general dislike', () => {
    const result = applyIntentHeuristics(
      'Ты мне не нравишься',
      [
        {
          name: 'assistant_criticism',
          confidence: 0.95,
          source: 'llm',
          criticismType: 'tone_style',
          replyStyleHint: 'calmer',
        },
      ],
      []
    );

    expect(result.find((intent) => intent?.name === 'assistant_criticism')).toMatchObject({
      criticismType: 'generic',
      intensity: 'low',
      replyStyleHint: 'neutral',
    });
  });

  test('enriches model recommendation complaints with structured reason', () => {
    const result = applyIntentHeuristics(
      'В прошлый раз было слишком дорого',
      [{ name: 'recommendation_complaint', confidence: 0.95, source: 'llm' }],
      []
    );

    expect(result.find((intent) => intent?.name === 'recommendation_complaint')).toMatchObject({
      complaintType: 'price',
      intensity: 'medium',
    });
  });

  test('keeps LLM off_topic for currency-rate questions', () => {
    const result = applyIntentHeuristics(
      'Какой сейчас курс доллара?',
      [{ name: 'off_topic', confidence: 0.95, source: 'llm' }],
      []
    );

    expect(result.some((intent) => intent?.name === 'off_topic')).toBe(true);
    expect(result.some((intent) => intent?.name === 'recommendations_request')).toBe(false);
  });

  test('does not override LLM off_topic with leisure heuristics for ambiguous "курс"', () => {
    const result = applyIntentHeuristics(
      'курс евро на сегодня',
      [{ name: 'off_topic', confidence: 0.93, source: 'llm' }],
      []
    );

    expect(result.some((intent) => intent?.name === 'off_topic')).toBe(true);
    expect(result.some((intent) => intent?.name === 'recommendations_request')).toBe(false);
  });

  test('preserves model-classified negative event feedback and drops off_topic', () => {
    const result = applyIntentHeuristics(
      'Наследник мне не понравился совсем',
      [
        { name: 'negative_event_feedback', confidence: 0.96, source: 'llm' },
        { name: 'off_topic', confidence: 0.9, source: 'llm' },
      ],
      []
    );

    expect(result.some((intent) => intent?.name === 'negative_event_feedback')).toBe(true);
    expect(result.some((intent) => intent?.name === 'off_topic')).toBe(false);
  });

  test('treats common budget-only replies as non-off-topic', () => {
    ['3к', '3 тыс', '3 тыщи', '3000', '3 000 ₽', 'до 3к', 'у меня 3к'].forEach((text) => {
      const result = applyIntentHeuristics(
        text,
        [{ name: 'off_topic', confidence: 0.95, source: 'heuristic' }],
        []
      );

      expect(result.some((intent) => intent?.name === 'off_topic')).toBe(false);
    });
  });

  test('reclassifies hostility towards assistant from health complaint to off_topic', () => {
    const result = applyIntentHeuristics(
      'Я тебя ненавижу',
      [{ name: 'health_complaint', confidence: 0.94, source: 'llm' }],
      []
    );

    expect(result.some((intent) => intent?.name === 'health_complaint')).toBe(false);
    expect(result.some((intent) => intent?.name === 'off_topic')).toBe(true);
  });

  test('reclassifies "Я тебя презираю" from health complaint to off_topic', () => {
    const result = applyIntentHeuristics(
      'Я тебя презираю',
      [{ name: 'health_complaint', confidence: 0.94, source: 'llm' }],
      []
    );

    expect(result.some((intent) => intent?.name === 'health_complaint')).toBe(false);
    expect(result.some((intent) => intent?.name === 'off_topic')).toBe(true);
  });

  test('reclassifies "Ты просто ужасен" from health complaint to off_topic', () => {
    const result = applyIntentHeuristics(
      'Ты просто ужасен',
      [{ name: 'health_complaint', confidence: 0.95, source: 'llm' }],
      []
    );

    expect(result.some((intent) => intent?.name === 'health_complaint')).toBe(false);
    expect(result.some((intent) => intent?.name === 'off_topic')).toBe(true);
  });

  test('drops health complaint when soft mood is combined with explicit concert request', () => {
    const result = applyIntentHeuristics(
      'Мне грустно, хочу на концерт',
      [
        { name: 'health_complaint', confidence: 0.9, source: 'llm' },
        { name: 'recommendations_request', confidence: 0.9, source: 'llm' },
      ],
      []
    );

    expect(result.some((intent) => intent?.name === 'health_complaint')).toBe(false);
    expect(result.some((intent) => intent?.name === 'recommendations_request')).toBe(true);
  });

  test('reclassifies assistant liveness question from smalltalk to off_topic', () => {
    const result = applyIntentHeuristics(
      'Ты живой или нет?',
      [{ name: 'smalltalk', kind: 'ack', confidence: 0.9, source: 'llm' }],
      []
    );

    expect(result.some((intent) => intent?.name === 'smalltalk')).toBe(false);
    expect(result.some((intent) => intent?.name === 'off_topic')).toBe(true);
  });

  test('detects follow-up questions about event duration as event_details_request', () => {
    const cases = [
      'Сколько длится его концерт?',
      'Сколько длится этот спектакль?',
      'Как долго идет выступление?',
      'Сколько по времени концерт?',
      'Какова длительность его концерта?',
      'Продолжительность этого мероприятия?',
    ];

    cases.forEach((text) => {
      const result = applyIntentHeuristics(text, [], []);
      expect(result.some((intent) => intent?.name === 'event_details_request')).toBe(true);
      expect(result.some((intent) => intent?.name === 'recommendations_request')).toBe(false);
      expect(result.some((intent) => intent?.name === 'off_topic')).toBe(false);
    });
  });

  test('detects follow-up questions about event price/venue/time as event_details_request', () => {
    const cases = [
      'Сколько стоит билет туда?',
      'Где проходит это мероприятие?',
      'Когда начинается этот концерт?',
      'По какому адресу проходит?',
      'Во сколько начало?',
      'Расскажи подробнее про него',
      'Есть ли антракт?',
      'С какого возраста можно с ребенком?',
    ];

    cases.forEach((text) => {
      const result = applyIntentHeuristics(text, [], []);
      expect(result.some((intent) => intent?.name === 'event_details_request')).toBe(true);
      expect(result.some((intent) => intent?.name === 'recommendations_request')).toBe(false);
    });
  });

  test('follow-up question suppresses off_topic and recommendations_request from AI Slots', () => {
    const result = applyIntentHeuristics(
      'Сколько длится его концерт?',
      [
        { name: 'recommendations_request', confidence: 0.94, source: 'heuristic' },
        { name: 'off_topic', confidence: 0.8, source: 'llm' },
      ],
      [{ name: 'концерт_время', value: '', confidence: 0.85 }]
    );

    expect(result.some((intent) => intent?.name === 'event_details_request')).toBe(true);
    expect(result.some((intent) => intent?.name === 'recommendations_request')).toBe(false);
    expect(result.some((intent) => intent?.name === 'off_topic')).toBe(false);
  });

  test('does not treat genuine concert requests as follow-up questions', () => {
    const cases = [
      'Найди какие-нибудь популярные концерты',
      'Хочу на концерт',
      'Покажи концерты в Москве',
    ];

    cases.forEach((text) => {
      const result = applyIntentHeuristics(text, [], []);
      expect(result.some((intent) => intent?.name === 'event_details_request')).toBe(false);
      expect(result.some((intent) => intent?.name === 'recommendations_request')).toBe(true);
    });
  });
});
