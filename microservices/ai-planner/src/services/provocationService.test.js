import {
  ASSISTANT_CRITICISM_RESPONSE_VARIANTS,
  buildProvocationRedirectResponse,
  isAssistantDirectedCriticism,
  isProvocationOrInsult,
  isSafeProvocationRedirectText,
  resolveAssistantCriticismProfile,
} from './provocationService.js';

describe('provocationService', () => {
  test('detects provocation/insult aimed at assistant', () => {
    expect(isProvocationOrInsult('ты тупой бот')).toBe(true);
    expect(isProvocationOrInsult('вы идиот')).toBe(true);
    expect(isProvocationOrInsult('я тебя ненавижу')).toBe(true);
    expect(isProvocationOrInsult('Ты подбираешь какую-то фигню')).toBe(true);
  });

  test('does not trigger on health complaint keywords', () => {
    expect(isProvocationOrInsult('мне плохо и тревожно')).toBe(false);
    expect(isProvocationOrInsult('не хочу жить')).toBe(false);
  });

  test('detects direct criticism aimed at assistant without explicit insult', () => {
    expect(isAssistantDirectedCriticism('Ты мне не нравишься')).toBe(true);
    expect(isAssistantDirectedCriticism('Мне не нравится твой тон')).toBe(true);
    expect(isAssistantDirectedCriticism('Мне не нравятся рок концерты')).toBe(false);
  });

  test('treats "ты мне надоел" as hostility toward assistant', () => {
    expect(isProvocationOrInsult('Ты мне надоел')).toBe(true);
    expect(resolveAssistantCriticismProfile(null, 'Ты мне надоел')).toMatchObject({
      criticismType: 'hostility',
      intensity: 'high',
      replyStyleHint: 'deescalating',
    });
  });

  test('builds a generic redirect response with buttons', () => {
    const response = buildProvocationRedirectResponse({
      userId: 'u1',
      sessionId: 's1',
      userMessage: 'ты тупой бот',
    });
    expect(response).toEqual({
      message:
        'Вижу, что мой ответ вас не убедил. Я как раз учусь на таких репликах и могу быстро сменить подход, чтобы попасть точнее. Какую категорию мероприятий смотрим: концерты, театры, выставки или музеи?',
      buttons: ['Концерты', 'Театры', 'Выставки', 'Музеи', 'Покажи все'],
      offer: null,
    });
    expect(response.message).toMatch(/\?/u);
  });

  test('builds a dedicated redirect for assistant criticism', () => {
    const response = buildProvocationRedirectResponse({
      userId: 'u1',
      sessionId: 's1',
      userMessage: 'Ты мне не нравишься',
      scenario: 'assistant_criticism',
    });

    expect(ASSISTANT_CRITICISM_RESPONSE_VARIANTS.generic).toContain(response.message);
    expect(response.buttons).toEqual(['Концерты', 'Театры', 'Выставки', 'Музеи', 'Покажи все']);
    expect(response.offer).toBeNull();
    expect(response.message).toMatch(/\?/u);
  });

  test('builds profile-aware criticism fallback', () => {
    expect(resolveAssistantCriticismProfile(null, 'Ты мне не нравишься')).toMatchObject({
      criticismType: 'generic',
      intensity: 'low',
      replyStyleHint: 'neutral',
    });

    expect(
      resolveAssistantCriticismProfile(
        { criticismType: 'tone_style', intensity: 'low', replyStyleHint: 'calmer' },
        'Ты мне не нравишься'
      )
    ).toMatchObject({
      criticismType: 'generic',
      intensity: 'low',
      replyStyleHint: 'neutral',
    });

    expect(resolveAssistantCriticismProfile(null, 'Мне не нравится твой тон')).toMatchObject({
      criticismType: 'tone_style',
      intensity: 'low',
      replyStyleHint: 'calmer',
    });

    const response = buildProvocationRedirectResponse({
      userId: 'u1',
      sessionId: 's1',
      userMessage: 'Мне не нравится твой тон',
      scenario: 'assistant_criticism',
      criticismProfile: {
        criticismType: 'tone_style',
        intensity: 'low',
        replyStyleHint: 'calmer',
      },
    });

    expect(ASSISTANT_CRITICISM_RESPONSE_VARIANTS.tone_style).toContain(response.message);
    expect(response.buttons).toEqual(['Концерты', 'Театры', 'Выставки', 'Музеи', 'Покажи все']);
    expect(response.offer).toBeNull();
  });

  test('every built-in criticism reply passes the redirect safety check for its profile', () => {
    for (const [criticismType, variants] of Object.entries(ASSISTANT_CRITICISM_RESPONSE_VARIANTS)) {
      for (const variant of variants) {
        expect({
          criticismType,
          variant,
          safe: isSafeProvocationRedirectText(variant, {
            scenario: 'assistant_criticism',
            criticismProfile: { criticismType, intensity: 'low', replyStyleHint: 'neutral' },
          }),
        }).toEqual({ criticismType, variant, safe: true });
      }
    }
  });

  test('rejects assistant criticism replies that reframe it as disliked selection', () => {
    expect(
      isSafeProvocationRedirectText(
        'Вижу, что я еще учусь быть полезным. Давайте попробуем сразу найти то, что вам понравится. Что вас интересует: концерты, театры, выставки или музеи?',
        { scenario: 'assistant_criticism' }
      )
    ).toBe(false);

    expect(
      isSafeProvocationRedirectText(
        'Вижу, что есть место для улучшения. Давайте быстро сменю траекторию и найду вариант получше. Какая категория вам ближе: концерты, театры, выставки или музеи?',
        { scenario: 'assistant_criticism' }
      )
    ).toBe(false);

    expect(
      isSafeProvocationRedirectText(
        'Понял. Значит, проблема в том, как я веду диалог. Уберу лишние слова и перейду прямо к делу. Какая категория вам ближе: концерты, театры, выставки или музеи?',
        {
          scenario: 'assistant_criticism',
          criticismProfile: {
            criticismType: 'tone_style',
            intensity: 'low',
            replyStyleHint: 'calmer',
          },
        }
      )
    ).toBe(false);

    expect(
      isSafeProvocationRedirectText(
        'Извините, если не зашел мой тон. Буду говорить спокойнее и яснее. Какая категория вам ближе: концерты, театры, выставки или музеи?',
        {
          scenario: 'assistant_criticism',
          criticismProfile: {
            criticismType: 'tone_style',
            intensity: 'low',
            replyStyleHint: 'calmer',
          },
        }
      )
    ).toBe(true);

    expect(
      isSafeProvocationRedirectText(
        'Простите, если разговор вышел мимо. Давайте без лишней перепалки просто выберем направление. Что вам ближе?',
        {
          scenario: 'assistant_criticism',
          criticismProfile: {
            criticismType: 'generic',
            intensity: 'low',
            replyStyleHint: 'neutral',
          },
        }
      )
    ).toBe(true);

    expect(
      isSafeProvocationRedirectText(
        'Простите, если подача вышла мимо. Сделаю разговор спокойнее и короче. С чего начнем?',
        {
          scenario: 'assistant_criticism',
          criticismProfile: {
            criticismType: 'tone_style',
            intensity: 'low',
            replyStyleHint: 'calmer',
          },
        }
      )
    ).toBe(true);
  });
});
