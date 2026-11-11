import { detectShortMusicGenre } from './keywordPolicy.js';
import { buildQuerySuggestionFromParams } from './searchRouting.js';
import { selectRelevantItems } from './relevanceSelection.js';
import { extractShownEventsContext, isDuplicateEvent } from './eventIdentity.js';

async function filterEvents(params = {}) {
  const { events = [], keyword = '', intent = null, context = {}, maxSelections = 18 } = params;

  const { history = [], lastUserMessage = '', slots = [], requestId = '' } = context;
  const tracePrefix = requestId ? `[${requestId}] ` : '';
  const shownEventsContext = extractShownEventsContext(context);

  const keywordFromParams = typeof keyword === 'string' ? keyword.trim() : '';
  const baseSuggestion = buildQuerySuggestionFromParams({
    keyword: keywordFromParams,
    slots,
    lastUserMessage,
  });

  const querySuggestion = {
    ...baseSuggestion,
    intent: intent || baseSuggestion.intent,
  };

  const hasMoodSlot = Array.isArray(slots) && slots.some((s) => s && s.name === 'настроение');
  const moodValue = hasMoodSlot
    ? String(slots.find((s) => s && s.name === 'настроение')?.value || '')
        .toLowerCase()
        .trim()
    : '';
  const effectiveIntent =
    hasMoodSlot && (querySuggestion.intent === 'generic' || querySuggestion.intent === 'unknown')
      ? 'mood'
      : querySuggestion.intent;
  const effectiveKeyword = keywordFromParams || querySuggestion.searchQuery || '';
  const detectedShortGenre = detectShortMusicGenre(effectiveKeyword);

  const knownEvents = shownEventsContext.knownEvents;
  const excludeIds = new Set(shownEventsContext.excludeIds);
  const excludeSignatures = new Set(shownEventsContext.excludeSignatures);
  const dedupedItems = [];

  (Array.isArray(events) ? events : []).forEach((item) => {
    if (!isDuplicateEvent(item, excludeIds, excludeSignatures)) {
      dedupedItems.push(item);
    }
  });

  if (dedupedItems.length !== (Array.isArray(events) ? events.length : 0)) {
    console.log(
      `♻️ [KassirAPI] ${tracePrefix}Единый фильтр: удалено дубликатов/уже показанных: ${(Array.isArray(events) ? events.length : 0) - dedupedItems.length}`
    );
  }

  const { baseCandidates, filteredItems, filterInfo } = await selectRelevantItems({
    candidates: dedupedItems,
    effectiveKeyword,
    querySuggestion,
    effectiveIntent,
    detectedShortGenre,
    hasMoodSlot,
    moodValue,
    lastUserMessage,
    history,
    knownEvents,
    slots,
    allowLlmFilter: true,
    maxSelections,
  });

  return {
    items: filteredItems,
    total: dedupedItems.length,
    meta: {
      llmQuery: querySuggestion,
      filtered: filterInfo,
      sourceCounts: {
        rawItems: Array.isArray(events) ? events.length : 0,
        uniqueItems: dedupedItems.length,
        dedupedItems: dedupedItems.length,
        baseCandidates: Array.isArray(baseCandidates) ? baseCandidates.length : 0,
      },
    },
  };
}

export { filterEvents };
