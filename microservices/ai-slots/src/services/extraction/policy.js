const OFF_TOPIC_INTENT_NAME = 'off_topic';

const RECOMMENDATIONS_INTENT_NAME = 'recommendations_request';

const EVENT_TYPE_SLOT_NAMES = new Set(['тип_мероприятия', 'тип_события']);

const GENRE_SLOT_NAMES = new Set(['жанр', 'жанр_музыки', 'предпочтения_жанры']);

const SEARCH_QUERY_SLOT_NAME = 'поисковый_запрос';

const TASTE_SLOT_NAMES = new Set([
  ...EVENT_TYPE_SLOT_NAMES,
  ...GENRE_SLOT_NAMES,
  'исполнитель',
  'артист',
]);

const BUDGET_PERSISTENCE_SLOT_NAMES = new Set(['бюджет', 'цена_до', 'цена_от', 'цена']);

const ARTIST_SLOT_NAMES = new Set(['исполнитель', 'артист']);

const MOOD_SLOT_NAME = 'настроение';

const SLOT_EXTRACTION_PIPELINE_VERSION = '2026-04-29-birthday-time-guard-v1';

function hasOffTopicIntent(intents = []) {
  return Array.isArray(intents) && intents.some((intent) => intent?.name === OFF_TOPIC_INTENT_NAME);
}

const SLOT_PLACEHOLDER_VALUES = new Set([
  '',
  'не указано',
  'не указан',
  'не указана',
  'не указаны',
  'неизвестно',
  'unknown',
  'undefined',
  'null',
  'none',
  'n/a',
]);

const HIP_HOP_GROUNDING_PATTERN = /(рэп|реп|хип[\s-]?хоп|hip[\s-]?hop|трэп|trap)/u;

export {
  OFF_TOPIC_INTENT_NAME,
  RECOMMENDATIONS_INTENT_NAME,
  EVENT_TYPE_SLOT_NAMES,
  GENRE_SLOT_NAMES,
  SEARCH_QUERY_SLOT_NAME,
  TASTE_SLOT_NAMES,
  BUDGET_PERSISTENCE_SLOT_NAMES,
  ARTIST_SLOT_NAMES,
  MOOD_SLOT_NAME,
  SLOT_EXTRACTION_PIPELINE_VERSION,
  hasOffTopicIntent,
  SLOT_PLACEHOLDER_VALUES,
  HIP_HOP_GROUNDING_PATTERN,
};
