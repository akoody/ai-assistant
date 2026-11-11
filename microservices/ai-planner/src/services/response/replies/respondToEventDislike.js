import { updateStatus } from '../../statusService.js';
import { saveDislikedPreference } from '../../userPreferencesService.js';
import { PREFERENCE_TYPES } from '../../userPreferencesService.js';
import { updateComplaintFlowState } from '../../sessionService.js';
import { buildComplaintFlowResponseViaLlm } from '../dialogReplies.js';
import { buildEventDislikeComplaintStartResponse } from '../preferenceFeedback.js';

export async function respondToEventDislike({
  requestId,
  dislikedEventTitles,
  userId,
  sessionId,
  session,
  userMessage,
}) {
  if (requestId) updateStatus(requestId, 'Формируем ответ...');
  const nextComplaintFlow = {
    stage: 'choose_reason',
    startedAt: new Date().toISOString(),
    source: 'event_dislike',
    eventTitle: dislikedEventTitles[0] || null,
    eventTitles: dislikedEventTitles,
  };

  if (dislikedEventTitles.length > 0) {
    const saveResults = await Promise.allSettled(
      dislikedEventTitles.map((title) =>
        saveDislikedPreference(userId, PREFERENCE_TYPES.EVENT_TITLE, title)
      )
    );

    saveResults.forEach((saveResult, index) => {
      const title = dislikedEventTitles[index];
      if (saveResult.status === 'fulfilled') {
        console.log(`💾 [${userId}][${sessionId}] Сохранено нежелательное событие: "${title}"`);
        return;
      }

      console.warn(
        `⚠️ [${userId}][${sessionId}] Не удалось сохранить нежелательное событие "${title}":`,
        saveResult.reason
      );
    });
  }

  await updateComplaintFlowState(userId, sessionId, nextComplaintFlow);
  session.complaintFlow = nextComplaintFlow;

  return await buildComplaintFlowResponseViaLlm({
    userId,
    sessionId,
    userMessage,
    requestId,
    fallbackResponse: buildEventDislikeComplaintStartResponse(dislikedEventTitles),
  });
}
