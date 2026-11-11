import { normalizeText } from './textUtils.js';
import { STOP_WORDS, TRIVIAL_WORDS, NON_SPECIFIC_QUERY_WORDS } from './searchVocabulary.js';
import { isRussianCity, buildSearchParamsFromSlots } from '../offerService.js';
import { normalizeComparableSlotValue, mergeSlots } from './slotUtils.js';
import { getAiToolsUrl, getAiToolsApiKey } from '../configService.js';

const SIMILAR_EVENT_RESET_SLOT_NAMES = new Set([
  'исполнитель',
  'название_мероприятия',
  'поисковый_запрос',
]);

const OFF_TOPIC_EVENT_PROBE_TIMEOUT_MS = 3500;

const OFF_TOPIC_EVENT_PROBE_MIN_WORDS = 2;

const OFF_TOPIC_EVENT_PROBE_MAX_WORDS = 8;

const OFF_TOPIC_EVENT_PROBE_MAX_CHARS = 90;

const OFF_TOPIC_EVENT_PROBE_REJECT_PHRASES = new Set([
  'добрый день',
  'добрый вечер',
  'доброе утро',
  'как дела',
  'что делаешь',
  'кто ты',
  'курс доллара',
  'курс евро',
  'погода сегодня',
  'какая погода',
]);

const OFF_TOPIC_EVENT_PROBE_SINGLE_WORD_REJECT_WORDS = new Set([
  'привет',
  'здравствуйте',
  'пока',
  'спасибо',
  'пожалуйста',
  'хорошо',
  'понятно',
  'ладно',
  'окей',
  'ок',
  'да',
  'нет',
  'курс',
  'доллар',
  'евро',
  'биткоин',
  'акции',
  'ипотека',
  'кредит',
  'налоги',
  'погода',
  'кино',
  'новости',
  'рецепт',
  'перевод',
  'переведи',
  'код',
  'ошибка',
  'sql',
  'python',
  'javascript',
  'помоги',
  'объясни',
  'расскажи',
  'почему',
  'зачем',
  'когда',
  'сколько',
  'где',
  'кто',
  'что',
  'как',
]);

const OFF_TOPIC_EVENT_PROBE_REJECT_PATTERNS = [
  /(?:^|\s)(?:как|почему|зачем|сколько|когда|где|что|кто|чей|чья|чье|чьё|какой|какая|какие|какое)\s+/u,
  /(?:^|\s)(?:курс|погод|новост|рецепт|переведи|перевод|sql|javascript|python|код|ошибк|почему|объясни|расскажи)(?![A-Za-zА-Яа-яЁё0-9_])/u,
  /https?:\/\/|www\.|@/iu,
];

const OFF_TOPIC_EVENT_PROBE_SHORT_NAMED_EVENT_PATTERNS = [
  /^(?:я\s+)?(?:хочу|хотим|хотел(?:а|о)?(?:сь)?\s*бы|ищу|ищем|интересует|интересуют)\s+(?:пойти\s+|сходить\s+|попасть\s+)?на\s+/iu,
  /^(?:билет(?:ы)?|билеты)\s+на\s+/iu,
  /^(?:найди|найдите|покажи|покажите|подбери|подберите)\s+(?:билеты?\s+)?на\s+/iu,
];

const OFF_TOPIC_EVENT_PROBE_PURCHASE_PATTERNS = [
  /(?:^|\s)(?:хочу\s+купить|куплю|хотел(?:а)?\s+бы\s+купить|купить|покупк|приобрести|заказать)(?:\s|$)/u,
];

const OFF_TOPIC_EVENT_PROBE_PURCHASE_EVENT_SIGNALS = [
  /(?:билет|мероприят|событи|афиш|досуг)/u,
  /(?:концерт|выступлен|спектакл|театр|постановк|опера|балет|мюзикл)/u,
  /(?:выставк|музе|галере|планетар|ст[еэ]ндап|шоу|цирк|кино|фильм)/u,
  /(?:матч|спорт|квест|экскурс|фестив|лекци|мастер[- ]?класс)/u,
];

