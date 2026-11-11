import {
  buildTechnicalRedirectResponse,
  isSafeTechnicalRedirectText,
  isTechnicalMetaQuestion,
} from './technicalQuestionService.js';

describe('technicalQuestionService', () => {
  beforeAll(() => {
    process.env.DETERMINISTIC_TECH_REDIRECT = '1';
  });

  test('detects technical meta questions', () => {
    expect(isTechnicalMetaQuestion('На каком языке ты написан?')).toBe(true);
    expect(isTechnicalMetaQuestion('Я спрашиваю про язык программирования')).toBe(true);
    expect(isTechnicalMetaQuestion('На каком коде ты написан?')).toBe(true);
    expect(isTechnicalMetaQuestion('На чем вы написаны?')).toBe(true);
    expect(isTechnicalMetaQuestion('Какой у вас стек?')).toBe(true);
    expect(isTechnicalMetaQuestion('Какая у вас модель?')).toBe(true);
  });

  test('does not trigger on event language questions', () => {
    expect(isTechnicalMetaQuestion('На каком языке идет спектакль?')).toBe(false);
    expect(isTechnicalMetaQuestion('Есть ли фильм на английском языке с субтитрами?')).toBe(false);
  });

  test('builds a redirect response with buttons', () => {
    const response = buildTechnicalRedirectResponse({
      userId: 'u1',
      sessionId: 's1',
      userMessage: 'На каком языке ты написан?',
    });
    expect(response).toEqual({
      message: expect.any(String),
      buttons: ['Концерты', 'Театры', 'Выставки', 'Покажи все'],
      offer: null,
    });
    expect(response.message).toMatch(
      /^(С устройством ассистента я не помогаю|Технические детали моей работы я не обсуждаю|На такие технические вопросы я не отвечаю|Подробности устройства я не раскрываю|Этот технический вопрос оставлю без деталей|Внутреннюю сторону работы я не обсуждаю|Такие детали я не раскрываю|О технической стороне здесь не рассказываю)/u
    );
    expect(response.message).not.toContain(':');
    expect(response.message.split(/\n\s*\n/u).filter(Boolean).length).toBeGreaterThanOrEqual(2);
    expect(response.message.split(/\n\s*\n/u).filter(Boolean).length).toBeLessThanOrEqual(3);
    expect(response.message).toMatch(/машинного\s+обучения|технологи[ия]\s+ии|ии-ассистент/iu);
    expect(response.message).toMatch(/\?/u);
  });

  test('picks redirect message deterministically', () => {
    const first = buildTechnicalRedirectResponse({
      userId: 'u1',
      sessionId: 's1',
      userMessage: 'На каком языке ты написан?',
    });
    const second = buildTechnicalRedirectResponse({
      userId: 'u1',
      sessionId: 's1',
      userMessage: 'На каком языке ты написан?',
    });
    expect(first.message).toBe(second.message);
  });

  test('rejects awkward redirect phrasing from logs', () => {
    expect(
      isSafeTechnicalRedirectText(
        'Технологии машинного обучения помогают мне понимать ваши предпочтения и предлагать подходящие мероприятия. Давайте сразу начнем поиск по интересующему вас направлению?'
      )
    ).toBe(false);
  });

  test('rejects feminine self-reference in redirect text', () => {
    expect(
      isSafeTechnicalRedirectText(
        'Поняла ваш вопрос и готова сразу перейти к подбору мероприятий. Что вам сейчас интересно?'
      )
    ).toBe(false);
  });

  test('requires explicit refusal before technical redirect', () => {
    expect(
      isSafeTechnicalRedirectText(
        'Если хотите, сразу начнём подбирать мероприятия по вашему интересу? Например, концерты или театры?'
      )
    ).toBe(false);

    expect(
      isSafeTechnicalRedirectText(
        'С таким вопросом я не помогу: внутренние технические детали не обсуждаю. Я работаю как ИИ-ассистент и помогаю подбирать мероприятия, которые могут вам подойти. Что вам сейчас ближе: концерты, театры или выставки?'
      )
    ).toBe(false);

    expect(
      isSafeTechnicalRedirectText(
        'С таким вопросом я не помогу, внутренние технические детали не обсуждаю. Я работаю как ИИ-ассистент и помогаю подбирать мероприятия, которые могут вам подойти. Что вам сейчас ближе, концерты, театры или выставки?'
      )
    ).toBe(false);

    expect(
      isSafeTechnicalRedirectText(
        'Технические детали моей работы я не обсуждаю, но могу помочь с выбором события. Я работаю как ИИ-ассистент и помогаю подбирать мероприятия, которые могут вам подойти.\n\nЧто вам сейчас ближе, концерты, театры или выставки?'
      )
    ).toBe(true);
  });

  test('rejects technical redirects with too many paragraphs', () => {
    expect(
      isSafeTechnicalRedirectText(
        [
          'О технической стороне здесь не рассказываю, зато помогу выбрать мероприятие.',
          'Мне помогают технологии ИИ, чтобы быстро улавливать ваши интересы и предлагать события по афише.',
          'Сразу могу предложить варианты по вашим интересам.',
          'Что вам сейчас ближе, концерты, театры или выставки?',
        ].join('\n\n')
      )
    ).toBe(false);
  });
});
