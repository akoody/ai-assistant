const EVENT_DETAILS_INTENT_NAME = 'event_details_request';
const SHOW_MORE_INTENT_NAME = 'show_more_results';
const CHANGE_CITY_INTENT_NAME = 'change_city';
const CHANGE_DATE_INTENT_NAME = 'change_date';
const CHANGE_PREFERENCES_INTENT_NAME = 'change_preferences';
const PREFERENCE_MEMORY_REFERENCE_INTENT_NAME = 'preference_memory_reference';
const HEALTH_COMPLAINT_INTENT_NAME = 'health_complaint';
const POSITIVE_FEEDBACK_INTENT_NAME = 'positive_feedback';
const NEGATIVE_EVENT_FEEDBACK_INTENT_NAME = 'negative_event_feedback';
const RECOMMENDATION_COMPLAINT_INTENT_NAME = 'recommendation_complaint';
const ASSISTANT_CRITICISM_INTENT_NAME = 'assistant_criticism';
const RECOMMENDATIONS_INTENT_NAME = 'recommendations_request';
const SMALLTALK_INTENT_NAME = 'smalltalk';
const BUY_TICKET_INTENT_NAME = 'buy_ticket';

export const EVENT_DETAILS_CONFIDENCE_THRESHOLD = 0.3;
export const SHOW_MORE_CONFIDENCE_THRESHOLD = 0.8;
export const CHANGE_CITY_CONFIDENCE_THRESHOLD = 0.7;
export const CHANGE_DATE_CONFIDENCE_THRESHOLD = 0.7;
export const CHANGE_PREFERENCES_CONFIDENCE_THRESHOLD = 0.75;
export const PREFERENCE_MEMORY_REFERENCE_CONFIDENCE_THRESHOLD = 0.7;
export const HEALTH_COMPLAINT_CONFIDENCE_THRESHOLD = 0.7;
export const POSITIVE_FEEDBACK_CONFIDENCE_THRESHOLD = 0.75;
export const NEGATIVE_EVENT_FEEDBACK_CONFIDENCE_THRESHOLD = 0.75;
export const RECOMMENDATION_COMPLAINT_CONFIDENCE_THRESHOLD = 0.75;
export const ASSISTANT_CRITICISM_CONFIDENCE_THRESHOLD = 0.75;
export const RECOMMENDATIONS_CONFIDENCE_THRESHOLD = 0.7;
export const SMALLTALK_CONFIDENCE_THRESHOLD = 0.7;
export const BUY_TICKET_CONFIDENCE_THRESHOLD = 0.8;

function pickBestIntent(intents = [], intentName) {
  if (!Array.isArray(intents)) {
    return null;
  }

  let bestIntent = null;
  intents.forEach((intent) => {
    if (!intent || intent.name !== intentName) {
      return;
    }
    const confidence = typeof intent.confidence === 'number' ? intent.confidence : 1;
    const currentBestConfidence =
      typeof bestIntent?.confidence === 'number' ? bestIntent.confidence : -Infinity;
    if (!bestIntent || confidence > currentBestConfidence) {
      bestIntent = intent;
    }
  });

  return bestIntent;
}

export function pickEventDetailsIntent(intents = []) {
  const intent = pickBestIntent(intents, EVENT_DETAILS_INTENT_NAME);
  if (!intent) {
    return null;
  }
  if (intent.confidence === undefined || intent.confidence >= EVENT_DETAILS_CONFIDENCE_THRESHOLD) {
    return intent;
  }
  return null;
}

export function pickShowMoreIntent(intents = []) {
  const intent = pickBestIntent(intents, SHOW_MORE_INTENT_NAME);
  if (!intent) {
    return null;
  }
  if (intent.confidence === undefined || intent.confidence >= SHOW_MORE_CONFIDENCE_THRESHOLD) {
    return intent;
  }
  return null;
}

export function pickChangeCityIntent(intents = []) {
  const intent = pickBestIntent(intents, CHANGE_CITY_INTENT_NAME);
  if (!intent) {
    return null;
  }
  if (intent.confidence === undefined || intent.confidence >= CHANGE_CITY_CONFIDENCE_THRESHOLD) {
    return intent;
  }
  return null;
}

