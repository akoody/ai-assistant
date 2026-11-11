import {
  pickNonEmptyString,
  DESCRIPTION_SUMMARY_MAX_LEN,
  DESCRIPTION_SUMMARY_ELLIPSIS_THRESHOLD,
  DISPLAY_DESCRIPTION_MAX_LEN,
  EVENT_DETAILS_CACHE_TTL,
  DESCRIPTION_REWRITE_TIMEOUT_MS,
} from './offerSupport.js';
import { createHash } from 'node:crypto';
import {
  getAiGatewayApiKey,
  getAiGatewayUrl,
  getAiToolsUrl,
  getAiToolsApiKey,
} from '../configService.js';
import { getCache, setCache } from '../cacheService.js';
import { MAX_EVENTS_PER_OFFER } from './searchDefinitions.js';

function extractAgeRestrictionFromText(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const text = candidate;
    if (!text) continue;

    // Ищем паттерны вида "12+" / "12 +" / "12+."
    const match = text.match(/(^|[^\d])(\d{1,2})\s*\+(\b|[^0-9])/u);
    if (!match) continue;

    const parsed = Number(match[2]);
    if (!Number.isFinite(parsed)) continue;
    if (parsed < 0 || parsed > 21) continue;

    return `${parsed}+`;
  }

  return null;
}

function buildActivityDescriptionIndexFromPageKit(rawData) {
  const index = new Map();
  const items = rawData?.kit?.searchResult?.items;
  if (!Array.isArray(items)) {
    return index;
  }

  items.forEach((item) => {
    if (!item || typeof item !== 'object' || item.type !== 'activity') return;
    const obj = item.object;
    if (!obj || typeof obj !== 'object') return;
    const id = obj.id;
    const description = pickNonEmptyString(obj.description, obj.techDescription);
    if (!id || !description) return;
    index.set(id, description);
  });

  return index;
}

function stripHtmlPreservingBreaks(html) {
  const source = typeof html === 'string' ? html : '';
  if (!source) return '';

  return source
    .replace(/<\s*br\s*\/?\s*>/giu, '\n')
    .replace(/<\/\s*p\s*>/giu, '\n')
    .replace(/<\/\s*li\s*>/giu, '\n')
    .replace(/<\/\s*div\s*>/giu, '\n')
    .replace(/<[^>]*>/g, '')
    .trim();
}

function normalizeTextForSummary(text) {
  const source = typeof text === 'string' ? text : '';
  if (!source) return '';
  return source
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/([.!?])([A-ZА-ЯЁ])/gu, '$1 $2')
    .trim();
}

function pickBestDescriptionSnippet(text) {
  const normalized = normalizeTextForSummary(text);
  if (!normalized) return null;

  const paragraphs = normalized
    .split(/\n{2,}|\n/u)
    .map((p) => p.trim())
    .filter(Boolean);

  const candidates = paragraphs.length > 0 ? paragraphs : [normalized];

  const scoreParagraph = (value) => {
    const p = String(value || '').trim();
    if (!p) return -Infinity;

    let letters = 0;
    let digits = 0;
    let commas = 0;
    let parens = 0;
    let colons = 0;
    let slashes = 0;

    for (const ch of p) {
      if (ch >= '0' && ch <= '9') digits += 1;
      if (ch === ',') commas += 1;
      if (ch === '(' || ch === ')') parens += 1;
      if (ch === ':' || ch === ';') colons += 1;
      if (ch === '/' || ch === '\\') slashes += 1;
      if (
        (ch >= 'A' && ch <= 'Z') ||
        (ch >= 'a' && ch <= 'z') ||
        (ch >= 'А' && ch <= 'я') ||
        ch === 'Ё' ||
        ch === 'ё'
      ) {
        letters += 1;
      }
    }

    const len = Math.max(1, p.length);
    const letterRatio = letters / len;
    const digitRatio = digits / len;
    const parenRatio = parens / len;
    const commaRatio = commas / len;
    const colonRatio = colons / len;
    const slashRatio = slashes / len;

    const words = p.split(/\s+/u).filter(Boolean);
    const wordCount = words.length;
    const avgWordLen = wordCount > 0 ? letters / wordCount : 0;

    return (
      letterRatio * 3 +
      Math.min(1.5, avgWordLen / 6) +
      Math.min(1.0, wordCount / 40) -
      parenRatio * 6 -
      commaRatio * 4 -
      colonRatio * 2 -
      digitRatio * 4 -
      slashRatio * 6
    );
  };

  let best = null;
  let bestScore = -Infinity;
  for (const p of candidates) {
    const score = scoreParagraph(p);
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }

  if (!best) return null;

  const sentences = best
    .split(/(?<=[.!?])\s+/u)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => s.split(/\s+/u).filter(Boolean).length >= 6);

  const picked = (sentences.length > 0 ? sentences.slice(0, 2).join(' ') : best).trim();
  return picked || null;
}

