import { describe, expect, test } from '@jest/globals';
import { buildSystemPrompt } from './promptBuilder.js';

describe('planner promptBuilder romantic clarification', () => {
  test('instructs LLM to acknowledge freshly stored positive preference', async () => {
    const prompt = await buildSystemPrompt({
      slots: [
        { name: 'город', value: 'Нижний Новгород' },
        { name: 'жанр', value: 'опера' },
        { name: 'тип_мероприятия', value: 'театры' },
      ],
      requestType: 'default',
      offerEvents: [
        {
          id: 1,
          title: 'Богема',
          date: '4 июня 2026 г.',
          venue: 'Театр оперы и балета',
          priceMin: 500,
          priceMax: 5000,
        },
      ],
      userId: 'test-user',
      sessionId: 'test-session',
      noResultsDetected: false,
      userIntent: {
        recommendationsRequest: { name: 'recommendations_request', confidence: 0.94 },
      },
      userMessage: 'люблю оперу',
      userPreferences: {},
    });

    expect(prompt).toContain('свежее_предпочтение');
    expect(prompt).toContain('пользователь сейчас явно сообщил позитивное предпочтение "опера"');
    expect(prompt).toContain('Система уже сохраняет это в память');
    expect(prompt).toContain('Запомнил, что вам нравится опера.');
  });

  test('does not ask LLM to acknowledge negative preference as liked', async () => {
    const prompt = await buildSystemPrompt({
      slots: [
        { name: 'город', value: 'Нижний Новгород' },
        { name: 'жанр', value: 'рок', isNegative: true },
      ],
      requestType: 'default',
      offerEvents: [],
      userId: 'test-user',
      sessionId: 'test-session',
      noResultsDetected: false,
      userIntent: {},
      userMessage: 'не люблю рок',
      vagueRequestInfo: {
        isVague: true,
        missingDetails: ['тип_мероприятия'],
      },
      userPreferences: {},
    });

    expect(prompt).not.toContain('свежее_предпочтение');
    expect(prompt).not.toContain('Запомнил, что вам нравится рок.');
  });

  test('acknowledges positive preference when message also contains a negative preference', async () => {
    const prompt = await buildSystemPrompt({
      slots: [
        { name: 'город', value: 'Нижний Новгород' },
        { name: 'жанр', value: 'опера' },
      ],
      requestType: 'default',
      offerEvents: [],
      userId: 'test-user',
      sessionId: 'test-session',
      noResultsDetected: false,
      userIntent: {},
      userMessage: 'не люблю рок, но люблю оперу',
      vagueRequestInfo: {
        isVague: true,
        missingDetails: ['тип_мероприятия'],
      },
      userPreferences: {},
    });

    expect(prompt).toContain('свежее_предпочтение');
    expect(prompt).toContain('пользователь сейчас явно сообщил позитивное предпочтение "опера"');
    expect(prompt).toContain('Запомнил, что вам нравится опера.');
    expect(prompt).not.toContain('Запомнил, что вам нравится рок.');
  });

  test('adds romantic guidance when date context is known and category is still missing', async () => {
    const prompt = await buildSystemPrompt({
      slots: [
        { name: 'город', value: 'Москва' },
        { name: 'контекст_события', value: 'свидание' },
      ],
      requestType: 'general_dialog',
      offerEvents: [],
      userId: 'test-user',
      sessionId: 'test-session',
      noResultsDetected: false,
      userIntent: {},
      userMessage: 'Куда сходить с девушкой?',
      vagueRequestInfo: {
        isVague: true,
        missingDetails: ['тип_мероприятия'],
      },
      userPreferences: {},
    });

    expect(prompt).toContain('РОМАНТИЧЕСКИЙ КОНТЕКСТ');
    expect(prompt).toContain('свидания/вечера вдвоём');
  });

  test('adds soft mood guidance for vague clarification when user is sad and wants events', async () => {
    const prompt = await buildSystemPrompt({
      slots: [
        { name: 'город', value: 'Пенза' },
        { name: 'тип_мероприятия', value: 'концерты' },
        { name: 'настроение', value: 'грусть' },
      ],
      requestType: 'default',
      offerEvents: [],
      userId: 'test-user',
      sessionId: 'test-session',
      noResultsDetected: false,
      userIntent: {
        recommendationsRequest: { name: 'recommendations_request', confidence: 0.9 },
      },
      userMessage: 'Мне грустно, хочу на концерт',
      vagueRequestInfo: {
        isVague: true,
        missingDetails: ['бюджет', 'дата', 'время'],
      },
      userPreferences: {},
    });

    expect(prompt).toContain('ЭМОЦИОНАЛЬНЫЙ КОНТЕКСТ');
    expect(prompt).toContain('не начинай сразу с сухого вопроса');
    expect(prompt).toContain('одну короткую человеческую фразу с эмпатией');
  });

  test('does not seed invented numeric ranges when known date is a month', async () => {
    const prompt = await buildSystemPrompt({
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
        { name: 'аудитория_спутник', value: 'пожилой' },
        { name: 'контекст_события', value: 'семейный' },
      ],
      requestType: 'default',
      offerEvents: [],
      userId: 'test-user',
      sessionId: 'test-session',
      noResultsDetected: false,
      userIntent: {
        recommendationsRequest: { name: 'recommendations_request', confidence: 0.95 },
      },
      userMessage: 'Хочу сходить куда-нибудь с бабушкой в мае',
      vagueRequestInfo: {
        isVague: true,
        missingDetails: ['тип_мероприятия', 'бюджет'],
      },
      userPreferences: {},
    });

    expect(prompt).toContain('дата или период: "май"');
    expect(prompt).toContain('ЗАПРЕЩЕНО сужать период до конкретных чисел');
    expect(prompt).toContain('НЕ придумывай числа внутри периода');
    expect(prompt).not.toContain('24 по 27');
    expect(prompt).not.toContain('24-27');
  });

  test('locks health complaint buttons to grounded kassir categories', async () => {
    const prompt = await buildSystemPrompt({
      slots: [],
      requestType: 'default',
      offerEvents: [],
      userId: 'test-user',
      sessionId: 'test-session',
      noResultsDetected: false,
      userIntent: {
        healthComplaint: { name: 'health_complaint', confidence: 0.95 },
      },
      userMessage: 'мне очень плохо',
      userPreferences: {},
    });

    expect(prompt).toContain(
      '["Найти концерт","Найти театр","Найти выставку","Найти музей","Найти стендап","Найти спортивное событие","Может, позже"]'
    );
    expect(prompt).toContain('Запрещено придумывать любые другие кнопки');
    expect(prompt).toContain('Найти место для выхода злости');
    expect(prompt).toContain('хочу поорать');
    expect(prompt).toContain('без фиксированного порядка');
    expect(prompt).toContain('обязательно должны быть три смысла');
    expect(prompt).toContain('медицинской или психологической помощи/советов');
    expect(prompt).toContain('Границу не пропускай');
    expect(prompt).toContain('медицинскую или психологическую помощь я не заменю');
    expect(prompt).toContain('не могу давать медицинские или психологические советы');
    expect(prompt).toContain('подобрать мероприятие или посмотреть афишу');
    expect(prompt).toContain('Не отвечай одной короткой фразой или одним вопросом');
    expect(prompt).toContain('Не повторяй мысль о переключении или подборе');
    expect(prompt).toContain('не нужно всегда три ровных предложения одинакового размера');
    expect(prompt).toContain('Не начинай с дисклеймера');
    expect(prompt).toContain('Не извиняйся за состояние пользователя');
    expect(prompt).toContain('Не пиши "не хорошо" раздельно');
    expect(prompt).not.toContain('что у вас сейчас так сложно');
    expect(prompt).not.toContain('что вы сейчас так себя чувствуете');
    expect(prompt).not.toContain('"мне очень жаль"');
    expect(prompt).not.toContain('что у вас так сложилась ситуация');
    expect(prompt).toContain('врача и психолога');
    expect(prompt).not.toContain('искусство может помочь найти силы');
    expect(prompt).not.toContain('душевный спектакль');
    expect(prompt).toContain('«Найти театр», «Найти выставку», «Найти музей»');
  });

  test('uses fun mood format buttons for genre clarification without explicit category', async () => {
    const prompt = await buildSystemPrompt({
      slots: [
        { name: 'город', value: 'Нижний Новгород' },
        { name: 'настроение', value: 'веселье' },
        { name: 'контекст_события', value: 'с_семьей' },
      ],
      requestType: 'default',
      offerEvents: [],
      userId: 'test-user',
      sessionId: 'test-session',
      noResultsDetected: false,
      userIntent: {},
      userMessage: 'Уточнить жанр',
      userPreferences: {},
    });

    expect(prompt).toContain(
      '["Стендап","Комедия","Шоу","Юмористический концерт","Любой","Покажи все"]'
    );
  });
});
