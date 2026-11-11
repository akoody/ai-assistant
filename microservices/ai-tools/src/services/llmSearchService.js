import { readFileSync } from 'fs';
import { join } from 'path';
import { Agent } from 'undici';
import { getAiGatewayUrl, getAiGatewayApiKey } from './configService.js';

let cachedQueryPrompt = null;
let cachedFilterPrompt = null;
const LONG_TIMEOUT_AGENT = new Agent({ headersTimeout: 90000, bodyTimeout: 90000 });
const SEARCH_QUERY_TIMEOUT_MS = 15000;
const SEARCH_FILTER_TIMEOUT_MS = 12000;
const MAX_QUERY_HISTORY_ITEMS = 6;
const MAX_FILTER_HISTORY_ITEMS = 4;
const MAX_HISTORY_CONTENT_CHARS = 320;
const MAX_QUERY_PAYLOAD_CHARS = 10000;
const MAX_FILTER_PAYLOAD_CHARS = 16000;
const MAX_HISTORY_BUTTONS = 4;
const MAX_CANDIDATE_EVENTS_FOR_LLM_FILTER = 18;
const MAX_CANDIDATE_EVENT_CATEGORIES = 4;
const MAX_CANDIDATE_TITLE_CHARS = 120;
const MAX_CANDIDATE_DESCRIPTION_CHARS = 220;
const MAX_ALREADY_SHOWN_EVENTS = 12;

