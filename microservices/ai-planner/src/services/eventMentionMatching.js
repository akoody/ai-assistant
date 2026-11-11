const GENERIC_EVENT_TITLE_TOKENS = new Set([
  'экскурсия',
  'программа',
  'билет',
  'билеты',
  'мероприятие',
  'пушкинская',
  'карта',
  'обзорная',
  'интерактивная',
  'интерактивно-познавательная',
  'концерт',
  'концерты',
  'спектакль',
  'спектакли',
  'выставка',
  'выставки',
  'музей',
  'музеи',
  'театр',
  'театры',
  'стендап',
  'шоу',
  'дискотека',
  'вечер',
  'вечеринка',
]);
const YEAR_LIKE_TITLE_TOKEN_REGEX = /^\d{4}$/u;

const ORDINAL_INDEX_MAP = Object.freeze({
  первый: 0,
  первое: 0,
  первую: 0,
  один: 0,
  второй: 1,
  второе: 1,
  вторую: 1,
  два: 1,
  третий: 2,
  третье: 2,
  третью: 2,
  три: 2,
  четвертый: 3,
  четвертое: 3,
  четвертую: 3,
  четвёртый: 3,
  четвёртое: 3,
  четвёртую: 3,
  четыре: 3,
  пятый: 4,
  пятое: 4,
  пятую: 4,
  пять: 4,
  шестой: 5,
  шестое: 5,
  шестую: 5,
  шесть: 5,
  седьмой: 6,
  седьмое: 6,
  седьмую: 6,
  семь: 6,
  восьмой: 7,
  восьмое: 7,
  восьмую: 7,
  восемь: 7,
  девятый: 8,
  девятое: 8,
  девятую: 8,
  девять: 8,
  десятый: 9,
  десятое: 9,
  десятую: 9,
  десять: 9,
});

function normalizeEventMatchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[\u2010\u2011\u2012\u2013\u2014]/g, '-')
    .replace(/[«»„“”"']/g, ' ')
    .replace(/[(){}\[\],.!?:;+/\\|*=_~`<>]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeEventMatchText(value) {
  const normalized = normalizeEventMatchText(value);
  if (!normalized) return [];
  return normalized
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => token.length >= 2);
}

function fuzzyTokenMatch(tokenA, tokenB) {
  if (tokenA === tokenB) return true;
  const minLen = Math.min(tokenA.length, tokenB.length);
  if (minLen < 3) return false;
  const prefixLen = Math.max(3, minLen - 2);
  return tokenA.slice(0, prefixLen) === tokenB.slice(0, prefixLen);
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function dedupeEvents(events = []) {
  const seen = new Set();
  const result = [];

  for (const event of events) {
    const title = String(event?.title || '').trim();
    const key = normalizeEventMatchText(title);
    if (!title || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(event);
  }

  return result;
}

function extractArtistReference(slotExtractionResult = null) {
  const artistSlot = Array.isArray(slotExtractionResult?.slots)
    ? slotExtractionResult.slots.find((slot) => slot && slot.name === 'исполнитель')
    : null;

  return artistSlot && typeof artistSlot.value === 'string'
    ? normalizeEventMatchText(artistSlot.value)
    : '';
}

function extractExplicitIndexes(userMessage, historyLength) {
  const trimmedMessage = String(userMessage || '').trim();
  if (!trimmedMessage) return [];

  const explicitIndexes = [];
  const explicitPattern = /(?:вариант|варианта|варианту|номер)\s*№?\s*(\d{1,2})/giu;
  for (const match of trimmedMessage.matchAll(explicitPattern)) {
    const rawIndex = Number.parseInt(match[1], 10);
    const index = rawIndex - 1;
    if (Number.isInteger(index) && index >= 0 && index < historyLength) {
      explicitIndexes.push(index);
    }
  }

  if (explicitIndexes.length > 0) {
    return [...new Set(explicitIndexes)];
  }

  const normalized = normalizeEventMatchText(trimmedMessage);
  if (!normalized) return [];

  const directNumberMatch = normalized.match(/^\d{1,2}$/u);
  if (directNumberMatch) {
    const index = Number.parseInt(directNumberMatch[0], 10) - 1;
    return index >= 0 && index < historyLength ? [index] : [];
  }

  const compactOrdinal = normalized.replace(/\s+/g, '');
  if (ORDINAL_INDEX_MAP[compactOrdinal] !== undefined) {
    const index = ORDINAL_INDEX_MAP[compactOrdinal];
    return index >= 0 && index < historyLength ? [index] : [];
  }

  if (!/^(?:\d{1,2}|[а-я]+)(?:\s*(?:,|и)\s*(?:\d{1,2}|[а-я]+))+$/u.test(normalized)) {
    return [];
  }

  const items = normalized
    .split(/\s*(?:,|и)\s*/u)
    .map((item) => item.trim())
    .filter(Boolean);

  if (items.length < 2) {
    return [];
  }

  const indexes = items
    .map((item) => {
      if (/^\d{1,2}$/u.test(item)) {
        return Number.parseInt(item, 10) - 1;
      }
      return ORDINAL_INDEX_MAP[item] ?? null;
    })
    .filter((index) => Number.isInteger(index) && index >= 0 && index < historyLength);

  return indexes.length === items.length ? [...new Set(indexes)] : [];
}

function scoreEventMention(event, messageNormalized, messageTokens, artistReference) {
  if (!event || !event.title) {
    return null;
  }

  const titleNormalized = normalizeEventMatchText(event.title);
  if (!titleNormalized) {
    return null;
  }

  const titleTokens = [...new Set(tokenizeEventMatchText(titleNormalized))];
  const cityTokens = new Set(tokenizeEventMatchText(event.city || ''));
  const specificTitleTokens = titleTokens.filter(
    (token) =>
      !GENERIC_EVENT_TITLE_TOKENS.has(token) &&
      !YEAR_LIKE_TITLE_TOKEN_REGEX.test(token) &&
      !cityTokens.has(token)
  );

  if (titleNormalized.length >= 6 && messageNormalized.includes(titleNormalized)) {
    return { event, score: 2000 + titleNormalized.length, matchKind: 'phrase' };
  }

  if (artistReference && artistReference.length >= 3 && titleNormalized.includes(artistReference)) {
    return { event, score: 1500 + artistReference.length, matchKind: 'artist' };
  }

  if (specificTitleTokens.length === 0 || messageTokens.length === 0) {
    return null;
  }

  const matchedSpecificTokens = specificTitleTokens.filter((titleToken) =>
    messageTokens.some((messageToken) => fuzzyTokenMatch(messageToken, titleToken))
  );

  if (matchedSpecificTokens.length === 0) {
    return null;
  }

  if (matchedSpecificTokens.length === 1) {
    const matchedToken = matchedSpecificTokens[0];
    const hasSingleSpecificTokenTitle = specificTitleTokens.length === 1;
    const hasWholeWordMatch = new RegExp(
      `(?:^|\\s)${escapeRegExp(matchedToken)}(?:$|\\s)`,
      'u'
    ).test(messageNormalized);

    if (!hasSingleSpecificTokenTitle && !(matchedToken.length >= 6 && hasWholeWordMatch)) {
      return null;
    }
  }

  const allSpecificMatched = matchedSpecificTokens.length === specificTitleTokens.length;
  let score = matchedSpecificTokens.length * 100 + titleTokens.length;

  if (allSpecificMatched) {
    score += 300;
  }

  if (specificTitleTokens.length === 1) {
    score += 50;
  }

  return { event, score, matchKind: 'tokens' };
}

export function findMentionedEvents(historyEvents, userMessage, slotExtractionResult = null) {
  if (!Array.isArray(historyEvents) || historyEvents.length === 0 || !userMessage) {
    return [];
  }

  const explicitIndexes = extractExplicitIndexes(userMessage, historyEvents.length);
  if (explicitIndexes.length > 0) {
    return explicitIndexes.map((index) => historyEvents[index]).filter(Boolean);
  }

  const messageNormalized = normalizeEventMatchText(userMessage);
  const messageTokens = tokenizeEventMatchText(userMessage);
  const artistReference = extractArtistReference(slotExtractionResult);

  if (!messageNormalized || messageTokens.length === 0) {
    return [];
  }

  const matches = historyEvents
    .map((event) => scoreEventMention(event, messageNormalized, messageTokens, artistReference))
    .filter((match) => match && match.score >= 120)
    .sort((left, right) => right.score - left.score);

  return dedupeEvents(matches.map((match) => match.event));
}

export function findMentionedEvent(historyEvents, userMessage, slotExtractionResult = null) {
  return findMentionedEvents(historyEvents, userMessage, slotExtractionResult)[0] || null;
}

export const __testUtils = Object.freeze({
  normalizeEventMatchText,
  tokenizeEventMatchText,
  extractExplicitIndexes,
});
