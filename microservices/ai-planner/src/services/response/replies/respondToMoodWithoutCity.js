import { getCurrentSessionSlots } from '../../slotsService.js';
import { resolveMoodSearchSignal } from '../../offerService.js';
import { isRussianCity } from '../../offerService.js';
import { normalizeCategory } from '../categoryDefinitions.js';
import { detectCategoryFromText } from '../categoryDefinitions.js';
import { saveSlotToDatabase } from '../../slotsService.js';
import { getCanonicalMoodValue } from '../moodHealth.js';
import { updateStatus } from '../../statusService.js';
import { buildMoodCityPromptResponseViaLlm } from '../moodHealth.js';

export async function respondToMoodWithoutCity({
  recommendationsIntent,
  isShowMoreRequest,
  isEventDetailsRequest,
  isChangeCityRequest,
  isChangeDateRequest,
  isChangePreferencesRequest,
  isHealthComplaintRequest,
  isQuickCategorySelection,
  isButtonEcho,
  recoveredUiSlot,
  isBuyTicketsUiCommand,
  userId,
  sessionId,
  extractedSlotsForOffTopicCheck,
  userMessage,
  requestId,
}) {
  if (
    recommendationsIntent &&
    !isShowMoreRequest &&
    !isEventDetailsRequest &&
    !isChangeCityRequest &&
    !isChangeDateRequest &&
    !isChangePreferencesRequest &&
    !isHealthComplaintRequest &&
    !isQuickCategorySelection &&
    !isButtonEcho &&
    !recoveredUiSlot &&
    !isBuyTicketsUiCommand
  ) {
    const currentSlots = await getCurrentSessionSlots(userId, sessionId);
    const moodSignal = resolveMoodSearchSignal({
      slots: [
        ...(Array.isArray(currentSlots) ? currentSlots : []),
        ...extractedSlotsForOffTopicCheck,
      ],
      fallbackQuery: userMessage,
    });
    const currentCitySlot = Array.isArray(currentSlots)
      ? currentSlots.find(
          (slot) => slot && slot.name === 'город' && String(slot.value || '').trim()
        )
      : null;
    const currentEventTypeSlot = Array.isArray(currentSlots)
      ? currentSlots.find(
          (slot) =>
            slot &&
            (slot.name === 'тип_мероприятия' ||
              slot.name === 'тип_события' ||
              slot.name === 'категория') &&
            String(slot.value || '').trim()
        )
      : null;
    const knownCity = String(currentCitySlot?.value || '').trim();
    const hasKnownValidCity = Boolean(knownCity && isRussianCity(knownCity));

    if (moodSignal?.moodValue && !hasKnownValidCity) {
      const explicitEventTypeForMood = normalizeCategory(
        String(currentEventTypeSlot?.value || detectCategoryFromText(userMessage) || '').trim()
      );
      if (explicitEventTypeForMood && !currentEventTypeSlot) {
        try {
          await saveSlotToDatabase(userId, {
            name: 'тип_мероприятия',
            value: explicitEventTypeForMood,
            confidence: 0.9,
            source: 'mood_pre_city_category',
          });
          console.log(
            `🎯 [${userId}][${sessionId}] До выбора города сохраняю явную категорию ` +
              `"${explicitEventTypeForMood}" из mood-запроса.`
          );
        } catch (error) {
          console.warn(
            `⚠️ [${userId}][${sessionId}] Не удалось сохранить категорию до выбора города`,
            error
          );
        }
      }

      const existingMoodSlot = Array.isArray(currentSlots)
        ? currentSlots.find(
            (slot) => slot && slot.name === 'настроение' && String(slot.value || '').trim()
          )
        : null;
      if (!existingMoodSlot) {
        const persistedMoodValue = getCanonicalMoodValue(moodSignal.moodValue);
        if (persistedMoodValue) {
          try {
            await saveSlotToDatabase(userId, {
              name: 'настроение',
              value: persistedMoodValue,
              confidence: 0.88,
              source: `mood_${moodSignal.source || 'signal'}_pre_city`,
            });
            console.log(
              `🎭 [${userId}][${sessionId}] Сохраняю mood-сигнал до выбора города: ` +
                `"${persistedMoodValue}" (source: ${moodSignal.source || 'unknown'})`
            );
          } catch (error) {
            console.warn(
              `⚠️ [${userId}][${sessionId}] Не удалось сохранить mood-сигнал до выбора города`,
              error
            );
          }
        }
      }
      console.log(
        `🎭 [${userId}][${sessionId}] Общий mood-запрос без города — генерирую LLM-ответ с выбором города`,
        { mood: moodSignal.moodValue, source: moodSignal.source }
      );
      if (requestId) updateStatus(requestId, 'Формируем ответ...');
      return await buildMoodCityPromptResponseViaLlm({
        userId,
        sessionId,
        userMessage,
        requestId,
        moodValue: moodSignal.moodValue,
      });
    }
  }
}