function normalizeInlineText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateInlineText(value = '', maxLength = MAX_HISTORY_CONTENT_CHARS) {
  const normalized = normalizeInlineText(value);
  if (!normalized) {
    return '';
  }

  if (!Number.isFinite(maxLength) || maxLength <= 0 || normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function compactHistoryEntry(entry = {}, contentLimit = MAX_HISTORY_CONTENT_CHARS) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const role = entry.role === 'assistant' ? 'assistant' : 'user';
  const content = truncateInlineText(entry.content || entry.message || '', contentLimit);
  const rawButtons = Array.isArray(entry?.metadata?.buttons) ? entry.metadata.buttons : [];
  const buttons = rawButtons
    .map((button) => truncateInlineText(button, 60))
    .filter(Boolean)
    .slice(0, MAX_HISTORY_BUTTONS);

  if (!content && buttons.length === 0) {
    return null;
  }

  const compactEntry = { role };
  if (content) {
    compactEntry.content = content;
  }
  if (buttons.length > 0) {
    compactEntry.buttons = buttons;
  }

  return compactEntry;
}

function compactHistory(
  history = [],
  { limit = MAX_QUERY_HISTORY_ITEMS, contentLimit = MAX_HISTORY_CONTENT_CHARS } = {}
) {
  if (!Array.isArray(history) || history.length === 0) {
    return [];
  }

  return history
    .slice(-Math.max(0, limit))
    .map((entry) => compactHistoryEntry(entry, contentLimit))
    .filter(Boolean);
}

function compactCandidateEvent(
  event = {},
  index = 0,
  descriptionLimit = MAX_CANDIDATE_DESCRIPTION_CHARS
) {
  const normalizedCategories = [
    ...(Array.isArray(event.categories) ? event.categories : []),
    ...(Array.isArray(event.object?.categories) ? event.object.categories : []),
    ...(event.category ? [event.category] : []),
    ...(Array.isArray(event.extraCategories) ? event.extraCategories : []),
  ]
    .map((category) => truncateInlineText(category, 40))
    .filter(Boolean)
    .slice(0, MAX_CANDIDATE_EVENT_CATEGORIES);

  return {
    index,
    title: truncateInlineText(
      event.title || event.object?.title || event.activity?.title || 'Без названия',
      MAX_CANDIDATE_TITLE_CHARS
    ),
    activityTitle: truncateInlineText(
      event.activityTitle || event.activity?.title || null,
      MAX_CANDIDATE_TITLE_CHARS
    ),
    description: truncateInlineText(
      event.description || event.object?.description || '',
      descriptionLimit
    ),
    categories: normalizedCategories,
    date: truncateInlineText(event.date || event.dateDisplay || event.object?.date || null, 80),
    time: truncateInlineText(event.time || null, 40),
    datesText: truncateInlineText(event.datesText || null, 120),
    venue: truncateInlineText(event.venue || event.object?.venue || null, 100),
    city: truncateInlineText(event.city || event.object?.city || null, 60),
    priceMin: event.priceMin ?? event.object?.priceMin ?? null,
    priceMax: event.priceMax ?? event.object?.priceMax ?? null,
  };
}

function compactShownEvent(event = {}, index = 0) {
  return {
    index,
    title: truncateInlineText(event?.title || event?.name || '', 120),
    date: truncateInlineText(event?.date || event?.dateStart || null, 80),
    time: truncateInlineText(event?.time || null, 40),
    venue: truncateInlineText(
      event?.venue?.title || event?.venue?.name || event?.venue || null,
      100
    ),
    city: truncateInlineText(event?.city || null, 60),
  };
}

function buildSearchPayloadPreview(payload = {}) {
  try {
    return JSON.stringify(payload);
  } catch (_error) {
    return '';
  }
}

function isPayloadTooLarge(payload = {}, maxChars = MAX_FILTER_PAYLOAD_CHARS) {
  return buildSearchPayloadPreview(payload).length > maxChars;
}

function readPrompt(filename, fallback) {
  try {
    const promptPath = join(process.cwd(), 'prompts', filename);
    const content = readFileSync(promptPath, 'utf-8');
    if (content && content.trim().length > 0) {
      return content;
    }
  } catch (error) {
    console.warn(
      `[llmSearchService] Не удалось прочитать промпт ${filename}, используется дефолтный`,
      error.message
    );
  }
  return fallback;
}

function getSearchQueryPrompt() {
  if (!cachedQueryPrompt) {
    cachedQueryPrompt = readPrompt(
      'searchQueryPrompt.txt',
      `Ты — аналитик сервиса билетов. Твоя задача: по истории диалога и последнему сообщению сформировать корректный поисковый запрос для Kassir.ru.

Формат ответа строго в JSON, без пояснений:
{
  "intent": "artist|category|mood|generic|unknown",
  "searchQuery": "строка для поиска",
  "category": "название категории или null",
  "reason": "краткое объяснение"
}

Правила:
- Если запрос про конкретного артиста, верни точное имя в searchQuery (intent=artist).
- Если запрос про категорию из списка (Образование, Выставки, Музеи, Экскурсии, Стендап, Концерт, Театр, Шоу, Спорт, Детям, Фестивали, Кино, Туристам, Распродажа), установи intent=category и searchQuery = название категории без дополнительных слов.
- Если пользователь описывает настроение, подбери подходящую категорию (intent=mood) и установи searchQuery в название категории.
- Если запрос непонятен, но есть fallback, используй его (intent=generic).
- Никогда не добавляй лишних слов (привет, пожалуйста, и т.п.) в searchQuery.
- Возвращай только JSON с перечисленными полями.`
    );
  }
  return cachedQueryPrompt;
}

function getResultFilterPrompt() {
  if (!cachedFilterPrompt) {
    cachedFilterPrompt = readPrompt(
      'searchResultFilterPrompt.txt',
      `Ты — помощник, который отбирает события Kassir.ru под настроение или расплывчатый запрос пользователя.

Вход будет содержать:
- intent (значения: mood, generic, artist, category, unknown).
- последний запрос пользователя и несколько реплик истории.
- список событий (index, title, description, categories, price, city).
- alreadyShownEvents — ранее показанные мероприятия (title, date, venue). Их нельзя предлагать снова.

Даже если intent = artist или category, всё равно оцени кандидатов и исключи повторы.
Для intent = mood/generic/unknown выбери максимум maxSelections событий, которые лучше всего подходят запросу и истории.
Если все события уже показывались или не подходят, верни пустой список.

Формат ответа строго JSON:
{
  "selectedIndexes": [0, 2, 5],
  "comment": "пояснение"
}

Где selectedIndexes — массив индексов (из входного списка). comment — короткое пояснение (может быть пустым).
Не включай в selectedIndexes события, описанные в alreadyShownEvents (сравни по названию/дате/площадке). Если ничего подходящего не осталось, верни [].

Не добавляй ничего, кроме JSON.`
    );
  }
  return cachedFilterPrompt;
}

function resolveTimeoutMsByLabel(label = 'search') {
  switch (label) {
    case 'search-filter':
      return SEARCH_FILTER_TIMEOUT_MS;
    case 'search-query':
      return SEARCH_QUERY_TIMEOUT_MS;
    default:
      return 15000;
  }
}

async function callAiGateway(messages, label = 'search') {
  const url = getAiGatewayUrl();
  const apiKey = getAiGatewayApiKey();
  const timeoutMs = resolveTimeoutMsByLabel(label);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${url}/api/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages,
        type: 'ai-tools',
      }),
      signal: controller.signal,
      dispatcher: LONG_TIMEOUT_AGENT,
    });

    clearTimeout(timeoutId);

    const contentType = response?.headers?.get?.('content-type') || '';
    const bodyText = await response.text();
    let data = null;
    try {
      data = JSON.parse(bodyText);
    } catch (_error) {
      // ignore
    }

    if (!response.ok) {
      const errorMessage = data?.error || data?.message || response.statusText;
      const snippet = String(bodyText || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 240);
      const hint = snippet && snippet[0] === '<' ? ' (похоже на HTML-страницу)' : '';
      throw new Error(
        `[llmSearchService] Ошибка AI Gateway (${label}): ${response.status} - ${errorMessage || 'Unknown error'}. ` +
          `Content-Type: ${contentType || 'unknown'}${hint}. Body: ${snippet || '[empty]'}`
      );
    }

    if (!data) {
      const snippet = String(bodyText || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 240);
      const hint = snippet && snippet[0] === '<' ? ' (похоже на HTML-страницу)' : '';
      throw new Error(
        `[llmSearchService] AI Gateway (${label}) вернул некорректный JSON. ` +
          `Content-Type: ${contentType || 'unknown'}${hint}. Body: ${snippet || '[empty]'}`
      );
    }

    return data.choices?.[0]?.message?.content || '';
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`[llmSearchService] Таймаут AI Gateway (${label}, ${timeoutMs}ms)`);
    }
    throw error;
  }
}

