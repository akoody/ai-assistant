import { pickVariant } from '../textUtils.js';
import { requestAssistantMessage } from '../gatewayClient.js';
import { getAssistantIdentityPrompt } from '../../configService.js';
import { TECHNICAL_REDIRECT_BUTTONS } from '../../technicalQuestionService.js';
import { getMessageHistory } from '../../messagesStorage.js';
import { getCollection } from '../../database.js';
import {
  buildAssistantIdentityFallbackResponse,
  isSafeAssistantIdentityText,
} from '../../assistantIdentityService.js';

async function buildAssistantIdentityResponseViaLlm({ userId, sessionId, userMessage, requestId }) {
  const seed = `${userId}|${sessionId}|${requestId || ''}|${userMessage}|${Date.now()}|assistant_identity`;
  let systemPrompt = String(getAssistantIdentityPrompt() || '').trim();
  if (!systemPrompt) {
    return buildAssistantIdentityFallbackResponse({ seed });
  }

  let lastAssistantText = '';
  let recentAssistantTexts = [];
  try {
    const recentHistory = await getMessageHistory(userId, sessionId, 8);
    const currentSessionAssistantTexts = [...recentHistory]
      .reverse()
      .filter((item) => item?.role === 'assistant' && item?.content)
      .map((item) =>
        String(item.content || '')
          .replace(/\s+/g, ' ')
          .trim()
      )
      .filter(Boolean);

    let crossSessionAssistantTexts = [];
    try {
      const collection = await getCollection('messages');
      const crossSessionMessages = await collection
        .find({ userId, role: 'assistant', sessionId: { $ne: sessionId } })
        .sort({ createdAt: -1 })
        .limit(4)
        .toArray();

      crossSessionAssistantTexts = crossSessionMessages
        .map((item) =>
          String(item?.message || '')
            .replace(/\s+/g, ' ')
            .trim()
        )
        .filter(Boolean);
    } catch (crossSessionHistoryError) {
      console.warn(
        `⚠️ [${userId}][${sessionId}] ASSISTANT_IDENTITY: не удалось загрузить межсессионную историю для антидубля`,
        crossSessionHistoryError
      );
    }

    recentAssistantTexts = [...currentSessionAssistantTexts, ...crossSessionAssistantTexts]
      .filter((text, index, list) => text && list.indexOf(text) === index)
      .slice(0, 4);
    lastAssistantText = String(recentAssistantTexts[0] || '').trim();
  } catch (historyError) {
    console.warn(
      `⚠️ [${userId}][${sessionId}] ASSISTANT_IDENTITY: не удалось загрузить историю для антидубля`,
      historyError
    );
  }

  const styleInstruction = pickVariant(
    [
      'Постройте реплику как живой ответ в чате: сначала кто отвечает, затем отдельное предложение о пользе помощника, затем один вопрос.',
      'Соберите ответ ровно из трёх коротких предложений, но не используйте каркас "Я виртуальный помощник. Помогаю выбрать. С чего начать".',
      'После самопредставления отдельным утверждением объясните, что помогаете подобрать события или сузить афишу, не повторяя общую формулу про настроение и желание куда-то выбраться.',
      'Ответьте честно на вопрос о личности и мягко переведите к выбору афиши через новый ориентир, без слов "подбор" и "мероприятия" рядом.',
      'Сделайте ответ теплее интерфейсного: первая фраза про виртуального помощника, вторая про то, чем он помогает, третья про ближайший ориентир.',
    ],
    `${seed}|identityStyle`
  );
  const questionInstruction = pickVariant(
    [
      'Финальный вопрос должен быть один: "От чего оттолкнёмся?".',
      'Финальный вопрос должен быть один: "Что взять за ориентир?".',
      'Финальный вопрос должен быть один: "Какой формат вам ближе?".',
      'Финальный вопрос должен быть один: "С чего начнём?".',
    ],
    `${seed}|identityQuestion`
  );
  const identityFrame = pickVariant(
    [
      'Первое предложение: "В чате с вами виртуальный помощник Kassir.ru."',
      'Первое предложение: "Я виртуальный помощник Kassir.ru по афише и билетам."',
      'Первое предложение: "Это виртуальный помощник Kassir.ru по мероприятиям."',
      'Первое предложение: "С вами виртуальный помощник Kassir.ru."',
    ],
    `${seed}|identityFrame`
  );
  const responseRoute = pickVariant(
    [
      'Маршрут ответа: через формат досуга. Второе предложение начните со слова "Помогаю" и скажите, что подбираете события по формату вечера или типу отдыха.',
      'Маршрут ответа: через жанр. Второе предложение начните со слова "Помогаю" и скажите, что можно оттолкнуться от жанра или направления афиши.',
      'Маршрут ответа: через настроение. Второе предложение начните со слова "Помогаю" и скажите, что подбираете события под настроение или повод.',
      'Маршрут ответа: через широкий выбор афиши. Второе предложение начните со слова "Помогаю" и скажите, что сузите широкий выбор до понятного ориентира.',
      'Маршрут ответа: через общий запрос. Второе предложение начните со слова "Помогаю" и скажите, что превращаете общее желание выбраться в понятный выбор по афише.',
    ],
    `${seed}|identityRoute`
  );

  systemPrompt +=
    '\n\nДополнительная установка на этот ответ:\n' +
    `- ${styleInstruction}\n` +
    `- ${questionInstruction}\n` +
    `- ${identityFrame}\n` +
    `- ${responseRoute}\n` +
    '- Ответ формата "Я виртуальный помощник Kassir.ru. <вопрос>" запрещён как слишком сухой: между ними должна быть отдельная содержательная фраза.\n' +
    '- Второе предложение обязательно должно быть НЕ вопросом, а утверждением о пользе: "Помогаю подобрать события...", "Помогаю сузить афишу...", "Помогаю выбрать формат..." или близко по смыслу.\n' +
    '- Второе предложение не должно начинаться с "Вы можете", "Можно", "Поиск можно" или звучать как инструкция пользователю. Оно должно быть про действие помощника.\n' +
    '- Нельзя объединять пользу и вопрос в одно предложение вроде "Можно уточнить ваше настроение или формат отдыха, чтобы подобрать что-то интересное?".\n' +
    '- Не используйте шаблон "Я виртуальный помощник Kassir.ru. Помогаю выбрать мероприятия по вашему настроению или желанию куда-то выбраться. С чего вам удобнее начать подбор?".\n' +
    '- Не начинайте ответ с "Да, я". На вопрос о том, кто отвечает, спокойно обозначьте роль без прямого подтверждения слова пользователя.\n' +
    '- Не используйте неестественные фразы "Отвечаю как", "даже если вы просто хотели", "есть множество вариантов", "что важно вам".\n' +
    '- Не используйте заезженную связку "по вашему настроению или желанию куда-то выбраться" и близкие варианты с тем же ритмом.\n' +
    '- Не используйте подряд слова "помогаю выбрать мероприятия", "по вашему настроению", "желанию куда-то выбраться", "с чего вам удобнее начать подбор" в одном ответе.\n' +
    '- Средняя фраза не должна быть служебной или пустой. Запрещены каркасы вроде "чем могу быть полезен", "могу сориентировать по афише", "подберу варианты под ваши интересы".\n' +
    '- Не выдумывайте внешний контекст: нельзя писать про внешние обстоятельства, прогулку, друзей, встречу, компанию или планы пользователя как про установленный факт.\n' +
    '- Если пользователь спросил только кто вы, используйте мягкие ориентиры: формат, жанр, настроение, повод или желание куда-то выбраться. Не переводите такой ответ в фильтры по дате, бюджету или времени.\n' +
    '- Не используйте фразы "поиск можно сузить по дате или бюджету", "с какого фильтра начать", "удобное время" в ответе на вопрос о том, кто вы.\n' +
    '- Не спрашивайте "Какое настроение вам больше подходит?" и не пишите "Вы можете выбрать более спокойный или яркий вариант мероприятия". Это звучит неестественно.\n' +
    '- Не используйте финалы "С какого направления начнём?" и тем более грамматически неверное "С какое направления начнём?". Лучше "С чего начнём?" или "От чего оттолкнёмся?".\n' +
    '- Не используйте заезженные связки: "готов помочь", "готов помогать", "специализируюсь на подборе", "подбирать мероприятия по вкусу".\n' +
    '- Не повторяйте каркас из прошлых ответов; меняйте самопредставление, маршрут средней фразы и финальный вопрос. Вариативность должна быть смысловой, а не заменой пары слов.\n' +
    (recentAssistantTexts.length > 0
      ? `- Недавние реплики ассистента этому пользователю: ${recentAssistantTexts.map((text) => `"${text.slice(0, 180)}"`).join('; ')}. Не повторяйте их начало, среднюю фразу, финальный вопрос, ритм и устойчивые словосочетания.\n`
      : '');

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: String(userMessage || '').trim() || 'Вы человек?' },
  ];

  try {
    const normalized = await requestAssistantMessage(
      messages,
      userId,
      sessionId,
      'assistant_identity',
      1,
      0.95,
      requestId,
      260,
      { noCache: true }
    );

    const text = String(normalized?.text || '').trim();
    if (normalized?.parsedFromJson && text && isSafeAssistantIdentityText(text)) {
      return {
        message: text,
        buttons: [...TECHNICAL_REDIRECT_BUTTONS],
        offer: null,
      };
    }

    console.warn(
      `⚠️ [${userId}][${sessionId}] ASSISTANT_IDENTITY: ответ LLM не прошёл safety-проверку, прошу LLM переписать`
    );

    const repairPrompt =
      'Перепишите весь ответ заново как финальную реплику пользователю. Не дописывайте вопрос к старому тексту и не сохраняйте его среднюю фразу. ' +
      'Сохраните смысл: вы виртуальный помощник Kassir.ru по афише и билетам. ' +
      'Нужны ровно три коротких предложения: самопредставление, содержательная средняя фраза, один финальный вопрос. ' +
      'Во втором предложении не используйте служебные формулы вроде "чем могу быть полезен", "сориентирую по афише", "варианты под ваши интересы". ' +
      'Не стройте вычурных или неестественных фраз вроде "свободного времени много, а выбор велик". Говорите максимально просто, по-живому и логично. ' +
      'Не придумывайте внешние обстоятельства, прогулку, друзей, встречу, компанию, планы пользователя или другие факты вне сообщения пользователя. ' +
      'Если пользователь спросил только кто вы, используйте нейтральные ориентиры: формат, жанр, настроение, повод, дату, бюджет или желание куда-то выбраться. ' +
      'Не используйте фразы "готов помочь", "готов помогать", "специализируюсь на подборе", "подбирать мероприятия по вкусу". ' +
      'Проверьте грамматику: нельзя писать "который помогаю", "можно начать от", "какой вам подходит первый" и похожие ломаные фразы. ' +
      'Нельзя писать "для встречи с друзьями", "для вас или ваших друзей", "планы с друзьями", если пользователь сам не говорил про друзей или компанию. ' +
      (recentAssistantTexts.length > 0
        ? `Не повторяйте недавние реплики: ${recentAssistantTexts.map((item) => `"${item.slice(0, 140)}"`).join('; ')}. `
        : '') +
      'Не перечисляйте категории из кнопок в тексте и не заканчивайте слишком пустым вопросом вроде "Что хочется посмотреть?". Верните строго JSON того же формата.';

    let repaired = null;
    try {
      repaired = await requestAssistantMessage(
        [
          ...messages,
          { role: 'assistant', content: JSON.stringify({ text }) },
          { role: 'user', content: repairPrompt },
        ],
        userId,
        sessionId,
        'assistant_identity_repair',
        1,
        0.75,
        requestId,
        260,
        { noCache: true }
      );
    } catch (repairError) {
      if (normalized?.parsedFromJson && text && isSafeAssistantIdentityText(text)) {
        console.warn(
          `⚠️ [${userId}][${sessionId}] ASSISTANT_IDENTITY: LLM-полировка не выполнилась, возвращаю исходный безопасный LLM-ответ`,
          repairError
        );
        return {
          message: text,
          buttons: [...TECHNICAL_REDIRECT_BUTTONS],
          offer: null,
        };
      }
      throw repairError;
    }

    const repairedText = String(repaired?.text || '').trim();
    if (repaired?.parsedFromJson && repairedText && isSafeAssistantIdentityText(repairedText)) {
      return {
        message: repairedText,
        buttons: [...TECHNICAL_REDIRECT_BUTTONS],
        offer: null,
      };
    }

    if (normalized?.parsedFromJson && text && isSafeAssistantIdentityText(text)) {
      console.warn(
        `⚠️ [${userId}][${sessionId}] ASSISTANT_IDENTITY: LLM-полировка не прошла safety-проверку, возвращаю исходный безопасный LLM-ответ`
      );
      return {
        message: text,
        buttons: [...TECHNICAL_REDIRECT_BUTTONS],
        offer: null,
      };
    }

    return buildAssistantIdentityFallbackResponse({ seed, excludeText: lastAssistantText || text });
  } catch (error) {
    console.warn(
      `⚠️ [${userId}][${sessionId}] ASSISTANT_IDENTITY: ошибка при генерации через LLM, использую шаблон`,
      error
    );
    return buildAssistantIdentityFallbackResponse({ seed, excludeText: lastAssistantText });
  }
}

export { buildAssistantIdentityResponseViaLlm };
