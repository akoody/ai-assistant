import { isRussianCity } from '../../offerService.js';
import { updateOffTopicContextResetPending } from '../../sessionService.js';
import { getCurrentSessionSlots, saveSlotToDatabase } from '../../slotsService.js';
import { updateStatus } from '../../statusService.js';
import {
  probeKassirEventsForOffTopicCandidate,
  summarizeOffTopicProbeEvent,
} from '../eventProbe.js';
import { OFF_TOPIC_INTENT_NAME } from '../intentPolicy.js';
import {
  buildOffTopicRedirectResponse,
  buildOffTopicRedirectResponseViaLlm,
} from '../redirects.js';
import { normalizeComparableSlotValue } from '../slotUtils.js';

// An off-topic message may still name something on sale (a show, a performer). The Kassir
// probe decides: found events turn the message back into a search (`continue` with the
// extra slots and a recommendations intent), otherwise the user gets a redirect reply.
// Returns null when the message is not an off-topic candidate.
export async function respondToOffTopicCandidate({
  detectedIntents,
  hasExplicitCategoryInUserMessage,
  hasExplicitSeniorCompanion,
  hasNonCityExtractedSlot,
  isButtonEcho,
  isBuyTicketsUiCommand,
  isEventDetailsRequest,
  isQuickCategorySelection,
  isShowMoreRequest,
  offTopicIntent,
  preferenceMemoryRequest,
  recommendationsIntent,
  recoveredUiSlot,
  requestId,
  session,
  sessionId,
  slashCommand,
  slotExtractionResult,
  userId,
  userMessage,
}) {
  if (
    offTopicIntent &&
    !hasExplicitCategoryInUserMessage &&
    !hasExplicitSeniorCompanion &&
    !preferenceMemoryRequest.wantsAnyPreferenceMemory &&
    !hasNonCityExtractedSlot &&
    !recoveredUiSlot &&
    !isShowMoreRequest &&
    !isEventDetailsRequest &&
    !isQuickCategorySelection &&
    !isButtonEcho &&
    !isBuyTicketsUiCommand
  ) {
    const currentSlots = await getCurrentSessionSlots(userId, sessionId);
    const eventProbeResult = await probeKassirEventsForOffTopicCandidate({
      userId,
      sessionId,
      userMessage,
      currentSlots,
      requestId,
    });

    if (eventProbeResult.hasMatchingEvents) {
      const probeSlotsToAdd = eventProbeResult.slots.filter(
        (slot) => slot && slot.name !== 'город' && String(slot.value || '').trim()
      );

      if (!slotExtractionResult || typeof slotExtractionResult !== 'object') {
        slotExtractionResult = { text: userMessage, slots: [], intents: [] };
      }
      if (!Array.isArray(slotExtractionResult.slots)) {
        slotExtractionResult.slots = [];
      }
      if (!Array.isArray(slotExtractionResult.intents)) {
        slotExtractionResult.intents = detectedIntents;
      }

      for (const slot of probeSlotsToAdd) {
        const alreadyPresent = slotExtractionResult.slots.some(
          (existingSlot) =>
            existingSlot &&
            existingSlot.name === slot.name &&
            normalizeComparableSlotValue(existingSlot.value) ===
              normalizeComparableSlotValue(slot.value)
        );

        if (!alreadyPresent) {
          slotExtractionResult.slots.push(slot);
        }

        try {
          await saveSlotToDatabase(userId, slot);
        } catch (error) {
          console.warn(
            `⚠️ [${userId}][${sessionId}] OFFTOPIC_EVENT_PROBE: не удалось сохранить слот ${slot.name}="${slot.value}"`,
            error
          );
        }
      }

      recommendationsIntent = recommendationsIntent || {
        name: 'recommendations_request',
        confidence: 0.92,
        trigger: userMessage,
        source: 'offtopic_event_probe',
      };
      if (
        !detectedIntents.some(
          (intent) =>
            intent &&
            intent.name === recommendationsIntent.name &&
            intent.source === recommendationsIntent.source
        )
      ) {
        detectedIntents.push(recommendationsIntent);
      }

      console.log(
        `✅ [${userId}][${sessionId}] OFFTOPIC_EVENT_PROBE: "${userMessage}" найдено в афише, ` +
          'снимаю off_topic и продолжаю обычный поиск',
        {
          slots: probeSlotsToAdd.map((slot) => `${slot.name}="${slot.value}"`),
          firstEvent: summarizeOffTopicProbeEvent(eventProbeResult.events[0]),
        }
      );

      return { kind: 'continue', slotExtractionResult, recommendationsIntent };
    } else {
      console.log(
        `🧭 [${userId}][${sessionId}] Оффтоп-запрос (intent=${OFF_TOPIC_INTENT_NAME}) — формируем ответ`,
        offTopicIntent
      );
      if (requestId) updateStatus(requestId, 'Формируем ответ...');

      const citySlot = Array.isArray(currentSlots)
        ? currentSlots.find((slot) => slot && slot.name === 'город')
        : null;
      const normalizedCity =
        citySlot && citySlot.value && String(citySlot.value).trim().length > 0
          ? String(citySlot.value).trim()
          : null;
      const hasValidCity = Boolean(normalizedCity && isRussianCity(normalizedCity));
      await updateOffTopicContextResetPending(userId, sessionId, true);
      session.offTopicContextResetPending = true;

      const useOffTopicLlm = process.env.OFFTOPIC_REDIRECT_USE_LLM !== '0';
      if (useOffTopicLlm) {
        return {
          kind: 'reply',
          response: await buildOffTopicRedirectResponseViaLlm({
            userId,
            sessionId,
            userMessage,
            requestId,
            normalizedCity,
            hasValidCity,
            slashCommand,
          }),
        };
      }
      const seed = `${userId}|${sessionId}|${userMessage}`;
      return {
        kind: 'reply',
        response: await buildOffTopicRedirectResponse({
          normalizedCity,
          hasValidCity,
          seed,
          userMessage,
        }),
      };
    }
  }
  return null;
}