function parseJsonResponse(rawContent, fallback) {
  if (!rawContent || typeof rawContent !== 'string') {
    return fallback;
  }

  const cleaned = rawContent
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    return { ...fallback, ...parsed };
  } catch (error) {
    console.warn(
      '[llmSearchService] Не удалось распарсить JSON, используется fallback:',
      error.message
    );
    return fallback;
  }
}

export async function generateSearchQuery({
  history = [],
  lastUserMessage = '',
  fallbackQuery = '',
  slots = [],
}) {
  try {
    const prompt = getSearchQueryPrompt();
    const limitedHistory = compactHistory(history, {
      limit: MAX_QUERY_HISTORY_ITEMS,
      contentLimit: MAX_HISTORY_CONTENT_CHARS,
    });
    const payload = {
      lastUserMessage: truncateInlineText(lastUserMessage, 240),
      fallbackQuery: truncateInlineText(fallbackQuery, 160),
      history: limitedHistory,
      slots: slots.map((slot) => ({ name: slot.name, value: slot.value })),
    };

    if (isPayloadTooLarge(payload, MAX_QUERY_PAYLOAD_CHARS)) {
      console.warn(
        `[llmSearchService] Пропускаю generateSearchQuery: payload слишком большой (${buildSearchPayloadPreview(payload).length} chars)`
      );
      return {
        intent: 'generic',
        searchQuery: '',
        category: null,
        reason: 'payload-too-large',
        raw: null,
      };
    }

    const messages = [
      { role: 'system', content: prompt },
      { role: 'user', content: JSON.stringify(payload, null, 2) },
    ];

    const raw = await callAiGateway(messages, 'search-query');
    const result = parseJsonResponse(raw, {
      intent: 'generic',
      searchQuery: '',
      category: null,
      reason: '',
    });

    result.intent = result.intent || 'generic';
    result.searchQuery = (result.searchQuery || '').trim();
    if (result.category) {
      result.category = String(result.category).trim();
    }

    if (result.intent !== 'artist' && /[a-z]/i.test(result.searchQuery)) {
      result.searchQuery = '';
      result.category = result.category && /[а-яё]/i.test(result.category) ? result.category : null;
      result.reason = `${result.reason || ''} (non-cyrillic stripped)`.trim();
    }

    return {
      ...result,
      raw,
    };
  } catch (error) {
    console.error('[llmSearchService] Ошибка генерации поискового запроса:', error);
    return {
      intent: 'generic',
      searchQuery: '',
      category: null,
      reason: 'fallback',
      raw: null,
    };
  }
}

