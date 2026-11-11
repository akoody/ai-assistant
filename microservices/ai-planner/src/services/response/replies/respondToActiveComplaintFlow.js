import { handleComplaintFlow, looksLikeRecommendationComplaint } from '../../complaintService.js';
import { isQuickCategoryButtonText } from '../../quickButtonsService.js';
import {
  resetOfferFlags,
  updateComplaintFlowState,
  updateOffTopicContextResetPending,
  updateSessionSelectedEvent,
  updateSessionSlotsSnapshot,
} from '../../sessionService.js';
import { clearUserSlots } from '../../slotsService.js';
import { updateStatus } from '../../statusService.js';
import {
  PREFERENCE_TYPES,
  resetUserPreferences,
  saveDislikedPreference,
  savePreference,
} from '../../userPreferencesService.js';
import { buildComplaintFlowResponseViaLlm } from '../dialogReplies.js';
import { pruneSnapshotSlotsAfterComplaint } from '../responseQuality.js';

// While a complaint about recommendations is open, a category choice or a new
// recommendations request is answered inside that flow. Returns the reply outcome, or
// null when no complaint flow is active.
export async function respondToActiveComplaintFlow({
  activeComplaintFlow,
  complaintSlots,
  recommendationComplaintIntent,
  recommendationsIntent,
  requestId,
  session,
  sessionId,
  userId,
  userMessage,
}) {
  if (activeComplaintFlow && (isQuickCategoryButtonText(userMessage) || recommendationsIntent)) {
    await updateComplaintFlowState(userId, sessionId, null);
    session.complaintFlow = null;
  } else {
    const complaintResult = handleComplaintFlow({
      userMessage,
      complaintFlow: activeComplaintFlow,
      slots: complaintSlots,
      forceStart: Boolean(recommendationComplaintIntent),
    });

    if (complaintResult.handled) {
      if (requestId) updateStatus(requestId, 'Формируем ответ...');
      await updateComplaintFlowState(userId, sessionId, complaintResult.nextFlow || null);
      session.complaintFlow = complaintResult.nextFlow || null;

      if (
        Array.isArray(complaintResult.preferenceUpdates) &&
        complaintResult.preferenceUpdates.length > 0
      ) {
        for (const update of complaintResult.preferenceUpdates) {
          if (!update) continue;
          if (update.type === 'disliked_genre' && update.value) {
            await saveDislikedPreference(userId, PREFERENCE_TYPES.GENRE, update.value);
          }
          if (update.type === 'price_range' && update.value) {
            await savePreference(userId, PREFERENCE_TYPES.PRICE_RANGE, update.value);
          }
        }
      }

      if (complaintResult.resetUserState) {
        await Promise.all([
          resetUserPreferences(userId),
          clearUserSlots(userId),
          updateSessionSlotsSnapshot(userId, sessionId, []),
          updateSessionSelectedEvent(userId, sessionId, null),
          updateOffTopicContextResetPending(userId, sessionId, false),
          resetOfferFlags(userId, sessionId),
        ]);

        session.slotsSnapshot = [];
        session.quickOfferSent = false;
        session.finalOfferSent = false;
        session.clarificationAsked = false;
        session.selectedEvent = null;
        session.offTopicContextResetPending = false;

        console.log(
          `🧼 [${userId}][${sessionId}] Complaint-flow выполнил полный сброс состояния пользователя и сессии`
        );
      }

      const complaintResetSlotNames = Array.isArray(complaintResult.slotResetNames)
        ? complaintResult.slotResetNames
        : [];
      if (!complaintResult.resetUserState && complaintResetSlotNames.length > 0) {
        const previousSnapshot = Array.isArray(session?.slotsSnapshot) ? session.slotsSnapshot : [];
        const nextSnapshot = pruneSnapshotSlotsAfterComplaint(
          previousSnapshot,
          complaintResetSlotNames
        );

        await updateSessionSlotsSnapshot(userId, sessionId, nextSnapshot);
        session.slotsSnapshot = nextSnapshot;

        await resetOfferFlags(userId, sessionId);
        session.quickOfferSent = false;
        session.finalOfferSent = false;
        session.clarificationAsked = false;

        console.log(
          `🧹 [${userId}][${sessionId}] Complaint-flow очистил поисковые слоты сессии: ${complaintResetSlotNames.join(', ')}`
        );
      }

      console.log(`🧾 [${userId}][${sessionId}] Complaint-flow обработан`, {
        nextStage: complaintResult.nextFlow?.stage || null,
        complaintDetected:
          Boolean(recommendationComplaintIntent) || looksLikeRecommendationComplaint(userMessage),
      });

      return {
        kind: 'reply',
        response: await buildComplaintFlowResponseViaLlm({
          userId,
          sessionId,
          userMessage,
          requestId,
          fallbackResponse: complaintResult.response,
        }),
      };
    }
  }
  return null;
}
