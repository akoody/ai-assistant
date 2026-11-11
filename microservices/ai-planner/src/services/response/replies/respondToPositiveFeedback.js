import { analyzeFeedbackAndSavePreferences } from '../../feedbackService.js';
import { updateStatus } from '../../statusService.js';
import {
  buildPositiveFeedbackAckResponseViaLlm,
  extractPositiveFeedbackDetails,
  persistPositiveFeedbackPreferences,
  wantsMoreOffersAfterFeedback,
} from '../preferenceFeedback.js';

// Positive feedback about a shown event is remembered as a preference and acknowledged;
// a request for more offers after it continues the search. Returns the reply outcome, or
// null when the message carries no positive feedback.
export async function respondToPositiveFeedback({
  hasPositiveFeedbackSignal,
  positiveFeedbackIntent,
  positiveFeedbackSlot,
  requestId,
  sessionId,
  slotExtractionResult,
  userId,
  userMessage,
}) {
  if (hasPositiveFeedbackSignal) {
    console.log(
      `💚 [${userId}][${sessionId}] Обнаружен позитивный фидбек о событии`,
      positiveFeedbackIntent || positiveFeedbackSlot
    );

    // Надёжно сохраняем предпочтения из извлечённых деталей (даже если в тексте опечатка).
    const extractedFeedbackDetails = extractPositiveFeedbackDetails(
      slotExtractionResult,
      positiveFeedbackIntent
    );
    persistPositiveFeedbackPreferences(userId, extractedFeedbackDetails);

    // Запускаем анализ и сохранение предпочтений в фоновом режиме
    analyzeFeedbackAndSavePreferences(userId, sessionId, userMessage, {
      forcePositive: hasPositiveFeedbackSignal,
      slotExtractionResult,
      positiveFeedbackIntent,
    })
      .then((result) => {
        if (result.savedPreferences && result.savedPreferences.length > 0) {
          console.log(
            `✅ [${userId}][${sessionId}] Автоматически сохранены предпочтения на основе фидбека:`,
            result.savedPreferences
          );
        }
      })
      .catch((error) => {
        console.error(`❌ [${userId}][${sessionId}] Ошибка при обработке фидбека:`, error);
      });

    // Если пользователь просто сообщил, что событие понравилось (без запроса "покажи ещё/похожее"),
    // не запускаем новую выдачу автоматически — иначе это выглядит как "я вас не понял".
    if (!wantsMoreOffersAfterFeedback(userMessage)) {
      if (requestId) updateStatus(requestId, 'Формируем ответ...');
      return {
        kind: 'reply',
        response: await buildPositiveFeedbackAckResponseViaLlm({
          userId,
          sessionId,
          userMessage,
          requestId,
        }),
      };
    }
  }
  return null;
}