function decodeHtmlEntities(text) {
  if (!text || typeof text !== 'string') {
    return text;
  }

  const entityMap = {
    '&laquo;': '«',
    '&raquo;': '»',
    '&ldquo;': '“',
    '&rdquo;': '”',
    '&lsquo;': '‘',
    '&rsquo;': '’',
    '&quot;': '"',
    '&apos;': "'",
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&mdash;': '—',
    '&ndash;': '–',
    '&nbsp;': ' ',
    '&hellip;': '…',
    '&copy;': '©',
    '&reg;': '®',
    '&trade;': '™',
    '&euro;': '€',
    '&pound;': '£',
    '&yen;': '¥',
    '&cent;': '¢',
  };

  // Сначала декодируем именованные сущности
  let decoded = text;
  for (const [entity, char] of Object.entries(entityMap)) {
    decoded = decoded.replace(new RegExp(entity, 'gi'), char);
  }

  // Затем декодируем числовые сущности (&#123; и &#x1F;)
  decoded = decoded.replace(/&#(\d+);/g, (match, num) => {
    return String.fromCharCode(parseInt(num, 10));
  });

  decoded = decoded.replace(/&#x([0-9A-Fa-f]+);/g, (match, hex) => {
    return String.fromCharCode(parseInt(hex, 16));
  });

  return decoded;
}

function truncateTextSmart(text, maxLen) {
  const value = typeof text === 'string' ? text.trim() : '';
  if (!value) return null;
  if (!Number.isFinite(maxLen) || maxLen <= 0) return value;
  if (value.length <= maxLen) return value;

  const head = value.slice(0, maxLen).trimEnd();
  // Prefer sentence boundary, then word boundary.
  const sentenceBoundary = head.search(/[.!?…]\s*$/u) !== -1 ? head.length : -1;
  if (sentenceBoundary > 0) {
    return head;
  }

  const lastBoundary = Math.max(
    head.lastIndexOf(' '),
    head.lastIndexOf('\n'),
    head.lastIndexOf('\t'),
    head.lastIndexOf('—'),
    head.lastIndexOf('-')
  );

  // If we can't find a boundary (e.g. one huge token), fall back to hard cut.
  const trimmed = lastBoundary > 40 ? head.slice(0, lastBoundary).trimEnd() : head;
  return trimmed;
}

