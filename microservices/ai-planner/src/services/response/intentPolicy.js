const OFF_TOPIC_INTENT_NAME = 'off_topic';

const AUTHORITATIVE_OFF_TOPIC_CONFIDENCE_THRESHOLD = 0.9;

function isAuthoritativeOffTopicIntent(intent) {
  if (!intent || intent.name !== OFF_TOPIC_INTENT_NAME) {
    return false;
  }

  const confidence = typeof intent.confidence === 'number' ? intent.confidence : 1;
  if (confidence < AUTHORITATIVE_OFF_TOPIC_CONFIDENCE_THRESHOLD) {
    return false;
  }

  const source = String(intent.source || '')
    .trim()
    .toLowerCase();
  return source === '' || source === 'llm' || source === 'model' || source === 'slash_command';
}

export { OFF_TOPIC_INTENT_NAME, isAuthoritativeOffTopicIntent };
