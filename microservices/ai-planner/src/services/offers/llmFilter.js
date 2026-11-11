import { getAiToolsUrl, getAiToolsApiKey } from '../configService.js';
import {
  MAX_EVENTS_PER_OFFER,
  QUICK_OFFER_DEFERRED_LLM_POOL_SIZE,
  QUICK_OFFER_DEFERRED_LLM_MAX_SELECTIONS,
} from './searchDefinitions.js';

async function applyDeferredGlobalLlmFilter(
  events = [],
  {
    searchParams = {},
    history = [],
    userMessage = '',
    fallbackQuery = '',
    slots = [],
    alreadyShownEvents = [],
    requestId = '',
    poolSize = QUICK_OFFER_DEFERRED_LLM_POOL_SIZE,
    maxSelections = QUICK_OFFER_DEFERRED_LLM_MAX_SELECTIONS,
  } = {}
) {
  if (!Array.isArray(events) || events.length === 0) {
    return {
      events: [],
      applied: false,
      reason: 'empty-pool',
    };
  }

  const pool = events.slice(0, poolSize);
  if (pool.length <= MAX_EVENTS_PER_OFFER) {
    console.log(
      `ℹ️ [generateQuickOffer] Общий LLM-фильтр пропущен: маленький пул (${pool.length})`
    );
    return {
      events: pool,
      applied: false,
      reason: 'small-pool',
    };
  }

  const aiToolsUrl = getAiToolsUrl();
  const apiKey = getAiToolsApiKey();

  console.log(
    `🧠 [generateQuickOffer] Применяю единый LLM-фильтр к пулу кандидатов: ` +
      `${pool.length} событий, keyword="${searchParams.keyword || ''}", maxSelections=${maxSelections}`
  );

  try {
    const response = await fetch(`${aiToolsUrl}/api/tools/kassir-api/filter-events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        events: pool,
        keyword: searchParams.keyword || '',
        context: {
          history: (history || []).slice(-10),
          lastUserMessage: userMessage,
          fallbackQuery,
          slots,
          alreadyShownEvents,
          requestId,
        },
        maxSelections,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        `AI Tools filter ошибка: ${response.status} - ${errorData.error || response.statusText}`
      );
    }

    const data = await response.json();
    const filteredEvents = Array.isArray(data.data?.items) ? data.data.items : [];

    if (filteredEvents.length > 0) {
      console.log(
        `✅ [generateQuickOffer] Единый LLM-фильтр отобрал ${filteredEvents.length} ` +
          `из ${pool.length} кандидатов`
      );
      return {
        events: filteredEvents,
        applied: true,
        reason: 'filtered',
        meta: data.data?.meta || null,
      };
    }

    console.log(
      '⚠️ [generateQuickOffer] Единый LLM-фильтр вернул пустой результат, использую исходный пул кандидатов'
    );
    return {
      events: pool,
      applied: false,
      reason: 'empty-filter-result',
      meta: data.data?.meta || null,
    };
  } catch (error) {
    console.error(
      '⚠️ [generateQuickOffer] Ошибка единого LLM-фильтра, использую исходный пул кандидатов:',
      error
    );
    return {
      events: pool,
      applied: false,
      reason: 'filter-error',
      error,
    };
  }
}

export { applyDeferredGlobalLlmFilter };
