import { normalizeForMatch, tokenizeForMatch } from './eventMatching.js';

function normalizeCommandText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .trim();
}

function isBuyTicketsCommand(userMessage) {
  const normalized = normalizeCommandText(userMessage);
  if (!normalized) return false;

  return (
    normalized === 'купить билеты' ||
    normalized === 'купить билет' ||
    normalized === 'покупка билетов' ||
    normalized === 'покупка билета' ||
    normalized === 'оформить билеты' ||
    normalized === 'оформить билет' ||
    normalized === 'перейти к покупке'
  );
}

const EVENT_REFERENCE_ORDINALS = [
  { re: /(?<![A-Za-zА-Яа-яЁё0-9_])перв(ое|ый|ую|ая)(?![A-Za-zА-Яа-яЁё0-9_])/iu, index: 0 },
  { re: /(?<![A-Za-zА-Яа-яЁё0-9_])втор(ое|ой|ую|ая)(?![A-Za-zА-Яа-яЁё0-9_])/iu, index: 1 },
  { re: /(?<![A-Za-zА-Яа-яЁё0-9_])трет(ье|ий|ью|ья)(?![A-Za-zА-Яа-яЁё0-9_])/iu, index: 2 },
  { re: /(?<![A-Za-zА-Яа-яЁё0-9_])четверт(ое|ый|ую|ая)(?![A-Za-zА-Яа-яЁё0-9_])/iu, index: 3 },
  { re: /(?<![A-Za-zА-Яа-яЁё0-9_])пят(ое|ый|ую|ая)(?![A-Za-zА-Яа-яЁё0-9_])/iu, index: 4 },
  { re: /(?<![A-Za-zА-Яа-яЁё0-9_])шест(ое|ой|ую|ая)(?![A-Za-zА-Яа-яЁё0-9_])/iu, index: 5 },
  { re: /(?<![A-Za-zА-Яа-яЁё0-9_])седьм(ое|ой|ую|ая)(?![A-Za-zА-Яа-яЁё0-9_])/iu, index: 6 },
  { re: /(?<![A-Za-zА-Яа-яЁё0-9_])восьм(ое|ой|ую|ая)(?![A-Za-zА-Яа-яЁё0-9_])/iu, index: 7 },
  { re: /(?<![A-Za-zА-Яа-яЁё0-9_])девят(ое|ый|ую|ая)(?![A-Za-zА-Яа-яЁё0-9_])/iu, index: 8 },
  { re: /(?<![A-Za-zА-Яа-яЁё0-9_])десят(ое|ый|ую|ая)(?![A-Za-zА-Яа-яЁё0-9_])/iu, index: 9 },
];

function extractEventIndexFromReference(reference, maxEvents) {
  const limit = Number.isFinite(maxEvents) && maxEvents > 0 ? maxEvents : 0;
  if (!reference || limit <= 0) return null;

  const refText = String(reference).trim();
  if (!refText) return null;

  const numericMatch = refText.match(/(\d{1,2})/u);
  if (numericMatch) {
    const parsed = Number.parseInt(numericMatch[1], 10);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= limit) {
      return parsed - 1;
    }
  }

  for (const rule of EVENT_REFERENCE_ORDINALS) {
    if (rule.re.test(refText) && rule.index >= 0 && rule.index < limit) {
      return rule.index;
    }
  }

  return null;
}

function pickEventFromReference(events, reference) {
  const list = Array.isArray(events) ? events.filter(Boolean) : [];
  if (list.length === 0) return null;

  const index = extractEventIndexFromReference(reference, list.length);
  if (index !== null && list[index]) {
    return list[index];
  }

  const normalizedRef = normalizeForMatch(reference);
  if (!normalizedRef) return null;

  // Быстрый матч по названию.
  for (const event of list) {
    const title = String(event?.title || '').trim();
    if (!title) continue;
    const normalizedTitle = normalizeForMatch(title);
    if (!normalizedTitle) continue;
    if (normalizedRef.includes(normalizedTitle) || normalizedTitle.includes(normalizedRef)) {
      return event;
    }
  }

  // Мягкий матч по токенам.
  const refTokens = tokenizeForMatch(normalizedRef);
  if (refTokens.length === 0) return null;
  const refTokenSet = new Set(refTokens);

  let best = null;
  let bestScore = 0;
  for (const event of list) {
    const title = String(event?.title || '').trim();
    if (!title) continue;
    const titleTokens = tokenizeForMatch(title);
    if (titleTokens.length === 0) continue;
    const matched = titleTokens.filter((t) => refTokenSet.has(t));
    const score = matched.length / titleTokens.length;
    if (score > bestScore) {
      bestScore = score;
      best = event;
    }
  }

  return bestScore >= 0.6 ? best : null;
}

export { isBuyTicketsCommand, pickEventFromReference };
