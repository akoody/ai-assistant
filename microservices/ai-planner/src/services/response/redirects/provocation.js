import { hashToIndex } from '../textUtils.js';
import { requestAssistantMessage } from '../gatewayClient.js';
import { getProvocationRedirectPrompt } from '../../configService.js';
import {
  buildProvocationRedirectResponse,
  isSafeProvocationRedirectText,
} from '../../provocationService.js';

async function buildProvocationRedirectResponseViaLlm({
  userId,
  sessionId,
  userMessage,
  requestId,
  scenario = 'generic',
  criticismProfile = null,
}) {
  const provocationButtons = ['Концерты', 'Театры', 'Выставки', 'Музеи', 'Покажи все'];

  const prompt = getProvocationRedirectPrompt();
  let systemPrompt = String(prompt || '').trim();
  if (!systemPrompt) {
    return buildProvocationRedirectResponse({
      userId,
      sessionId,
      userMessage,
      scenario,
      criticismProfile,
    });
  }

  try {
    const styleSeed = `${userId}|${sessionId}|${requestId || ''}|${userMessage}|${Date.now()}|provocation`;
    const styleVariants = [
      {
        label: 'короткий живой',
        instruction:
          'Дайте короткую плотную реплику без тяжёлых вводных. Звучите собранно и естественно.',
      },
      {
        label: 'спокойный разговорный',
        instruction:
          'Говорите мягко и по-человечески, без пафоса, без штампов и без рекламного блеска.',
      },
      {
        label: 'быстрый уверенный',
        instruction:
          'Переходите к делу быстрее, меньше служебных слов, больше ощущения живого диалога.',
      },
      {
        label: 'деликатный куратор',
        instruction:
          'Звучите как внимательный культурный помощник, который умеет признать промах и сразу двигается дальше.',
      },
    ];
    const primaryStyle =
      styleVariants[hashToIndex(`${styleSeed}|primary`, styleVariants.length)] || styleVariants[0];
    const repairStyle =
      styleVariants[hashToIndex(`${styleSeed}|repair`, styleVariants.length)] || styleVariants[1];

    systemPrompt +=
      '\n\nДополнительная установка на этот ответ:\n' +
      `- Стиль подачи: ${primaryStyle.label}. ${primaryStyle.instruction}\n` +
      '- Тон всегда уважительный, спокойный и доброжелательный. Не зеркаль агрессию, не язви, не пристыжай и не отвечай свысока.\n' +
      '- Избегайте повторяющегося каркаса и заученных словосочетаний.\n' +
      '- Не используйте слова и формулы: "реабилитироваться", "не попал в ожидания", "что-то действительно стоящее", "впечатление у вас так себе".\n' +
      '- По возможности не употребляйте слово "сейчас", если без него фраза звучит чище.\n';

    if (scenario === 'assistant_criticism') {
      const normalizedCriticismType = String(criticismProfile?.criticismType || 'generic').trim();
      const normalizedIntensity = String(criticismProfile?.intensity || 'medium').trim();
      const normalizedReplyStyleHint = String(criticismProfile?.replyStyleHint || 'neutral').trim();
      systemPrompt +=
        '- Это критика ассистента в целом, а НЕ жалоба на конкретный ранее показанный вариант.\n' +
        '- НЕ пиши так, будто уже был показан конкретный вариант или подборка.\n' +
        '- Запрещены формулы вроде: "этот вариант не подошел", "предыдущая подборка", "прошлый подбор", "этот подбор", "снова подберу".\n' +
        '- Лучше признавай общий промах без ссылки на конкретную прошлую выдачу.\n' +
        '- НЕ додумывай причину критики. Если пользователь не назвал тон, стиль, доверие или пользу, не приписывай ему эти причины сам.\n' +
        `- Профиль критики: criticismType="${normalizedCriticismType}", intensity="${normalizedIntensity}", replyStyleHint="${normalizedReplyStyleHint}".\n`;

      if (normalizedCriticismType === 'tone_style') {
        systemPrompt +=
          '- Пользователю не зашел именно тон, стиль, подача или общая манера общения.\n' +
          '- Ответь так, чтобы было ясно: ты понял претензию к тону, убираешь лишние слова и переходишь к делу.\n';
      } else if (normalizedCriticismType === 'competence') {
        systemPrompt +=
          '- Пользователь сомневается в полезности и точности ассистента.\n' +
          '- Ответь так, чтобы было ясно: ты услышал претензию к качеству помощи и теперь будешь конкретнее и прямее.\n';
      } else if (normalizedCriticismType === 'trust') {
        systemPrompt +=
          '- Пользователь не доверяет ассистенту или не верит, что от него будет польза.\n' +
          '- Не уговаривай. Спокойно покажи, что понял скепсис, и без давления перейди к делу.\n';
      } else if (normalizedCriticismType === 'hostility') {
        systemPrompt +=
          '- Пользователь пишет резко или агрессивно.\n' +
          '- Не зеркаль агрессию, не морализируй и не становись холодным канцелярским. Нужен короткий спокойный деэскалирующий ответ.\n';
      } else {
        systemPrompt +=
          '- Причина недовольства не названа прямо.\n' +
          '- Не сужай смысл до тона, стиля, недоверия или претензии к пользе. Ответь более общо и по-человечески.\n';
      }
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: String(userMessage || '').trim() || 'Критика ассистента.' },
    ];

    const MAX_ATTEMPTS = 3;
    let currentMessages = messages;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const normalized = await requestAssistantMessage(
        currentMessages,
        userId,
        sessionId,
        'provocation_redirect',
        attempt,
        attempt === 1 ? 0.75 : 0.45,
        requestId,
        220
      );

      const text = String(normalized?.text || '').trim();
      if (
        normalized?.parsedFromJson &&
        text &&
        isSafeProvocationRedirectText(text, { scenario, criticismProfile })
      ) {
        return {
          message: text,
          buttons: [...provocationButtons],
          offer: null,
        };
      }

      if (attempt < MAX_ATTEMPTS) {
        const badJson = JSON.stringify({ text, buttons: [] });
        const correctionInstruction =
          'Перепишите ответ заново грамотным живым русским языком. ' +
          `Используйте ДРУГОЙ стиль подачи: ${repairStyle.label}. ${repairStyle.instruction} ` +
          'Нужен короткий ответ с мягким разворотом к подбору мероприятий и вопросом по категории. ' +
          'Сохраняйте уважительный и доброжелательный тон, без раздражения, язвительности и высокомерия. ' +
          (scenario === 'assistant_criticism'
            ? 'Не изображайте, будто до этого уже был показан конкретный вариант или подборка. Ответ должен точно отражать тип критики пользователя, а не общий абстрактный негатив. '
            : '') +
          'Верните строго JSON того же формата.';

        currentMessages = [
          ...currentMessages,
          { role: 'assistant', content: badJson },
          { role: 'user', content: correctionInstruction },
        ];
      }
    }

    console.warn(
      `⚠️ [${userId}][${sessionId}] PROVOCATION_REDIRECT: ответы LLM не прошли проверку, использую шаблон`
    );
    return buildProvocationRedirectResponse({
      userId,
      sessionId,
      userMessage,
      scenario,
      criticismProfile,
    });
  } catch (error) {
    console.warn(
      `⚠️ [${userId}][${sessionId}] PROVOCATION_REDIRECT: ошибка при генерации через LLM, использую шаблон`,
      error
    );
    return buildProvocationRedirectResponse({
      userId,
      sessionId,
      userMessage,
      scenario,
      criticismProfile,
    });
  }
}

export { buildProvocationRedirectResponseViaLlm };
