import {
  fixCommonAwkwardRussianPhrasing,
  improveTextFormatting,
  normalizeAssistantResponse,
  stripDuplicatedButtonLabels,
} from './llm/assistantResponseUtils.js';

describe('assistantResponseUtils', () => {
  test('removes duplicated quick-reply labels from trailing lines', () => {
    const response = normalizeAssistantResponse(
      JSON.stringify({
        text: [
          'Выберите бюджет на билеты для вашего ребенка:',
          '',
          'До 500₽',
          'До 1000₽',
          'До 3000₽',
          'До 5000₽',
          'Не важно',
          'Покажи все',
        ].join('\n'),
        buttons: ['До 500₽', 'До 1000₽', 'До 3000₽', 'До 5000₽', 'Не важно'],
      })
    );

    expect(response.text).toBe('Выберите бюджет на билеты для вашего ребенка:');
    expect(response.buttons).toEqual(['До 500₽', 'До 1000₽', 'До 3000₽', 'До 5000₽', 'Не важно']);
  });

  test('removes duplicated quick-reply labels from inline enumeration', () => {
    const cleaned = stripDuplicatedButtonLabels(
      'Выберите бюджет на билеты для вашего ребенка: До 500₽, До 1000₽, До 3000₽, До 5000₽, Не важно',
      ['До 500₽', 'До 1000₽', 'До 3000₽', 'До 5000₽', 'Не важно']
    );

    expect(cleaned).toBe('Выберите бюджет на билеты для вашего ребенка:');
  });

  test('removes duplicated quick-reply labels from inline "Кнопки" pipe list', () => {
    const response = normalizeAssistantResponse(
      JSON.stringify({
        text: 'Отлично! Будем искать мероприятия на ближайшие выходные. В каком бюджете вы планируете провести время? Кнопки: До 500₽ | До 1000₽ | До 3000₽ | До 5000₽ | Не важно',
        buttons: ['До 500₽', 'До 1000₽', 'До 3000₽', 'До 5000₽', 'Не важно'],
      })
    );

    expect(response.text).toBe(
      'Отлично! Будем искать мероприятия на ближайшие выходные. В каком бюджете вы планируете провести время?'
    );
    expect(response.buttons).toEqual(['До 500₽', 'До 1000₽', 'До 3000₽', 'До 5000₽', 'Не важно']);
  });

  test('fixes broken event type inflection in genre clarifications', () => {
    expect(fixCommonAwkwardRussianPhrasing('Какой жанр концерты вам ближе?')).toBe(
      'Какой жанр концертов вам ближе?'
    );
    expect(fixCommonAwkwardRussianPhrasing('Какой жанр театры вам ближе?')).toBe(
      'Какой жанр спектаклей вам ближе?'
    );
    expect(fixCommonAwkwardRussianPhrasing('Какой жанр выставки вам ближе?')).toBe(
      'Какой жанр выставок вам ближе?'
    );
    expect(fixCommonAwkwardRussianPhrasing('Какой жанр музеи вам ближе?')).toBe(
      'Какой жанр экспозиций вам ближе?'
    );
    expect(
      fixCommonAwkwardRussianPhrasing(
        "Рад уделить внимание вашим предпочтениям. Видите ли, 'Мастер и Маргарита' и 'Серебряное копытце' отличные варианты, но понимаю, что их не подошло."
      )
    ).toBe(
      "Учту ваши предпочтения. 'Мастер и Маргарита' и 'Серебряное копытце' отличные варианты, но понимаю, что они не подошли."
    );
  });

  test('treats empty json from llm as invalid response fallback', () => {
    expect(normalizeAssistantResponse('{}')).toEqual({
      text: 'Извините, не удалось сформировать ответ.',
      buttons: [],
      raw: '{}',
      parsedFromJson: false,
    });
  });

  test('decodes html quote entities in assistant text', () => {
    const response = normalizeAssistantResponse(
      JSON.stringify({
        text: 'теряю корни&rdquo;, &ldquo;Ты узнаешь её&rdquo;, &ldquo;Хочешь я тебе спою&rdquo;.',
        buttons: [],
      })
    );

    expect(response.text).toBe('теряю корни”, “Ты узнаешь её”, “Хочешь я тебе спою”.');
  });

  test('puts age restriction details on a separate line after price', () => {
    const text = improveTextFormatting(
      'Цена: от 500 до 3500 ₽. Возрастное ограничение: 6+. Если хотите, могу помочь с покупкой билета.'
    );

    expect(text).toBe(
      'Цена: от 500 до 3500 ₽.\nВозрастное ограничение: 6+. Если хотите, могу помочь с покупкой билета.'
    );
  });

  test('normalizes object-style buttons from llm json', () => {
    const response = normalizeAssistantResponse(
      JSON.stringify({
        text: 'Жаль, что вариант не подошел. Что именно смутило?',
        buttons: [
          { text: 'Не подошел жанр' },
          { text: 'Не устроила цена' },
          { 'Начать с чистого листа': true },
        ],
      })
    );

    expect(response.text).toBe('Жаль, что вариант не подошел. Что именно смутило?');
    expect(response.buttons).toEqual([
      'Не подошел жанр',
      'Не устроила цена',
      'Начать с чистого листа',
    ]);
  });

  test('extracts inline pipe-separated buttons from text when llm leaves buttons array empty', () => {
    const response = normalizeAssistantResponse(
      JSON.stringify({
        text: 'Вот подборка концертов.\nКнопки: Показать другие варианты | Уточнить жанр | Уточнить бюджет | Уточнить время',
        buttons: [],
      })
    );

    expect(response.text).toBe('Вот подборка концертов.');
    expect(response.buttons).toEqual([
      'Показать другие варианты',
      'Уточнить жанр',
      'Уточнить бюджет',
      'Уточнить время',
    ]);
  });

  test('extracts same-line buttons marker after question when buttons array is missing', () => {
    const response = normalizeAssistantResponse(
      JSON.stringify({
        text: 'Ваши предпочтения - любая дата. В какое время дня вам было бы удобно посетить стендап в Нижнем Новгороде? Кнопки: Утром | Днем | Вечером | Ночью | Любое время | Покажи все',
      })
    );

    expect(response.text).toBe(
      'Ваши предпочтения - любая дата. В какое время дня вам было бы удобно посетить стендап в Нижнем Новгороде?'
    );
    expect(response.buttons).toEqual([
      'Утром',
      'Днем',
      'Вечером',
      'Ночью',
      'Любое время',
      'Покажи все',
    ]);
  });
});
