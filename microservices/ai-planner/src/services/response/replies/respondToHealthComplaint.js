import { getMessageHistory } from '../../messagesStorage.js';
import { buildSystemPrompt } from '../../llm/promptBuilder.js';
import { buildMessages } from '../../llm/messageBuilder.js';
import { updateStatus } from '../../statusService.js';
import { requestAssistantMessage } from '../gatewayClient.js';
import { stripJsonArtifacts } from '../../llm/assistantResponseUtils.js';
import { containsChineseCharacters } from '../../llm/assistantResponseUtils.js';
import { isSafeHealthComplaintText } from '../moodHealth.js';
import { finalizeHealthComplaintText } from '../moodHealth.js';
import { getRecentAssistantTexts } from '../moodHealth.js';
import { sanitizeHealthComplaintButtons } from '../moodHealth.js';

export async function respondToHealthComplaint({
  userId,
  sessionId,
  offerEvents,
  noResultsDetected,
  allRequiredCollected,
  needsClarification,
  shouldSkipOfferGeneration,
  healthComplaintIntent,
  userMessage,
  requestId,
}) {
  console.log(
    `🏥 [${userId}][${sessionId}] Обработка жалобы на здоровье - пропускаю обработку слотов и генерацию предложений`
  );

  // Получаем историю сообщений
  const history = await getMessageHistory(userId, sessionId);
  const isFirstMessage = !history.some((msg) => msg.role === 'assistant');

  // Используем специальный промпт для жалоб на здоровье
  // КРИТИЧЕСКИ ВАЖНО: Определяем, есть ли реальные события для показа.
  // Если offerEvents пустой (но не null), это значит поиск вернул 0 результатов.
  // Если при этом мы не добавили старые события (shouldAddPreviousEvents=false),
  // то noResultsDetected должен быть true, чтобы LLM ответила "ничего не найдено".
  // НО! Если offerEvents null, значит поиск вообще не запускался (например, из-за невалидного запроса).

  // ВАЖНО: offerEvents может быть пустым массивом, если поиск не дал результатов.
  // Если noResultsDetected уже true, то все ок.
  // Если нет, проверяем.

  if (
    offerEvents &&
    offerEvents.length === 0 &&
    !noResultsDetected &&
    allRequiredCollected &&
    !needsClarification &&
    !shouldSkipOfferGeneration
  ) {
    console.log(
      `⚠️ [${userId}][${sessionId}] offerEvents пуст, но noResultsDetected=false. Исправляю на true.`
    );
    noResultsDetected = true;
  }

  // КРИТИЧЕСКИ ВАЖНО: Определяем, есть ли реальные события для показа.
  // Если offerEvents пустой (но не null), это значит поиск вернул 0 результатов.
  // Если при этом мы не добавили старые события (shouldAddPreviousEvents=false),
  // то noResultsDetected должен быть true, чтобы LLM ответила "ничего не найдено".
  // НО! Если offerEvents null, значит поиск вообще не запускался (например, из-за невалидного запроса).

  // ВАЖНО: offerEvents может быть пустым массивом, если поиск не дал результатов.
  // Если noResultsDetected уже true, то все ок.
  // Если нет, проверяем.

  if (
    offerEvents &&
    offerEvents.length === 0 &&
    !noResultsDetected &&
    allRequiredCollected &&
    !needsClarification &&
    !shouldSkipOfferGeneration
  ) {
    console.log(
      `⚠️ [${userId}][${sessionId}] offerEvents пуст, но noResultsDetected=false. Исправляю на true.`
    );
    noResultsDetected = true;
  }

  // КРИТИЧЕСКИ ВАЖНО: Определяем, есть ли реальные события для показа.
  // Если offerEvents пустой (но не null), это значит поиск вернул 0 результатов.
  // Если при этом мы не добавили старые события (shouldAddPreviousEvents=false),
  // то noResultsDetected должен быть true, чтобы LLM ответила "ничего не найдено".
  // НО! Если offerEvents null, значит поиск вообще не запускался (например, из-за невалидного запроса).

  // ВАЖНО: offerEvents может быть пустым массивом, если поиск не дал результатов.
  // Если noResultsDetected уже true, то все ок.
  // Если нет, проверяем.

  if (
    offerEvents &&
    offerEvents.length === 0 &&
    !noResultsDetected &&
    allRequiredCollected &&
    !needsClarification &&
    !shouldSkipOfferGeneration
  ) {
    console.log(
      `⚠️ [${userId}][${sessionId}] offerEvents пуст, но noResultsDetected=false. Исправляю на true.`
    );
    noResultsDetected = true;
  }

  // КРИТИЧЕСКИ ВАЖНО: Определяем, есть ли реальные события для показа.
  // Если offerEvents пустой (но не null), это значит поиск вернул 0 результатов.
  // Если при этом мы не добавили старые события (shouldAddPreviousEvents=false),
  // то noResultsDetected должен быть true, чтобы LLM ответила "ничего не найдено".
  // НО! Если offerEvents null, значит поиск вообще не запускался (например, из-за невалидного запроса).

  // ВАЖНО: offerEvents может быть пустым массивом, если поиск не дал результатов.
  // Если noResultsDetected уже true, то все ок.
  // Если нет, проверяем.

  if (
    offerEvents &&
    offerEvents.length === 0 &&
    !noResultsDetected &&
    allRequiredCollected &&
    !needsClarification &&
    !shouldSkipOfferGeneration
  ) {
    console.log(
      `⚠️ [${userId}][${sessionId}] offerEvents пуст, но noResultsDetected=false. Исправляю на true.`
    );
    noResultsDetected = true;
  }

  // КРИТИЧЕСКИ ВАЖНО: Определяем, есть ли реальные события для показа.
  // Если offerEvents пустой (но не null), это значит поиск вернул 0 результатов.
  // Если при этом мы не добавили старые события (shouldAddPreviousEvents=false),
  // то noResultsDetected должен быть true, чтобы LLM ответила "ничего не найдено".
  // НО! Если offerEvents null, значит поиск вообще не запускался (например, из-за невалидного запроса).

  // ВАЖНО: offerEvents может быть пустым массивом, если поиск не дал результатов.
  // Если noResultsDetected уже true, то все ок.
  // Если нет, проверяем.

  if (
    offerEvents &&
    offerEvents.length === 0 &&
    !noResultsDetected &&
    allRequiredCollected &&
    !needsClarification &&
    !shouldSkipOfferGeneration
  ) {
    console.log(
      `⚠️ [${userId}][${sessionId}] offerEvents пуст, но noResultsDetected=false. Исправляю на true.`
    );
    noResultsDetected = true;
  }

  // КРИТИЧЕСКИ ВАЖНО: Определяем, есть ли реальные события для показа.
  // Если offerEvents пустой (но не null), это значит поиск вернул 0 результатов.
  // Если при этом мы не добавили старые события (shouldAddPreviousEvents=false),
  // то noResultsDetected должен быть true, чтобы LLM ответила "ничего не найдено".
  // НО! Если offerEvents null, значит поиск вообще не запускался (например, из-за невалидного запроса).

  // ВАЖНО: offerEvents может быть пустым массивом, если поиск не дал результатов.
  // Если noResultsDetected уже true, то все ок.
  // Если нет, проверяем.

  if (
    offerEvents &&
    offerEvents.length === 0 &&
    !noResultsDetected &&
    allRequiredCollected &&
    !needsClarification &&
    !shouldSkipOfferGeneration
  ) {
    console.log(
      `⚠️ [${userId}][${sessionId}] offerEvents пуст, но noResultsDetected=false. Исправляю на true.`
    );
    noResultsDetected = true;
  }

  // КРИТИЧЕСКИ ВАЖНО: Определяем, есть ли реальные события для показа.
  // Если offerEvents пустой (но не null), это значит поиск вернул 0 результатов.
  // Если при этом мы не добавили старые события (shouldAddPreviousEvents=false),
  // то noResultsDetected должен быть true, чтобы LLM ответила "ничего не найдено".
  // НО! Если offerEvents null, значит поиск вообще не запускался (например, из-за невалидного запроса).

  // ВАЖНО: offerEvents может быть пустым массивом, если поиск не дал результатов.
  // Если noResultsDetected уже true, то все ок.
  // Если нет, проверяем.

  if (
    offerEvents &&
    offerEvents.length === 0 &&
    !noResultsDetected &&
    allRequiredCollected &&
    !needsClarification &&
    !shouldSkipOfferGeneration
  ) {
    console.log(
      `⚠️ [${userId}][${sessionId}] offerEvents пуст, но noResultsDetected=false. Исправляю на true.`
    );
    noResultsDetected = true;
  }

  const systemPrompt = await buildSystemPrompt({
    slots: [],
    requestType: 'default',
    offerEvents: null,
    userId,
    sessionId,
    noResultsDetected: false,
    userIntent: {
      healthComplaint: healthComplaintIntent,
    },
    userMessage,
    eventDetailsContext: null,
    isFirstMessage,
  });

  // Формируем сообщения для LLM
  const messages = buildMessages(systemPrompt, history, userMessage, userId, sessionId);

  // Используем дефолтную температуру модели; санитайзер оставляет только точечные страховки.
  if (requestId) updateStatus(requestId, 'Формируем ответ...');
  let assistantResponse = await requestAssistantMessage(
    messages,
    userId,
    sessionId,
    'health_complaint',
    1,
    null,
    requestId,
    null,
    { noCache: true }
  );

  // Обработка ответа (полная аналогия с основной логикой)
  if (!assistantResponse.parsedFromJson) {
    console.warn(
      `⚠️ [${userId}][${sessionId}] Ответ не соответствует JSON-формату. Запрашиваю перегенерацию строго в JSON.`
    );

    const retryMessages = messages.map((msg, index) => {
      if (index === 0 && msg.role === 'system') {
        return {
          ...msg,
          content: `‼️ Ответ должен быть строго JSON без текста вне объекта!\n\n${msg.content}`,
        };
      }
      return msg;
    });

    if (requestId) updateStatus(requestId, 'Улучшаем ответ...');
    assistantResponse = await requestAssistantMessage(
      retryMessages,
      userId,
      sessionId,
      'повторный (JSON)',
      1,
      null,
      requestId,
      null,
      { noCache: true }
    );

    if (!assistantResponse.parsedFromJson) {
      console.warn(
        `⚠️ [${userId}][${sessionId}] Повторный ответ всё ещё не является чистым JSON. JSON-блок будет удален.`
      );
      assistantResponse.text =
        stripJsonArtifacts(assistantResponse.text) || 'Извините, не удалось сформировать ответ.';
      assistantResponse.buttons = [];
    }
  }

  if (containsChineseCharacters(assistantResponse.text)) {
    console.warn(
      `⚠️ [${userId}][${sessionId}] Health-ответ содержит китайские символы, без LLM-retry заменю его fallback на финализации.`
    );
  }

  // Удаляем "🎯 Предложение: undefined" из ответа, если LLM случайно добавила это
  assistantResponse.text = (assistantResponse.text || '')
    .replace(/🎯\s*Предложение:\s*undefined/gi, '')
    .replace(/🎯\s*Предложение:\s*$/gm, '')
    .trim();

  if (!isSafeHealthComplaintText(assistantResponse.text)) {
    console.warn(
      `⚠️ [${userId}][${sessionId}] Health-ответ не прошел проверку качества, без LLM-retry заменю его fallback на финализации.`
    );
  }

  assistantResponse.text = finalizeHealthComplaintText(assistantResponse.text, userMessage, {
    seed: `${userId}|${sessionId}|${requestId || ''}|${userMessage}`,
    avoidTexts: getRecentAssistantTexts(history),
    enforceSafeFallback: true,
  });

  if (!assistantResponse.parsedFromJson) {
    console.warn(
      `⚠️ [${userId}][${sessionId}] Ответ так и не удалось получить в формате JSON. Возвращаю текст без кнопок.`
    );
    const rawFallback =
      typeof assistantResponse.raw === 'string' ? assistantResponse.raw.trim() : '';
    const cleanedFallback = stripJsonArtifacts(rawFallback) || rawFallback;
    const cleanedText = stripJsonArtifacts(assistantResponse.text) || assistantResponse.text || '';
    assistantResponse.text = (
      cleanedText ||
      cleanedFallback ||
      'Извините, не удалось сформировать ответ.'
    ).trim();
    assistantResponse.buttons = [];
  }
  assistantResponse.buttons = sanitizeHealthComplaintButtons(
    assistantResponse.buttons,
    userMessage
  );

  return {
    message: assistantResponse.text,
    buttons: Array.isArray(assistantResponse.buttons) ? assistantResponse.buttons : [],
    offer: null, // При жалобе на здоровье не отправляем предложения
  };
}
