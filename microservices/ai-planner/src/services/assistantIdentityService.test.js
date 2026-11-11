import {
  buildAssistantIdentityFallbackResponse,
  isAssistantIdentityQuestion,
  isSafeAssistantIdentityText,
} from './assistantIdentityService.js';

function countSentences(text = '') {
  return (
    String(text || '')
      .replace(/Kassir\.ru/g, 'Kassir')
      .match(/[^.!?]+[.!?]/gu)?.length || 0
  );
}

describe('assistantIdentityService', () => {
  test('detects identity questions despite spacing around punctuation', () => {
    expect(isAssistantIdentityQuestion('Ты человек ?')).toBe(true);
    expect(isAssistantIdentityQuestion('Вы бот ?')).toBe(true);
    expect(isAssistantIdentityQuestion('Ты человек???')).toBe(true);
    expect(isAssistantIdentityQuestion('Я с ботом говорю?')).toBe(true);
  });

  test('assistant identity fallback is not the old dry response', () => {
    const originalRandom = Math.random;
    const messages = [];

    try {
      for (let index = 0; index < 10; index += 1) {
        Math.random = () => (index + 0.01) / 10;
        messages.push(buildAssistantIdentityFallbackResponse({ seed: '' }).message);
      }
    } finally {
      Math.random = originalRandom;
    }

    expect(new Set(messages).size).toBe(10);

    messages.forEach((message) => {
      expect(isSafeAssistantIdentityText(message)).toBe(true);
      expect(countSentences(message)).toBe(3);
      expect(message).toMatch(/виртуальный|цифровой/u);
      expect(message).not.toMatch(
        /Я помощник Kassir\.ru в чате|От чего оттолкн[её]мся|подходящие варианты/u
      );
      expect(message).not.toMatch(/чем могу быть полезен|сориентирую по афише|под ваши интересы/u);
      expect(message).not.toMatch(/друз|встреч|компан/u);
    });
  });
});
