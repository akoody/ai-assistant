import { updateStatus } from '../../statusService.js';
import { looksLikeQuestionText } from '../moodHealth.js';
import { buildOffTopicRedirectResponseViaLlm, classifyOffTopicViaLlmGate } from '../redirects.js';

// A question that only heuristics read as a recommendations request is double-checked by
// the LLM off-topic gate before any search runs. Returns a redirect reply when the gate
// rejects it, otherwise null.
export async function respondToOffTopicGate({
  recommendationsFromHeuristicOnly,
  requestId,
  sessionId,
  userId,
  userMessage,
}) {
  if (recommendationsFromHeuristicOnly && looksLikeQuestionText(userMessage)) {
    const gateDecision = await classifyOffTopicViaLlmGate({
      userId,
      sessionId,
      userMessage,
      requestId,
    });
    if (gateDecision.isOffTopic) {
      console.log(
        `🛑 [${userId}][${sessionId}] OFFTOPIC_GATE: сообщение классифицировано как off_topic до запуска поиска`,
        { trigger: userMessage }
      );
      if (requestId) updateStatus(requestId, 'Формируем ответ...');
      return {
        kind: 'reply',
        response: await buildOffTopicRedirectResponseViaLlm({
          userId,
          sessionId,
          userMessage,
          requestId,
          normalizedCity: null,
          hasValidCity: false,
        }),
      };
    }
    console.log(
      `ℹ️ [${userId}][${sessionId}] OFFTOPIC_GATE: сообщение оставлено in-scope, продолжаю обычный сценарий`,
      { trigger: userMessage }
    );
  }
  return null;
}