const OFF_TOPIC_EVENT_PROBE_MATCH_STOP_WORDS = new Set([
  'в',
  'во',
  'на',
  'и',
  'а',
  'но',
  'или',
  'для',
  'про',
  'от',
  'до',
  'по',
  'из',
  'с',
  'со',
  'the',
  'and',
  'of',
]);

const SHORT_NAMED_EVENT_PROBE_VOWELS_RE = /[aeiouаеёиоуыэюя]/u;

const AMBIGUOUS_NAMED_EVENT_SLOT_NAMES = new Set(['жанр', 'жанр_музыки', 'предпочтения_жанры']);

const SENIOR_COMPANION_MARKER_SLOT_NAME = 'аудитория_спутник';

const SENIOR_COMPANION_MARKER_VALUE = 'пожилой';

const FRESH_SEARCH_CARRY_SLOT_NAMES = new Set(['город']);

const FRESH_SEARCH_VOLATILE_SLOT_NAMES = new Set([
  'поисковый_запрос',
  'контекст_события',
  'настроение',
  'жанр',
  'жанр_музыки',
  'предпочтения_жанры',
  'тип_мероприятия',
  'тип_события',
  'категория',
]);

const FRESH_SEARCH_CONTEXT_SLOT_NAMES = new Set([
  'тип_события',
  'тип_мероприятия',
  'категория',
  'category',
  'event_type',
  'предпочтения_типы_событий',
  'жанр',
  'жанр_музыки',
  'предпочтения_жанры',
  'исполнитель',
  'artist',
  'название_мероприятия',
  'поисковый_запрос',
  'дата_события',
  'время_события',
  'концерт_время',
  'цена_от',
  'цена_до',
  'бюджет',
  'возрастное_ограничение',
  'возраст_ребенка',
  'контекст_события',
  SENIOR_COMPANION_MARKER_SLOT_NAME,
  'настроение',
]);

const FRESH_SEARCH_TRIGGER_SLOT_NAMES = new Set([
  'тип_события',
  'тип_мероприятия',
  'категория',
  'category',
  'event_type',
  'предпочтения_типы_событий',
  'жанр',
  'жанр_музыки',
  'предпочтения_жанры',
  'исполнитель',
  'artist',
  'название_мероприятия',
  'возрастное_ограничение',
  'возраст_ребенка',
  'контекст_события',
  'аудитория_спутник',
  'настроение',
]);

const SLOT_LIKE_INTENT_SLOT_NAMES = new Set([
  'контекст_события',
  'возрастное_ограничение',
  'возраст_ребенка',
  'тип_мероприятия',
  'тип_события',
  'категория',
  'category',
  'event_type',
  'предпочтения_типы_событий',
  'жанр',
  'жанр_музыки',
  'предпочтения_жанры',
]);