export async function filterEventsByContext({
  events = [],
  intent = 'generic',
  context = null,
  mood = null,
  lastUserMessage = '',
  history = [],
  slots = [],
  alreadyShownEvents = [],
  maxSelections = 6,
}) {
  if (!Array.isArray(events) || events.length === 0) {
    return {
      selectedIndexes: [],
      comment: 'empty-events',
      raw: null,
    };
  }

  try {
    const prompt = getResultFilterPrompt();
    const limitedHistory = compactHistory(history, {
      limit: MAX_FILTER_HISTORY_ITEMS,
      contentLimit: MAX_HISTORY_CONTENT_CHARS,
    });
    let candidateEvents = events
      .slice(0, MAX_CANDIDATE_EVENTS_FOR_LLM_FILTER)
      .map((event, index) => compactCandidateEvent(event, index, MAX_CANDIDATE_DESCRIPTION_CHARS));

    let alreadyShownSummaries = (alreadyShownEvents || [])
      .slice(0, MAX_ALREADY_SHOWN_EVENTS)
      .map((event, index) => compactShownEvent(event, index))
      .filter((summary) => Boolean(summary.title || summary.date || summary.venue));

    const payload = {
      intent,
      context,
      mood,
      maxSelections,
      lastUserMessage: truncateInlineText(lastUserMessage, 240),
      history: limitedHistory,
      slots: (Array.isArray(slots) ? slots : []).map((slot) => ({
        name: slot?.name || '',
        value: slot?.value ?? null,
        parsedDate: slot?.parsedDate || null,
        dateRange: slot?.dateRange || null,
        timeRange: slot?.timeRange || null,
      })),
      candidateEvents,
      // alias для обратной совместимости со старыми промптами
      candidates: candidateEvents,
      alreadyShownEvents: alreadyShownSummaries,
    };

    if (isPayloadTooLarge(payload, MAX_FILTER_PAYLOAD_CHARS)) {
      candidateEvents = candidateEvents
        .slice(0, 12)
        .map((event) => ({ ...event, description: truncateInlineText(event.description, 120) }));
      alreadyShownSummaries = alreadyShownSummaries.slice(0, 8);
      payload.history = compactHistory(history, {
        limit: 3,
        contentLimit: 180,
      });
      payload.candidateEvents = candidateEvents;
      payload.candidates = candidateEvents;
      payload.alreadyShownEvents = alreadyShownSummaries;
    }

    if (isPayloadTooLarge(payload, MAX_FILTER_PAYLOAD_CHARS)) {
      console.warn(
        `[llmSearchService] Пропускаю search-filter: payload слишком большой (${buildSearchPayloadPreview(payload).length} chars)`
      );
      return {
        selectedIndexes: events.map((_, index) => index),
        comment: 'payload-too-large',
        raw: null,
      };
    }

    const messages = [
      { role: 'system', content: prompt },
      { role: 'user', content: JSON.stringify(payload, null, 2) },
    ];

    const raw = await callAiGateway(messages, 'search-filter');
    const result = parseJsonResponse(raw, {
      selectedIndexes: candidateEvents.map((candidate) => candidate.index),
      comment: '',
    });

    const selectedIndexes = Array.isArray(result.selectedIndexes)
      ? result.selectedIndexes
          .map((index) => Number(index))
          .filter((index) => Number.isInteger(index) && index >= 0 && index < events.length)
      : candidateEvents.map((candidate) => candidate.index);

    return {
      selectedIndexes,
      comment: result.comment || '',
      raw,
    };
  } catch (error) {
    console.error('[llmSearchService] Ошибка фильтрации событий:', error);
    return {
      selectedIndexes: events.map((_, index) => index),
      comment: 'fallback',
      raw: null,
    };
  }
}

export const __testUtils = {
  compactHistory,
  compactCandidateEvent,
  compactShownEvent,
  isPayloadTooLarge,
  truncateInlineText,
};
