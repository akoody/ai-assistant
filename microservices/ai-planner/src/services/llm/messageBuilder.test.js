import { describe, expect, test } from '@jest/globals';
import {
  attachAssistantButtonsToContent,
  compressHistoryIfNeeded,
  estimateMessagesTokens,
  trimHistoryMessages,
  truncateHistoryContent,
} from './messageBuilder.js';

describe('messageBuilder history compression', () => {
  test('keeps short clarification replies even when many verbose messages exist', () => {
    const history = [
      { role: 'assistant', content: 'Очень длинное вводное сообщение '.repeat(40) },
      {
        role: 'user',
        content: 'Хочу что-нибудь интересное в Москве на майские праздники '.repeat(20),
      },
      { role: 'assistant', content: 'Ещё одно длинное сообщение '.repeat(40) },
      { role: 'user', content: 'Уточнить дату' },
      { role: 'assistant', content: 'Какую дату рассматриваем?' },
      { role: 'user', content: 'Любая' },
      { role: 'assistant', content: 'Могу поискать на любую дату, какой жанр предпочитаете?' },
    ];

    const messages = compressHistoryIfNeeded(
      'Системный промпт '.repeat(80),
      history,
      'Покажи варианты',
      2500
    );
    const contents = messages.map((msg) => msg.content);

    expect(contents.some((content) => content.includes('Уточнить дату'))).toBe(true);
    expect(contents.some((content) => content.includes('Любая'))).toBe(true);
  });

  test('adds assistant buttons into compact history context', () => {
    const compact = attachAssistantButtonsToContent('Подходящих вариантов не нашлось.', {
      buttons: ['Уточнить дату', 'Уточнить категорию', 'Уточнить дату'],
    });

    expect(compact).toContain('Кнопки: Уточнить дату | Уточнить категорию');
  });

  test('preserves both beginning and end when truncating long history content', () => {
    const truncated = truncateHistoryContent(
      'Начало сообщения. ' + 'середина '.repeat(80) + 'Финальный вопрос про дату и жанр?',
      120
    );

    expect(truncated).toContain('Начало сообщения.');
    expect(truncated).toContain('Финальный вопрос про дату и жанр?');
    expect(truncated).toContain('...[truncated]');
  });

  test('trimHistoryMessages keeps button context for recent assistant message', () => {
    const trimmed = trimHistoryMessages([
      {
        role: 'assistant',
        content: 'Подтверждаю параметры поиска.',
        metadata: { buttons: ['Концерты', 'Театры'] },
      },
      { role: 'user', content: 'Концерты' },
    ]);

    expect(trimmed[0].content).toContain('Кнопки: Концерты | Театры');
  });

  test('does not over-compress history when default selection already fits token budget', () => {
    const history = [
      {
        role: 'user',
        content:
          'Ищу спокойный театр в Москве на выходные с бюджетом до 3000 рублей и без слишком позднего начала.',
      },
      {
        role: 'assistant',
        content: 'Понял запрос и учёл ограничения.',
        metadata: { buttons: ['Театры', 'Выставки'] },
      },
      {
        role: 'user',
        content: 'Важно, чтобы было удобно добраться и без 18+.',
      },
    ];

    const messages = compressHistoryIfNeeded(
      'Системный промпт для обычного сценария.',
      history,
      'Покажи варианты',
      4000
    );

    expect(messages).toHaveLength(5);
    expect(messages[1].content).toContain('спокойный театр в Москве на выходные');
    expect(messages[2].content).toContain('Кнопки: Театры | Выставки');
    expect(messages[3].content).toContain('удобно добраться и без 18+');
    expect(estimateMessagesTokens(messages)).toBeLessThanOrEqual(4000);
  });

  test('keeps full history when all messages fit token budget even above max history count', () => {
    const history = Array.from({ length: 13 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `Короткое сообщение ${index + 1} про дату, жанр и город.`,
    }));

    const messages = compressHistoryIfNeeded(
      'Короткий системный промпт.',
      history,
      'Покажи подходящие варианты',
      4000
    );

    expect(messages).toHaveLength(15);
    expect(messages[1].content).toContain('Короткое сообщение 1');
    expect(messages[13].content).toContain('Короткое сообщение 13');
    expect(estimateMessagesTokens(messages)).toBeLessThanOrEqual(4000);
  });
});