function setHiddenEventMeta(event, key, value) {
  if (!event || typeof event !== 'object') {
    return;
  }

  Object.defineProperty(event, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

function getEventDescriptionSource(event) {
  if (!event || typeof event !== 'object') {
    return '';
  }

  const value = event.__descriptionSource;
  return typeof value === 'string' ? value : '';
}

function setEventDescriptionSource(event, value) {
  const normalized = normalizeTextForSummary(value);
  if (!normalized) {
    return;
  }

  setHiddenEventMeta(event, '__descriptionSource', normalized);
}

function tokenizeText(value) {
  return (
    String(value || '')
      .toLowerCase()
      .match(/[a-zа-яё0-9]+/giu) || []
  );
}

function isPlaceholderEventDescription(description, event = null) {
  const normalized = normalizeTextForSummary(String(description || ''));
  if (!normalized) {
    return true;
  }

  const lower = normalized.toLowerCase();
  if (
    /^событие\s+[«"]?.+?[»"]?\s+на\s+площадке\s+[«"]?.+?[»"]?\.?$/u.test(lower) ||
    /^событие\s+[«"]?.+?[»"]?\.?$/u.test(lower) ||
    /^концерт\s+[«"]?.+?[»"]?\s+на\s+площадке\s+[«"]?.+?[»"]?\.?$/u.test(lower)
  ) {
    return true;
  }

  const titleTokens = tokenizeText(event?.title).filter((token) => token.length > 2);
  if (titleTokens.length === 0) {
    return false;
  }

  const descriptionTokens = new Set(tokenizeText(lower));
  const matchedTitleTokens = titleTokens.filter((token) => descriptionTokens.has(token));
  const wordsCount = lower.split(/\s+/u).filter(Boolean).length;

  return (
    wordsCount <= 12 &&
    matchedTitleTokens.length >= Math.max(2, Math.ceil(titleTokens.length * 0.6))
  );
}

function extractMeaningfulDescriptionData(rawDescriptionCandidate, event = null) {
  if (!rawDescriptionCandidate) {
    return {
      source: null,
      summary: null,
    };
  }

  const withBreaks = stripHtmlPreservingBreaks(rawDescriptionCandidate);
  const clean = decodeHtmlEntities(withBreaks);
  const normalized = normalizeTextForSummary(clean);

  if (!normalized || isPlaceholderEventDescription(normalized, event)) {
    return {
      source: null,
      summary: null,
    };
  }

  const snippet = pickBestDescriptionSnippet(normalized);
  const description = snippet || normalized;
  const truncated = truncateTextSmart(description, DESCRIPTION_SUMMARY_MAX_LEN);
  if (!truncated) {
    return {
      source: normalized,
      summary: null,
    };
  }

  return {
    source: normalized,
    summary: `${truncated}${description.length > DESCRIPTION_SUMMARY_ELLIPSIS_THRESHOLD ? '...' : ''}`,
  };
}

function extractDescriptionFromEventPayload(payload, event = null) {
  const candidates = [
    payload?.description,
    payload?.techDescription,
    payload?.object?.description,
    payload?.object?.techDescription,
    payload?.object?.activity?.description,
    payload?.object?.activity?.techDescription,
    payload?.activity?.description,
    payload?.activity?.techDescription,
  ];

  for (const candidate of candidates) {
    const meaningful = extractMeaningfulDescriptionData(candidate, event);
    if (meaningful.summary) {
      return meaningful;
    }
  }

  return {
    source: null,
    summary: null,
  };
}

function extractJsonArrayFromText(text) {
  const source = String(text || '').trim();
  if (!source) {
    return null;
  }

  const normalized = source
    .replace(/^```(?:json)?\s*/iu, '')
    .replace(/\s*```$/u, '')
    .trim();

  try {
    const parsed = JSON.parse(normalized);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (Array.isArray(parsed?.items)) {
      return parsed.items;
    }
    if (Array.isArray(parsed?.data)) {
      return parsed.data;
    }
    if (Array.isArray(parsed?.descriptions)) {
      return parsed.descriptions;
    }
    return null;
  } catch (_error) {
    // noop
  }

  const start = normalized.indexOf('[');
  const end = normalized.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  try {
    const parsed = JSON.parse(normalized.slice(start, end + 1));
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (Array.isArray(parsed?.items)) {
      return parsed.items;
    }
    if (Array.isArray(parsed?.data)) {
      return parsed.data;
    }
    if (Array.isArray(parsed?.descriptions)) {
      return parsed.descriptions;
    }
    return null;
  } catch (_error) {
    return null;
  }
}

function sanitizeRewrittenDescriptionCandidate(value, maxLen = DISPLAY_DESCRIPTION_MAX_LEN) {
  let normalized = normalizeTextForSummary(
    decodeHtmlEntities(stripHtmlPreservingBreaks(String(value || '')))
  );
  if (!normalized) {
    return null;
  }

  normalized = normalized
    .replace(/^описание\s*(?::|—|–|-)\s*/iu, '')
    .replace(/^["'«“„]+/u, '')
    .replace(/["'»”]+$/u, '')
    .trim();

  if (!normalized) {
    return null;
  }

  if (normalized.length > maxLen) {
    normalized = truncateTextSmart(normalized, maxLen) || '';
  }

  normalized = normalized.trim();
  if (!normalized || normalized.length > maxLen) {
    return null;
  }

  if (!/[.!?…]$/u.test(normalized) && normalized.length + 1 <= maxLen) {
    normalized = `${normalized}.`;
  }

  return normalized;
}

function shouldRewriteDescriptionForDisplay(event, maxLen = DISPLAY_DESCRIPTION_MAX_LEN) {
  const current = normalizeTextForSummary(event?.description || '');
  if (!current) {
    return false;
  }

  const source = getEventDescriptionSource(event) || current;
  return source.length > maxLen || /(?:\.{3}|…)\s*$/u.test(String(event?.description || ''));
}

function buildDescriptionRewriteCacheKey(event, maxLen = DISPLAY_DESCRIPTION_MAX_LEN) {
  const source =
    getEventDescriptionSource(event) || normalizeTextForSummary(event?.description || '');
  if (!source) {
    return '';
  }

  const sourceHash = createHash('md5').update(source).digest('hex');
  const eventKey = event?.id || event?.url || event?.title || 'event';
  return `event_description_rewrite:${eventKey}:${maxLen}:${sourceHash}`;
}

async function rewriteLongEventDescriptionsForDisplay(
  events = [],
  { maxLen = DISPLAY_DESCRIPTION_MAX_LEN } = {}
) {
  const list = Array.isArray(events) ? events : [];
  if (list.length === 0) {
    return events;
  }

  const aiGatewayUrl = getAiGatewayUrl();
  const apiKey = getAiGatewayApiKey();
  if (!aiGatewayUrl || !apiKey) {
    return events;
  }

  const pending = [];

  list.forEach((event, index) => {
    if (!shouldRewriteDescriptionForDisplay(event, maxLen)) {
      return;
    }

    const cacheKey = buildDescriptionRewriteCacheKey(event, maxLen);
    const cached = cacheKey ? getCache(cacheKey) : null;
    if (typeof cached === 'string' && cached.trim()) {
      event.description = cached;
      return;
    }

    const source =
      getEventDescriptionSource(event) || normalizeTextForSummary(event?.description || '');
    if (!source) {
      return;
    }

    pending.push({
      event,
      index,
      cacheKey,
      source,
    });
  });

  if (pending.length === 0) {
    return events;
  }

  const systemPrompt =
    `Ты редактируешь описания событий для афиши.\n` +
    `Нужно переписать КАЖДОЕ описание так, чтобы оно помещалось в ${maxLen} символов включая пробелы.\n\n` +
    `Правила:\n` +
    `1. Используй только факты из исходного описания и карточки события.\n` +
    `2. Ничего не выдумывай и не добавляй новых деталей.\n` +
    `3. Пиши по-русски, естественно, законченной мыслью, 1-2 короткими предложениями.\n` +
    `4. Не копируй текст механически, если он плохо обрезан или звучит тяжело.\n` +
    `5. Не используй фразы вроде "Уточните", "Подробнее", "Это мероприятие", "Описание".\n` +
    `6. Верни строго JSON-массив объектов формата [{"index":1,"description":"..."}].\n` +
    `7. Для каждого объекта description обязателен и не длиннее ${maxLen} символов.\n`;

  const payload = pending.map(({ event, index, source }) => ({
    index,
    title: event?.title || null,
    venue: event?.venue || null,
    category: event?.category || null,
    extraCategories: Array.isArray(event?.extraCategories) ? event.extraCategories : [],
    sourceDescription: source,
  }));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DESCRIPTION_REWRITE_TIMEOUT_MS);

  try {
    const response = await fetch(`${aiGatewayUrl}/api/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'planner',
        temperature: 0.2,
        max_tokens: Math.min(1200, Math.max(250, pending.length * 180)),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify(payload, null, 2) },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`description rewrite failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const rawContent = data?.choices?.[0]?.message?.content || '';
    const parsed = extractJsonArrayFromText(rawContent);
    if (!parsed) {
      console.warn(
        '⚠️ [offerService] LLM не вернула корректный JSON-массив для переписывания описаний'
      );
      return events;
    }

    let rewrittenCount = 0;

    parsed.forEach((item) => {
      const index = Number(item?.index);
      if (!Number.isInteger(index)) {
        return;
      }

      const target = pending.find((entry) => entry.index === index);
      if (!target) {
        return;
      }

      const sanitized = sanitizeRewrittenDescriptionCandidate(item?.description, maxLen);
      if (!sanitized) {
        return;
      }

      target.event.description = sanitized;
      if (target.cacheKey) {
        setCache(target.cacheKey, sanitized, EVENT_DETAILS_CACHE_TTL);
      }
      rewrittenCount += 1;
    });

    if (rewrittenCount > 0) {
      console.log(
        `🪄 [offerService] LLM адаптировала описания под лимит: ${rewrittenCount}/${pending.length}`
      );
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      console.warn('⚠️ [offerService] Таймаут при переписывании длинных описаний через LLM');
    } else {
      console.warn('⚠️ [offerService] Не удалось переписать длинные описания через LLM:', error);
    }
  } finally {
    clearTimeout(timeoutId);
  }

  return events;
}

function getEventDomain(event, fallbackDomain = 'msk.kassir.ru') {
  const url = String(event?.url || '').trim();
  if (url) {
    try {
      return new URL(url).host || fallbackDomain;
    } catch (_error) {
      return fallbackDomain;
    }
  }

  return fallbackDomain;
}

async function enrichEventsWithDetailedDescriptions(
  events = [],
  { domain = 'msk.kassir.ru' } = {}
) {
  if (!Array.isArray(events) || events.length === 0) {
    return events;
  }

  const aiToolsUrl = getAiToolsUrl();
  const apiKey = getAiToolsApiKey();
  if (!aiToolsUrl || !apiKey) {
    return events;
  }

  const eventsToEnrich = events
    .filter((event) => event?.id && isPlaceholderEventDescription(event?.description, event))
    .slice(0, MAX_EVENTS_PER_OFFER);

  if (eventsToEnrich.length === 0) {
    return events;
  }

  let enrichedCount = 0;

  await Promise.allSettled(
    eventsToEnrich.map(async (event) => {
      const eventDomain = getEventDomain(event, domain);
      const cacheKey = `event_details_description:${event.id}:${eventDomain}`;
      const cachedDescription = getCache(cacheKey);
      if (cachedDescription) {
        if (typeof cachedDescription === 'string') {
          event.description = cachedDescription;
        } else if (cachedDescription && typeof cachedDescription === 'object') {
          event.description = cachedDescription.summary || event.description;
          setEventDescriptionSource(event, cachedDescription.source || '');
        }
        enrichedCount += 1;
        return;
      }

      const response = await fetch(`${aiToolsUrl}/api/tools/kassir-api/event`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: event.id,
          domain: eventDomain,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(
          `detail fetch failed for event ${event.id}: ${response.status} ${errorText}`
        );
      }

      const payload = await response.json();
      const detailedDescription = extractDescriptionFromEventPayload(
        payload?.data ?? payload,
        event
      );
      if (!detailedDescription.summary) {
        return;
      }

      event.description = detailedDescription.summary;
      setEventDescriptionSource(event, detailedDescription.source || '');
      setCache(cacheKey, detailedDescription, EVENT_DETAILS_CACHE_TTL);
      enrichedCount += 1;
    })
  );

  if (enrichedCount > 0) {
    console.log(
      `📝 [offerService] Обогатил описания событий через detail endpoint: ${enrichedCount}/${eventsToEnrich.length}`
    );
  }

  return events;
}

export {
  extractAgeRestrictionFromText,
  buildActivityDescriptionIndexFromPageKit,
  setEventDescriptionSource,
  extractMeaningfulDescriptionData,
  sanitizeRewrittenDescriptionCandidate,
  shouldRewriteDescriptionForDisplay,
  rewriteLongEventDescriptionsForDisplay,
  enrichEventsWithDetailedDescriptions,
};
