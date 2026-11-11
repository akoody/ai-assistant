import { updateStatus } from '../../statusService.js';
import { getCurrentSessionSlots } from '../../slotsService.js';
import { getKnownEventTypeValue } from '../slotUtils.js';
import { readSlotValue } from '../slotUtils.js';
import { getUserPreferences } from '../../userPreferencesService.js';
import { getClarificationButtonsForTarget } from '../clarification.js';
import { buildClarificationActionResponse } from '../clarification.js';
import { getMessageHistory } from '../../messagesStorage.js';
import { markClarificationAsked } from '../../sessionService.js';
import { buildKnownCityClarificationResponseViaLlm } from '../clarification.js';

export async function respondToClarificationAction({
  userId,
  sessionId,
  clarificationActionTarget,
  requestId,
  session,
  userMessage,
}) {
  console.log(
    `🧭 [${userId}][${sessionId}] UI-команда уточнения параметра — открываю сценарий "${clarificationActionTarget}"`
  );
  if (requestId) updateStatus(requestId, 'Формируем ответ...');

  const currentSlots = await getCurrentSessionSlots(userId, sessionId);
  const snapshotSlots = Array.isArray(session?.slotsSnapshot) ? session.slotsSnapshot : [];
  const knownEventType =
    getKnownEventTypeValue(currentSlots) || getKnownEventTypeValue(snapshotSlots);
  const currentCitySlot = Array.isArray(currentSlots)
    ? currentSlots.find((slot) => slot && slot.name === 'город' && readSlotValue(slot))
    : null;
  const knownCity = currentCitySlot ? readSlotValue(currentCitySlot) : '';
  const userPreferences = await getUserPreferences(userId);
  const fallbackButtons = getClarificationButtonsForTarget(
    clarificationActionTarget,
    knownEventType,
    userPreferences,
    currentSlots
  );
  const fallbackSeed = buildClarificationActionResponse({
    target: clarificationActionTarget,
    knownEventType,
    userPreferences,
    slots: currentSlots,
  });
  const history = await getMessageHistory(userId, sessionId);

  await markClarificationAsked(userId, sessionId);
  session.clarificationAsked = true;

  return await buildKnownCityClarificationResponseViaLlm({
    userId,
    sessionId,
    userMessage,
    requestId,
    knownCity,
    slots: currentSlots,
    targetHint: clarificationActionTarget,
    originalText: fallbackSeed.message,
    originalButtons: fallbackButtons,
    history,
    userPreferences,
  });
}
