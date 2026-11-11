import { OFF_TOPIC_INTENT_NAME, RECOMMENDATIONS_INTENT_NAME } from './policy.js';
import { looksLikeEventDomainText } from './eventGrounding.js';

function sanitizeSlotsByIntent(slots, intents, sourceText = '') {
  const inputSlots = Array.isArray(slots) ? slots : [];
  if (inputSlots.length === 0) return inputSlots;

  const inputIntents = Array.isArray(intents) ? intents.filter(Boolean) : [];
  const hasOffTopicIntent = inputIntents.some(
    (intent) =>
      intent?.name === OFF_TOPIC_INTENT_NAME &&
      (typeof intent.confidence !== 'number' || intent.confidence >= 0.7)
  );
  const hasRecommendationsIntent = inputIntents.some(
    (intent) => intent?.name === RECOMMENDATIONS_INTENT_NAME
  );

  if (!hasOffTopicIntent || hasRecommendationsIntent || looksLikeEventDomainText(sourceText)) {
    return inputSlots;
  }

  const onlyCitySlots = inputSlots.filter((slot) => slot && slot.name === 'город');
  if (onlyCitySlots.length !== inputSlots.length) {
    console.log(
      `[queueService] 🧹 Off-topic запрос — очищаю не-городские слоты перед сохранением (${inputSlots.length} -> ${onlyCitySlots.length})`
    );
  }
  return onlyCitySlots;
}

export { sanitizeSlotsByIntent };