export function pickChangeDateIntent(intents = []) {
  const intent = pickBestIntent(intents, CHANGE_DATE_INTENT_NAME);
  if (!intent) {
    return null;
  }
  if (intent.confidence === undefined || intent.confidence >= CHANGE_DATE_CONFIDENCE_THRESHOLD) {
    return intent;
  }
  return null;
}

export function pickHealthComplaintIntent(intents = []) {
  const intent = pickBestIntent(intents, HEALTH_COMPLAINT_INTENT_NAME);
  if (!intent) {
    return null;
  }
  if (
    intent.confidence === undefined ||
    intent.confidence >= HEALTH_COMPLAINT_CONFIDENCE_THRESHOLD
  ) {
    return intent;
  }
  return null;
}

export function pickPositiveFeedbackIntent(intents = []) {
  const intent = pickBestIntent(intents, POSITIVE_FEEDBACK_INTENT_NAME);
  if (!intent) {
    return null;
  }
  if (
    intent.confidence === undefined ||
    intent.confidence >= POSITIVE_FEEDBACK_CONFIDENCE_THRESHOLD
  ) {
    return intent;
  }
  return null;
}

export function pickNegativeEventFeedbackIntent(intents = []) {
  const intent = pickBestIntent(intents, NEGATIVE_EVENT_FEEDBACK_INTENT_NAME);
  if (!intent) {
    return null;
  }
  if (
    intent.confidence === undefined ||
    intent.confidence >= NEGATIVE_EVENT_FEEDBACK_CONFIDENCE_THRESHOLD
  ) {
    return intent;
  }
  return null;
}

export function pickRecommendationComplaintIntent(intents = []) {
  const intent = pickBestIntent(intents, RECOMMENDATION_COMPLAINT_INTENT_NAME);
  if (!intent) {
    return null;
  }
  if (
    intent.confidence === undefined ||
    intent.confidence >= RECOMMENDATION_COMPLAINT_CONFIDENCE_THRESHOLD
  ) {
    return intent;
  }
  return null;
}

export function pickAssistantCriticismIntent(intents = []) {
  const intent = pickBestIntent(intents, ASSISTANT_CRITICISM_INTENT_NAME);
  if (!intent) {
    return null;
  }
  if (
    intent.confidence === undefined ||
    intent.confidence >= ASSISTANT_CRITICISM_CONFIDENCE_THRESHOLD
  ) {
    return intent;
  }
  return null;
}

export function pickChangePreferencesIntent(intents = []) {
  const intent = pickBestIntent(intents, CHANGE_PREFERENCES_INTENT_NAME);
  if (!intent) {
    return null;
  }
  if (
    intent.confidence === undefined ||
    intent.confidence >= CHANGE_PREFERENCES_CONFIDENCE_THRESHOLD
  ) {
    return intent;
  }
  return null;
}

export function pickPreferenceMemoryReferenceIntent(intents = []) {
  const intent = pickBestIntent(intents, PREFERENCE_MEMORY_REFERENCE_INTENT_NAME);
  if (!intent) {
    return null;
  }
  if (
    intent.confidence === undefined ||
    intent.confidence >= PREFERENCE_MEMORY_REFERENCE_CONFIDENCE_THRESHOLD
  ) {
    return intent;
  }
  return null;
}

export function pickRecommendationsIntent(intents = []) {
  const intent = pickBestIntent(intents, RECOMMENDATIONS_INTENT_NAME);
  if (!intent) {
    return null;
  }
  if (
    intent.confidence === undefined ||
    intent.confidence >= RECOMMENDATIONS_CONFIDENCE_THRESHOLD
  ) {
    return intent;
  }
  return null;
}

export function pickSmalltalkIntent(intents = []) {
  const intent = pickBestIntent(intents, SMALLTALK_INTENT_NAME);
  if (!intent) {
    return null;
  }
  if (intent.confidence === undefined || intent.confidence >= SMALLTALK_CONFIDENCE_THRESHOLD) {
    return intent;
  }
  return null;
}

export function pickBuyTicketIntent(intents = []) {
  const intent = pickBestIntent(intents, BUY_TICKET_INTENT_NAME);
  if (!intent) {
    return null;
  }
  if (intent.confidence === undefined || intent.confidence >= BUY_TICKET_CONFIDENCE_THRESHOLD) {
    return intent;
  }
  return null;
}