function normalizeOffTopicEventProbeCandidate(userMessage = '') {
  const compact = String(userMessage || '')
    .replace(/[\r\n\t]+/gu, ' ')
    .replace(/[«»„“”"]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[.!?…]+$/gu, '')
    .replace(
      /^(?:я\s+)?(?:хочу|хотел(?:ось)?\s*бы|хотелось\s*бы)\s+(?:пойти\s+|сходить\s+)?(?:на\s+)?/iu,
      ''
    )
    .replace(
      /^(?:найди|найдите|покажи|покажите|подбери|подберите|ищу|интересует|интересуют)\s+(?:билеты?\s+)?(?:на\s+)?/iu,
      ''
    )
    .replace(/^на\s+/iu, '')
    .trim();

  if (!compact || compact.length > OFF_TOPIC_EVENT_PROBE_MAX_CHARS) {
    return '';
  }

  return compact;
}

function tokenizeOffTopicEventProbeCandidate(value = '') {
  const normalized = normalizeText(value)
    .replace(/[.,!?;:()[\]{}"'`«»„“”]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

  if (!normalized) {
    return [];
  }

  return normalized.split(' ').filter(Boolean);
}

function isGenericPurchaseOffTopicEventProbeCandidate(value = '') {
  const normalized = normalizeText(value);
  if (!normalized) {
    return false;
  }

  const hasPurchaseIntent = OFF_TOPIC_EVENT_PROBE_PURCHASE_PATTERNS.some((pattern) =>
    pattern.test(normalized)
  );
  if (!hasPurchaseIntent) {
    return false;
  }

  return !OFF_TOPIC_EVENT_PROBE_PURCHASE_EVENT_SIGNALS.some((pattern) => pattern.test(normalized));
}

function isLikelySingleWordNamedEventProbeCandidate(value = '') {
  const candidate = normalizeOffTopicEventProbeCandidate(value);
  if (!candidate) {
    return false;
  }

  const tokens = tokenizeOffTopicEventProbeCandidate(candidate);
  if (tokens.length !== 1) {
    return false;
  }

  const token = tokens[0];
  if (
    token.length < 3 ||
    OFF_TOPIC_EVENT_PROBE_SINGLE_WORD_REJECT_WORDS.has(token) ||
    STOP_WORDS.has(token) ||
    TRIVIAL_WORDS.has(token) ||
    NON_SPECIFIC_QUERY_WORDS.has(token) ||
    OFF_TOPIC_EVENT_PROBE_MATCH_STOP_WORDS.has(token)
  ) {
    return false;
  }

  if (!/^[\p{L}][\p{L}-]*$/u.test(candidate)) {
    return false;
  }

  if (token.length >= 4) {
    return /[\p{Lu}]/u.test(candidate[0]);
  }

  if (/^[\p{Lu}]{3,5}$/u.test(candidate)) {
    return true;
  }

  return token.length >= 3 && !SHORT_NAMED_EVENT_PROBE_VOWELS_RE.test(token);
}

function isExplicitShortNamedEventProbeCandidate(userMessage = '', candidate = '') {
  const normalizedCandidate = normalizeText(candidate);
  if (!normalizedCandidate || normalizedCandidate.length < 3 || normalizedCandidate.length > 5) {
    return false;
  }

  if (
    OFF_TOPIC_EVENT_PROBE_SINGLE_WORD_REJECT_WORDS.has(normalizedCandidate) ||
    STOP_WORDS.has(normalizedCandidate) ||
    TRIVIAL_WORDS.has(normalizedCandidate) ||
    NON_SPECIFIC_QUERY_WORDS.has(normalizedCandidate) ||
    OFF_TOPIC_EVENT_PROBE_MATCH_STOP_WORDS.has(normalizedCandidate)
  ) {
    return false;
  }

  if (!/^[\p{L}][\p{L}-]*$/u.test(candidate)) {
    return false;
  }

  return OFF_TOPIC_EVENT_PROBE_SHORT_NAMED_EVENT_PATTERNS.some((pattern) =>
    pattern.test(String(userMessage || '').trim())
  );
}

function shouldProbeOffTopicEventSearch(userMessage = '') {
  const candidate = normalizeOffTopicEventProbeCandidate(userMessage);
  if (!candidate) {
    return false;
  }

  const normalized = normalizeText(candidate);
  if (!normalized || OFF_TOPIC_EVENT_PROBE_REJECT_PHRASES.has(normalized)) {
    return false;
  }

  if (OFF_TOPIC_EVENT_PROBE_REJECT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  if (isGenericPurchaseOffTopicEventProbeCandidate(normalized)) {
    return false;
  }

  const tokens = tokenizeOffTopicEventProbeCandidate(candidate);
  if (
    tokens.length === 1 &&
    !isLikelySingleWordNamedEventProbeCandidate(candidate) &&
    !isExplicitShortNamedEventProbeCandidate(userMessage, candidate)
  ) {
    return false;
  }

  if (tokens.length !== 1 && tokens.length < OFF_TOPIC_EVENT_PROBE_MIN_WORDS) {
    return false;
  }

  if (tokens.length > OFF_TOPIC_EVENT_PROBE_MAX_WORDS) {
    return false;
  }

  const meaningfulTokens = tokens.filter(
    (token) =>
      token.length > 2 &&
      !STOP_WORDS.has(token) &&
      !TRIVIAL_WORDS.has(token) &&
      !NON_SPECIFIC_QUERY_WORDS.has(token) &&
      !OFF_TOPIC_EVENT_PROBE_MATCH_STOP_WORDS.has(token)
  );

  if (meaningfulTokens.length === 0) {
    return false;
  }

  return /[\p{L}]/u.test(candidate);
}

function buildOffTopicEventProbeSlots({ userMessage = '', currentSlots = [] } = {}) {
  const candidate = normalizeOffTopicEventProbeCandidate(userMessage);
  if (!candidate) {
    return [];
  }

  const citySlot = (Array.isArray(currentSlots) ? currentSlots : []).find(
    (slot) =>
      slot &&
      slot.name === 'город' &&
      String(slot.value || '').trim() &&
      isRussianCity(String(slot.value || '').trim())
  );
  const slots = [];

  if (citySlot) {
    slots.push(citySlot);
  }

  slots.push(
    {
      name: 'название_мероприятия',
      value: candidate,
      confidence: 0.96,
      source: 'offtopic_event_probe',
    },
    {
      name: 'поисковый_запрос',
      value: candidate,
      confidence: 0.9,
      source: 'offtopic_event_probe',
    }
  );

  return slots;
}

function normalizeOffTopicEventMatchText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»„“”"']/gu, ' ')
    .replace(/[^a-zа-я0-9]+/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function buildOffTopicEventMatchTokens(value = '') {
  return normalizeOffTopicEventMatchText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean)
    .filter(
      (token) =>
        token.length > 2 &&
        !OFF_TOPIC_EVENT_PROBE_MATCH_STOP_WORDS.has(token) &&
        !STOP_WORDS.has(token) &&
        !TRIVIAL_WORDS.has(token) &&
        !NON_SPECIFIC_QUERY_WORDS.has(token)
    );
}

function extractOffTopicProbeEventTitleCandidates(event = null) {
  if (!event || typeof event !== 'object') {
    return [];
  }

  const obj = event.object && typeof event.object === 'object' ? event.object : {};
  const activity =
    obj.activity && typeof obj.activity === 'object'
      ? obj.activity
      : event.activity && typeof event.activity === 'object'
        ? event.activity
        : {};
  const raw = event.raw && typeof event.raw === 'object' ? event.raw : {};
  const rawObj = raw.object && typeof raw.object === 'object' ? raw.object : {};
  const rawActivity =
    rawObj.activity && typeof rawObj.activity === 'object'
      ? rawObj.activity
      : raw.activity && typeof raw.activity === 'object'
        ? raw.activity
        : {};

  const candidates = [
    event.title,
    event.activityTitle,
    event.eventTitle,
    event.name,
    obj.title,
    obj.name,
    obj.activityTitle,
    activity.title,
    activity.name,
    raw.title,
    raw.name,
    raw.activityTitle,
    rawObj.title,
    rawObj.name,
    rawObj.activityTitle,
    rawActivity.title,
    rawActivity.name,
  ];

  const seen = new Set();
  return candidates
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value) => {
      const key = normalizeOffTopicEventMatchText(value);
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function offTopicProbeEventMatchesCandidate(event = null, candidate = '') {
  if (!event || typeof event !== 'object') {
    return false;
  }

  const normalizedCandidate = normalizeOffTopicEventMatchText(candidate);
  if (!normalizedCandidate) {
    return false;
  }

  const titleCandidates = extractOffTopicProbeEventTitleCandidates(event)
    .map((value) => normalizeOffTopicEventMatchText(value))
    .filter(Boolean);

  if (titleCandidates.length === 0) {
    return false;
  }

  if (
    titleCandidates.some(
      (title) => title.includes(normalizedCandidate) || normalizedCandidate.includes(title)
    )
  ) {
    return true;
  }

  const candidateTokens = buildOffTopicEventMatchTokens(candidate);
  if (candidateTokens.length === 0) {
    return false;
  }

  return titleCandidates.some((title) => {
    const titleTokens = new Set(buildOffTopicEventMatchTokens(title));
    const matchedCount = candidateTokens.filter((token) => titleTokens.has(token)).length;
    return matchedCount >= Math.max(1, Math.ceil(candidateTokens.length * 0.75));
  });
}

function summarizeOffTopicProbeEvent(event = null) {
  const obj =
    event && typeof event === 'object' && event.object && typeof event.object === 'object'
      ? event.object
      : {};
  const activity = obj.activity && typeof obj.activity === 'object' ? obj.activity : {};
  const id = obj.id ?? event?.id ?? obj.backofficeId ?? activity.id ?? null;
  const titleCandidates = extractOffTopicProbeEventTitleCandidates(event);

  return {
    id: id === null || id === undefined ? null : String(id),
    titles: titleCandidates.slice(0, 3),
  };
}

function shouldTrustSingleOffTopicProbeHit({
  candidate = '',
  events = [],
  searchResolution = null,
} = {}) {
  if (!Array.isArray(events) || events.length !== 1) {
    return false;
  }

  const normalizedCandidate = normalizeOffTopicEventMatchText(candidate);
  const candidateTokens = buildOffTopicEventMatchTokens(candidate);
  const canTrustSingleWordCandidate = isLikelySingleWordNamedEventProbeCandidate(candidate);
  if (!normalizedCandidate || (candidateTokens.length < 2 && !canTrustSingleWordCandidate)) {
    return false;
  }

  if (searchResolution?.strictQuerySuppressed) {
    return false;
  }

  const keywordCandidates = [searchResolution?.appliedKeyword, searchResolution?.requestedKeyword]
    .map((value) => normalizeOffTopicEventMatchText(value))
    .filter(Boolean);

  return keywordCandidates.some(
    (keyword) =>
      keyword === normalizedCandidate ||
      keyword.includes(normalizedCandidate) ||
      normalizedCandidate.includes(keyword)
  );
}

function findAmbiguousNamedEventSlots(slots = [], userMessage = '') {
  const candidate = normalizeOffTopicEventProbeCandidate(userMessage);
  if (!candidate || !shouldProbeOffTopicEventSearch(userMessage)) {
    return [];
  }

  const normalizedCandidate = normalizeOffTopicEventMatchText(candidate);
  const candidateTokens = buildOffTopicEventMatchTokens(candidate);

  return (Array.isArray(slots) ? slots : []).filter((slot) => {
    if (!slot || !AMBIGUOUS_NAMED_EVENT_SLOT_NAMES.has(slot.name)) {
      return false;
    }

    const slotValue = String(slot.value || '').trim();
    if (!slotValue) {
      return false;
    }

    const normalizedValue = normalizeOffTopicEventMatchText(slotValue);
    if (!normalizedValue) {
      return false;
    }

    if (normalizedValue === normalizedCandidate) {
      return true;
    }

    const valueTokens = new Set(buildOffTopicEventMatchTokens(slotValue));
    if (candidateTokens.length === 0 || valueTokens.size === 0) {
      return false;
    }

    const matchedCount = candidateTokens.filter((token) => valueTokens.has(token)).length;
    return matchedCount >= Math.max(1, Math.ceil(candidateTokens.length * 0.75));
  });
}

function replaceAmbiguousSlotsWithNamedEventSlots(
  slots = [],
  ambiguousSlots = [],
  userMessage = ''
) {
  const candidate = normalizeOffTopicEventProbeCandidate(userMessage);
  const ambiguousKeys = new Set(
    (Array.isArray(ambiguousSlots) ? ambiguousSlots : [])
      .filter((slot) => slot && slot.name)
      .map((slot) => `${slot.name}:${normalizeComparableSlotValue(slot.value)}`)
  );

  const cleanedSlots = (Array.isArray(slots) ? slots : []).filter((slot) => {
    if (!slot || !slot.name) {
      return false;
    }

    return !ambiguousKeys.has(`${slot.name}:${normalizeComparableSlotValue(slot.value)}`);
  });

  if (!candidate) {
    return cleanedSlots;
  }

  return mergeSlots(cleanedSlots, [
    {
      name: 'название_мероприятия',
      value: candidate,
      confidence: 0.96,
      source: 'event_probe_rewrite',
    },
    {
      name: 'поисковый_запрос',
      value: candidate,
      confidence: 0.9,
      source: 'event_probe_rewrite',
    },
  ]);
}

async function probeKassirEventsForOffTopicCandidate({
  userId = '',
  sessionId = '',
  userMessage = '',
  currentSlots = [],
  requestId = null,
} = {}) {
  if (!shouldProbeOffTopicEventSearch(userMessage)) {
    console.log(
      `🧭 [${userId}][${sessionId}] OFFTOPIC_EVENT_PROBE: кандидат отклонен до запроса в Kassir`,
      { trigger: userMessage }
    );
    return {
      checked: false,
      hasMatchingEvents: false,
      reason: 'candidate-rejected',
      slots: [],
      events: [],
    };
  }

  const probeSlots = buildOffTopicEventProbeSlots({ userMessage, currentSlots });
  const candidate = normalizeOffTopicEventProbeCandidate(userMessage);

  try {
    const params = buildSearchParamsFromSlots(probeSlots, candidate, candidate, userMessage);
    const aiToolsUrl = getAiToolsUrl();
    const apiKey = getAiToolsApiKey();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OFF_TOPIC_EVENT_PROBE_TIMEOUT_MS);

    console.log(
      `🧭 [${userId}][${sessionId}] OFFTOPIC_EVENT_PROBE: проверяю Kassir по названию "${candidate}" ` +
        `с параметрами ${JSON.stringify(params)}`
    );

    try {
      const response = await fetch(`${aiToolsUrl}/api/tools/kassir-api/search`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          ...params,
          page: 1,
          pageSize: 5,
          skipLlmFilter: true,
          context: {
            lastUserMessage: userMessage,
            fallbackQuery: candidate,
            slots: probeSlots,
            requestId,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.warn(
          `⚠️ [${userId}][${sessionId}] OFFTOPIC_EVENT_PROBE: AI Tools вернул ${response.status}`,
          errorData
        );
        return {
          checked: true,
          hasMatchingEvents: false,
          reason: `http-${response.status}`,
          slots: probeSlots,
          events: [],
        };
      }

      const data = await response.json();
      const events = Array.isArray(data?.data?.items) ? data.data.items : [];
      const searchResolution = data?.data?.meta?.searchResolution || null;
      let matchingEvents = events.filter((event) =>
        offTopicProbeEventMatchesCandidate(event, candidate)
      );
      let reason = matchingEvents.length > 0 ? 'matched-title' : 'no-title-match';

      if (
        matchingEvents.length === 0 &&
        shouldTrustSingleOffTopicProbeHit({ candidate, events, searchResolution })
      ) {
        matchingEvents = events;
        reason = 'single-keyword-hit';
      }

      console.log(
        `🧭 [${userId}][${sessionId}] OFFTOPIC_EVENT_PROBE: найдено ${events.length}, ` +
          `совпало по названию ${matchingEvents.length}, reason=${reason}, ` +
          `preview=${JSON.stringify(events.slice(0, 3).map((event) => summarizeOffTopicProbeEvent(event)))}`
      );

      return {
        checked: true,
        hasMatchingEvents: matchingEvents.length > 0,
        reason,
        slots: probeSlots,
        events: matchingEvents,
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    const reason = error?.name === 'AbortError' ? 'timeout' : 'error';
    console.warn(
      `⚠️ [${userId}][${sessionId}] OFFTOPIC_EVENT_PROBE: проверка не выполнена (${reason}), оставляю off_topic`,
      error
    );
    return {
      checked: true,
      hasMatchingEvents: false,
      reason,
      slots: probeSlots,
      events: [],
    };
  }
}

export {
  SIMILAR_EVENT_RESET_SLOT_NAMES,
  SENIOR_COMPANION_MARKER_SLOT_NAME,
  SENIOR_COMPANION_MARKER_VALUE,
  FRESH_SEARCH_CARRY_SLOT_NAMES,
  FRESH_SEARCH_VOLATILE_SLOT_NAMES,
  FRESH_SEARCH_CONTEXT_SLOT_NAMES,
  FRESH_SEARCH_TRIGGER_SLOT_NAMES,
  SLOT_LIKE_INTENT_SLOT_NAMES,
  isLikelySingleWordNamedEventProbeCandidate,
  shouldProbeOffTopicEventSearch,
  buildOffTopicEventProbeSlots,
  extractOffTopicProbeEventTitleCandidates,
  offTopicProbeEventMatchesCandidate,
  summarizeOffTopicProbeEvent,
  shouldTrustSingleOffTopicProbeHit,
  findAmbiguousNamedEventSlots,
  replaceAmbiguousSlotsWithNamedEventSlots,
  probeKassirEventsForOffTopicCandidate,
};
