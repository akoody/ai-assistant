import { getAiToolsUrl, getAiToolsApiKey } from '../configService.js';
import { getCache, setCache } from '../cacheService.js';
import { filterEventsByExplicitDate } from '../offerDateFilter.js';
import {
  applyDateSlotDayOfWeekRefinement,
  mergeSlotsWithImplicitDateFromUserMessage,
} from '../dateParsingUtils.js';
import {
  CACHE_TTL,
  CACHE_VERSION,
  logEventDescriptions,
  buildPreferenceCacheToken,
} from './offerSupport.js';
import {
  buildActivityDescriptionIndexFromPageKit,
  rewriteLongEventDescriptionsForDisplay,
  enrichEventsWithDetailedDescriptions,
} from './descriptions.js';
import {
  MAX_EVENTS_PER_OFFER,
  MAX_SEARCH_PAGES,
  QUICK_OFFER_DEFERRED_LLM_MAX_SELECTIONS,
  QUICK_OFFER_DEFERRED_TARGET_CANDIDATES,
  QUICK_OFFER_DEFERRED_MIN_PAGES,
  QUICK_OFFER_DEFERRED_FREE_TARGET_CANDIDATES,
  QUICK_OFFER_DEFERRED_FREE_MIN_PAGES,
  FREE_MODE_MAX_SEARCH_PAGES,
  FREE_MODE_TARGET_MATCHES,
  MAX_COLLECTED_CANDIDATES_HARD_LIMIT,
  MOOD_SEARCH_ROUTE_MAX_PAGES,
  MOOD_FINAL_TARGET_CANDIDATES,
} from './searchDefinitions.js';
import {
  filterEventsBySeniorFriendlyContext,
  isPopularSelectionCandidate,
  isPopularSelectionBackfillCandidate,
  hasPopularSelectionBackfillCandidate,
  buildPopularSelectionBackfillCandidate,
  hasSeniorFriendlyContext,
} from './searchRouting.js';
import { buildSearchPlanFromSlots } from './searchPlan.js';
import {
  normalizeEventId,
  buildEventSignature,
  compactShownEventsForContext,
  seedExclusionSets,
  attachSearchCandidateMetadata,
  mergeSearchCandidateMetadata,
} from './eventIdentity.js';
import { mergeEventDates, sortAndFinalizeDates, decorateDisplayDates } from './eventDates.js';
import {
  selectEventsForOffer,
  preserveWeekendCoverageAfterLlmFilter,
  preservePreferenceRouteCoverageAfterLlmFilter,
  preserveMoodDiversityAfterLlmFilter,
} from './eventSelection.js';
import {
  getBudgetCapFromSlots,
  isStrictFreeBudgetMode,
  eventMatchesBudget,
  getCandidateCollectionStopReason,
  canStopMoodCandidateCollection,
} from './budgetPolicy.js';
import { applyDeferredGlobalLlmFilter } from './llmFilter.js';
import { normalizeEvent } from './eventNormalization.js';
import { rankEvents } from './ranking.js';
import { getSlotsForRanking } from './namedSearch.js';
import { filterEventsByBudget, filterEventsByMonth, filterEventsByTime } from './eventFilters.js';
import {
  inferChildAgeSlotFromConversation,
  inferSeniorFriendlySlotsFromConversation,
  filterEventsByChildAge,
  filterEventsByFamilyFriendlyAge,
  filterEventsByDislikedPreferences,
} from './audienceFilters.js';

async function generateQuickOffer({
  slots,
  fallbackQuery = '',
  history = [],
  userMessage = '',
  alreadyShownEvents = [],
  skipCache = false,
  requestId = null,
  userPreferences = null,
  keywordOverride = null,
  allowPreferenceKeywordExpansion = false,
}) {
  try {
    const slotsWithImplicitDate = mergeSlotsWithImplicitDateFromUserMessage(slots, userMessage);
    const childAwareSlots = inferChildAgeSlotFromConversation(slotsWithImplicitDate, {
      userMessage,
      fallbackQuery,
      history,
    });
    const effectiveSlots = applyDateSlotDayOfWeekRefinement(
      inferSeniorFriendlySlotsFromConversation(childAwareSlots, {
        userMessage,
        fallbackQuery,
        history,
      }),
      { userMessage }
    );
    console.log(
      '🔧 Генерация быстрого предложения для слотов:',
      JSON.stringify(effectiveSlots.map((s) => ({ name: s.name, value: s.value })))
    );

    // Формируем план поиска на основе слотов
    const searchPlan = buildSearchPlanFromSlots(
      effectiveSlots,
      fallbackQuery,
      keywordOverride,
      userMessage
    );
    const searchParams = searchPlan.primaryParams;
    const searchCandidates =
      Array.isArray(searchPlan.candidates) && searchPlan.candidates.length > 0
        ? searchPlan.candidates
        : [{ params: searchParams, label: 'default', source: 'default' }];
    console.log('🔍 Параметры поиска:', JSON.stringify(searchParams));
    if (searchPlan.moodProfileKey) {
      console.log(
        `🎭 [generateQuickOffer] Активирован mood-план (${searchPlan.moodProfileKey}):`,
        JSON.stringify(
          searchCandidates.map((candidate) => ({
            label: candidate.label,
            slug: candidate.params.slug,
            keyword: candidate.params.keyword || null,
          }))
        )
      );
    }

    // Проверяем кеш
    const { excludeIds, excludeSignatures } = seedExclusionSets(alreadyShownEvents);
    const hasExclusions = excludeIds.size > 0 || excludeSignatures.size > 0;

    const shouldUseCache = !skipCache && !hasExclusions;
    // Включаем все слоты в ключ кеша, чтобы разные комбинации слотов давали разные ключи
    const slotsForCache = effectiveSlots
      .map((s) => ({ name: s.name, value: s.value }))
      .sort((a, b) => {
        if (a.name !== b.name) return a.name.localeCompare(b.name);
        return String(a.value).localeCompare(String(b.value));
      });
    const preferenceCacheToken = buildPreferenceCacheToken(
      userPreferences,
      allowPreferenceKeywordExpansion
    );
    const cacheSearchToken = searchCandidates.map((candidate) => candidate.params);
    const cacheKey = shouldUseCache
      ? `quick_offer:${CACHE_VERSION}:${preferenceCacheToken}:${JSON.stringify(cacheSearchToken)}:slots:${JSON.stringify(slotsForCache)}`
      : null;
    if (shouldUseCache) {
      console.log(`🔑 [generateQuickOffer] Ключ кеша: ${cacheKey?.substring(0, 200)}...`);
      console.log(`🔑 [generateQuickOffer] Слоты для кеша:`, JSON.stringify(slotsForCache));
      const cached = getCache(cacheKey);
      if (cached) {
        console.log('💾 Быстрое предложение найдено в кеше');
        // Актуальные негативные предпочтения (события/жанры/артисты) должны применяться и к странице,
        // и к полному пулу originalEvents — иначе «Показать другие варианты» достанет отфильтрованное
        // ранее событие из несинхронизированного пула.
        const filteredCachedEvents = filterEventsByDislikedPreferences(
          cached.events || [],
          userPreferences
        );
        const hasOriginalPool =
          Array.isArray(cached.originalEvents) && cached.originalEvents.length > 0;
        const filteredOriginal = hasOriginalPool
          ? filterEventsByDislikedPreferences(cached.originalEvents, userPreferences)
          : filteredCachedEvents;
        const eventsRemoved = (cached.events || []).length - filteredCachedEvents.length;
        const poolRemoved = hasOriginalPool
          ? cached.originalEvents.length - filteredOriginal.length
          : 0;
        if (eventsRemoved > 0 || poolRemoved > 0) {
          console.log(
            `🚫 [generateQuickOffer] Кеш: негативные предпочтения — убрано с страницы: ${eventsRemoved}, из пула: ${poolRemoved}`
          );
        }
        return { ...cached, events: filteredCachedEvents, originalEvents: filteredOriginal };
      } else {
        console.log('💾 Кеш не найден, генерирую новое предложение');
      }
    }

    // Вызываем AI Tools для поиска событий
    const aiToolsUrl = getAiToolsUrl();
    const apiKey = getAiToolsApiKey();
    console.log(`🌐 Вызов AI Tools: ${aiToolsUrl}/api/tools/kassir-api/search`);

    const uniqueEvents = [];
    const seenIds = new Set(excludeIds);
    const seenSignatures = new Set(excludeSignatures);
    const eventsByKey = new Map();
    const strictFreeBudgetMode = isStrictFreeBudgetMode(effectiveSlots);
    const budgetCapForSearch = getBudgetCapFromSlots(effectiveSlots);
    const maxSearchPages = strictFreeBudgetMode
      ? Math.max(MAX_SEARCH_PAGES, FREE_MODE_MAX_SEARCH_PAGES)
      : MAX_SEARCH_PAGES;
    const targetCollectedEvents = strictFreeBudgetMode
      ? Math.max(QUICK_OFFER_DEFERRED_FREE_TARGET_CANDIDATES, MAX_EVENTS_PER_OFFER * 3)
      : Math.max(QUICK_OFFER_DEFERRED_TARGET_CANDIDATES, MAX_EVENTS_PER_OFFER * 3);
    const targetBudgetMatchedEvents = strictFreeBudgetMode
      ? FREE_MODE_TARGET_MATCHES
      : MAX_EVENTS_PER_OFFER;
    const minSearchPagesBeforeStop = strictFreeBudgetMode
      ? QUICK_OFFER_DEFERRED_FREE_MIN_PAGES
      : QUICK_OFFER_DEFERRED_MIN_PAGES;
    let budgetMatchedCandidates = 0;

    if (strictFreeBudgetMode) {
      console.log(
        `🆓 [generateQuickOffer] Free-режим: расширяю поиск ` +
          `(бюджет=${budgetCapForSearch}, maxPages=${maxSearchPages}, ` +
          `targetCandidates=${targetCollectedEvents}, targetMatches=${targetBudgetMatchedEvents})`
      );
    }

    // Объединяем уже показанные события с событиями, собранными на предыдущих страницах
    let currentAlreadyShownEvents = Array.isArray(alreadyShownEvents)
      ? [...alreadyShownEvents]
      : [];

    // Переменная для отслеживания использования предпочтений
    let usedPreferences = false;
    let searchResolution = null;

    let searchRequestsMade = 0;
    const maxPagesPerCandidate = searchPlan.moodProfileKey
      ? Math.min(MOOD_SEARCH_ROUTE_MAX_PAGES, maxSearchPages)
      : maxSearchPages;

    outerSearchLoop: for (
      let candidateIndex = 0;
      candidateIndex < searchCandidates.length;
      candidateIndex += 1
    ) {
      const candidate = searchCandidates[candidateIndex];
      const candidateParams = candidate?.params || searchParams;
      console.log(
        `🧭 [generateQuickOffer] Маршрут ${candidateIndex + 1}/${searchCandidates.length}: ${candidate?.label || 'default'} -> ` +
          `${JSON.stringify(candidateParams)}`
      );

      for (let page = 1; page <= maxPagesPerCandidate; page += 1) {
        if (searchRequestsMade >= maxSearchPages) {
          console.log(
            `🛑 [generateQuickOffer] Достигнут лимит запросов к AI Tools (${maxSearchPages}), останавливаю сбор кандидатов`
          );
          break outerSearchLoop;
        }

        searchRequestsMade += 1;
        const compactShownEvents = compactShownEventsForContext(currentAlreadyShownEvents);
        const response = await fetch(`${aiToolsUrl}/api/tools/kassir-api/search`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...candidateParams,
            skipLlmFilter: true,
            userPreferences: userPreferences || null,
            allowPreferenceKeywordExpansion,
            context: {
              history: (history || []).slice(-10),
              lastUserMessage: userMessage,
              fallbackQuery,
              slots: effectiveSlots,
              ...compactShownEvents,
              requestId,
            },
            page,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          console.error('❌ AI Tools ошибка:', response.status, errorData);
          throw new Error(
            `AI Tools ошибка: ${response.status} - ${errorData.error || response.statusText}`
          );
        }

        const data = await response.json();
        const rawEvents = data.data?.items || [];
        const activityDescriptionById = buildActivityDescriptionIndexFromPageKit(data.data?.raw);
        const sourceCounts = data.data?.meta?.sourceCounts || null;
        const pageSearchResolution = data.data?.meta?.searchResolution || null;
        const pagesCount = data.data?.pagination?.pagesCount ?? null;
        const currentPage = data.data?.pagination?.currentPage ?? null;

        // Проверяем, были ли использованы предпочтения при поиске
        if (page === 1 && data.data?.meta?.usedPreferences) {
          usedPreferences = true;
          console.log(
            `🧠 [generateQuickOffer] Были использованы предпочтения пользователя при поиске`
          );
        }

        if (!searchResolution && page === 1 && pageSearchResolution) {
          searchResolution = pageSearchResolution;
          if (searchResolution.strictQuerySuppressed) {
            console.log(
              `🧭 [generateQuickOffer] AI Tools отключил строгий поиск по ${searchResolution.strictSource}: ` +
                `${searchResolution.strictValue || ''} -> ${searchResolution.appliedKeyword || '[empty]'}`
            );
          }
        }

        console.log(
          `✅ Получено ${rawEvents.length} событий от AI Tools (маршрут ${candidateIndex + 1}, страница ${page})`
        );
        console.log(
          `🔍 Структура ответа AI Tools (маршрут ${candidateIndex + 1}, стр. ${page}):`,
          JSON.stringify({
            hasData: !!data.data,
            hasItems: !!data.data?.items,
            itemsCount: data.data?.items?.length || 0,
            sourceRawItems: sourceCounts?.rawItems ?? null,
            sourceUniqueItems: sourceCounts?.uniqueItems ?? null,
            total: data.data?.total || 0,
            pagesCount,
            currentPage,
            usedPreferences: data.data?.meta?.usedPreferences || false,
          })
        );

        if (rawEvents.length === 0) {
          const hadSourceItems =
            (sourceCounts?.rawItems ?? 0) > 0 || (sourceCounts?.uniqueItems ?? 0) > 0;
          if (hadSourceItems) {
            console.log(
              `⚠️ На странице ${page} все события были отфильтрованы (sourceRaw=${sourceCounts?.rawItems ?? 0}, sourceUnique=${sourceCounts?.uniqueItems ?? 0}). Продолжаю следующую страницу...`
            );
          } else {
            console.log(
              `⚠️ Пустой ответ AI Tools на странице ${page}, перехожу к следующему маршруту.`
            );
            break;
          }
        }

        let newEventsOnPage = 0;
        let duplicatesOnPage = 0;

        for (let index = 0; index < rawEvents.length; index += 1) {
          try {
            const normalized = attachSearchCandidateMetadata(
              normalizeEvent(rawEvents[index], { activityDescriptionById }),
              candidate
            );
            const idKey = normalizeEventId(normalized.id);
            const signature = buildEventSignature(normalized);
            const dedupeKey = signature || idKey || normalized.url || normalized.title;

            // Сначала пробуем слить по dedupeKey (важно, чтобы разные id одной афиши объединялись)
            if (dedupeKey && eventsByKey.has(dedupeKey)) {
              const existingEvent = eventsByKey.get(dedupeKey);
              mergeEventDates(existingEvent, normalized);
              mergeSearchCandidateMetadata(existingEvent, normalized);
              duplicatesOnPage += 1;
              continue;
            }

            // Далее обычная защита от повторов
            if (idKey && seenIds.has(idKey)) {
              duplicatesOnPage += 1;
              console.log(`⏭️ Пропускаю событие (id=${idKey}), уже показывали ранее.`);
              continue;
            }
            if (signature && seenSignatures.has(signature)) {
              duplicatesOnPage += 1;
              console.log(
                `⏭️ Пропускаю событие "${normalized.title}" (подпись ${signature}), уже показывали ранее.`
              );
              continue;
            }

            if (idKey) {
              seenIds.add(idKey);
            }
            if (signature) {
              seenSignatures.add(signature);
            }

            uniqueEvents.push(normalized);
            if (dedupeKey) {
              eventsByKey.set(dedupeKey, normalized);
            }
            newEventsOnPage += 1;

            if (eventMatchesBudget(normalized, budgetCapForSearch)) {
              budgetMatchedCandidates += 1;
            }

            // Добавляем событие в список уже показанных для следующих страниц
            currentAlreadyShownEvents.push({
              id: normalized.id,
              title: normalized.title,
              date: normalized.date,
              time: normalized.time,
              venue: normalized.venue,
              city: normalized.city,
            });

            console.log(
              `📋 Добавлено событие ${uniqueEvents.length}:`,
              JSON.stringify({
                id: normalized.id,
                title: normalized.title,
                date: normalized.date,
                time: normalized.time,
                venue: normalized.venue,
                city: normalized.city,
                hasPoster: !!normalized.posterImage,
                priceMin: normalized.priceMin,
                priceMax: normalized.priceMax,
                url: normalized.url ? 'есть' : 'нет',
              })
            );

            if (uniqueEvents.length >= MAX_COLLECTED_CANDIDATES_HARD_LIMIT) {
              console.log(
                `🛑 [generateQuickOffer] Достигнут жёсткий лимит собранных кандидатов ` +
                  `(${MAX_COLLECTED_CANDIDATES_HARD_LIMIT}), прекращаю поиск.`
              );
              break outerSearchLoop;
            }

            // Собираем больше событий для последующей фильтрации по бюджету
            // Останавливаемся только если собрали достаточно событий (больше чем нужно для финального ответа)
            const stopReason = getCandidateCollectionStopReason({
              strictFreeBudgetMode,
              uniqueEventsCount: uniqueEvents.length,
              budgetMatchedCandidates,
              targetCollectedEvents,
              targetBudgetMatchedEvents,
            });
            const canStopNow = canStopMoodCandidateCollection({
              searchPlan,
              candidateIndex,
              page,
              searchCandidates,
            });
            if (stopReason && searchRequestsMade >= minSearchPagesBeforeStop && canStopNow) {
              console.log(`✅ ${stopReason}, прекращаю поиск.`);
              break outerSearchLoop;
            } else if (stopReason && !canStopNow) {
              const sweepLabel = searchPlan?.ambiguousCategoryShowAll
                ? 'initial multi-category sweep'
                : 'initial mood-sweep';
              console.log(
                `🎭 [generateQuickOffer] ${stopReason}, но продолжаю ${sweepLabel} ` +
                  `(${candidateIndex + 1}/${searchCandidates.length}, page=${page})`
              );
            }
          } catch (error) {
            console.error(
              `❌ Ошибка нормализации события (страница ${page}, индекс ${index}):`,
              error
            );
            console.error(`   Событие:`, JSON.stringify(rawEvents[index]).substring(0, 500));
          }
        }

        // Логируем статистику по странице
        if (duplicatesOnPage > 0) {
          console.log(
            `📊 Страница ${page}: добавлено ${newEventsOnPage} новых событий, пропущено ${duplicatesOnPage} дубликатов`
          );
        }

        // Останавливаемся если:
        // 1. Собрали достаточно событий для последующей фильтрации
        // 2. На странице все события были дубликатами И мы уже собрали хотя бы несколько событий
        // 3. Достигли максимального количества страниц
        const pageStopReason = getCandidateCollectionStopReason({
          strictFreeBudgetMode,
          uniqueEventsCount: uniqueEvents.length,
          budgetMatchedCandidates,
          targetCollectedEvents,
          targetBudgetMatchedEvents,
        });
        const canStopAfterPage = canStopMoodCandidateCollection({
          searchPlan,
          candidateIndex,
          page,
          searchCandidates,
        });
        if (pageStopReason && searchRequestsMade >= minSearchPagesBeforeStop && canStopAfterPage) {
          break outerSearchLoop;
        } else if (pageStopReason && !canStopAfterPage) {
          const sweepLabel = searchPlan?.ambiguousCategoryShowAll
            ? 'initial multi-category sweep'
            : 'initial mood-sweep';
          console.log(
            `🎭 [generateQuickOffer] ${pageStopReason}, но продолжаю ${sweepLabel} ` +
              `после страницы (${candidateIndex + 1}/${searchCandidates.length}, page=${page})`
          );
          break;
        }

        // Если на странице все события были дубликатами, но мы уже собрали достаточно событий, продолжаем поиск
        // Останавливаемся только если несколько страниц подряд все дубликаты И у нас уже есть события
        if (newEventsOnPage === 0 && uniqueEvents.length >= MAX_EVENTS_PER_OFFER) {
          console.log(
            `⚠️ На странице ${page} все события дубликаты, но уже собрано ${uniqueEvents.length} событий. Продолжаю поиск...`
          );
        }

        if (
          isPopularSelectionBackfillCandidate(candidate) &&
          uniqueEvents.length >= MAX_EVENTS_PER_OFFER
        ) {
          console.log(
            `✅ [generateQuickOffer] Общая афиша добрала события после популярной подборки ` +
              `(${uniqueEvents.length}/${MAX_EVENTS_PER_OFFER}), прекращаю поиск.`
          );
          break outerSearchLoop;
        }

        // Останавливаемся, если Kassir явно сообщил количество страниц
        if (pagesCount && page >= pagesCount) {
          console.log(
            `✅ Достигнут конец пагинации Kassir (page=${page}, pagesCount=${pagesCount}), прекращаю поиск по текущему маршруту.`
          );
          break;
        }
      }

      if (
        isPopularSelectionCandidate(candidate, searchPlan) &&
        uniqueEvents.length < MAX_EVENTS_PER_OFFER &&
        !hasPopularSelectionBackfillCandidate(searchCandidates)
      ) {
        const fallbackCandidate = buildPopularSelectionBackfillCandidate(candidateParams);
        searchCandidates.push(fallbackCandidate);
        console.log(
          `🔁 [generateQuickOffer] Популярная подборка дала ${uniqueEvents.length}/${MAX_EVENTS_PER_OFFER}; ` +
            `добираю события из общей афиши: ${JSON.stringify(fallbackCandidate.params)}`
        );
      }
    }

    if (uniqueEvents.length === 0) {
      console.log('⚠️ События не найдены или все оказались дубликатами');
      return {
        events: [],
        type: 'quick',
        usedPreferences,
        popularSelectionUsed: Boolean(searchPlan.popularSelectionSlug),
      };
    }

    // Финализируем и сортируем даты в каждом событии
    uniqueEvents.forEach((event) => sortAndFinalizeDates(event));

    // Обновляем статус перед анализом событий (если есть события для анализа)
    if (requestId && uniqueEvents.length > 0) {
      const { updateStatus } = await import('../statusService.js');
      updateStatus(requestId, 'Анализируем афиши...');
    }

    // Сначала применяем быстрые эвристики и детерминированные фильтры,
    // затем один раз прогоняем общий LLM-фильтр по сокращённому пулу.
    const rankingSlots = getSlotsForRanking(effectiveSlots, searchResolution);
    const preRankedEvents = rankEvents(uniqueEvents, rankingSlots, userMessage);
    const preFilteredByDislikes = filterEventsByDislikedPreferences(
      preRankedEvents,
      userPreferences
    );
    const preFilteredBySeniorContext = filterEventsBySeniorFriendlyContext(
      preFilteredByDislikes,
      effectiveSlots
    );
    const preFilteredByBudget = filterEventsByBudget(preFilteredBySeniorContext, effectiveSlots);
    const preFilteredByChildAge = filterEventsByChildAge(preFilteredByBudget, effectiveSlots);
    const preFilteredByFamilyAge = filterEventsByFamilyFriendlyAge(
      preFilteredByChildAge,
      effectiveSlots
    );
    const preFilteredByMonth = filterEventsByMonth(
      preFilteredByFamilyAge,
      effectiveSlots,
      userMessage
    );
    const preFilteredByExplicitDate = filterEventsByExplicitDate(
      preFilteredByMonth,
      effectiveSlots,
      userMessage
    );
    const preFilteredByTime = filterEventsByTime(preFilteredByExplicitDate, effectiveSlots);

    // ВАЖНО: senior-friendly фильтр применяется строго — если он выдал пустой список,
    // это означает что подходящих событий нет, а не что нужно откатиться к нефильтрованному пулу.
    // Только нод senior context (аудитория_спутник=пожилой) может применить жёсткий фильтр.
    const seniorContextActive = hasSeniorFriendlyContext(effectiveSlots);
    const llmFilterInput =
      (preFilteredByTime.length > 0 && preFilteredByTime) ||
      (preFilteredByExplicitDate.length > 0 && preFilteredByExplicitDate) ||
      (preFilteredByMonth.length > 0 && preFilteredByMonth) ||
      (preFilteredByFamilyAge.length > 0 && preFilteredByFamilyAge) ||
      (preFilteredByChildAge.length > 0 && preFilteredByChildAge) ||
      (preFilteredByBudget.length > 0 && preFilteredByBudget) ||
      (seniorContextActive
        ? preFilteredBySeniorContext
        : preFilteredBySeniorContext.length > 0 && preFilteredBySeniorContext) ||
      (preFilteredByDislikes.length > 0 && preFilteredByDislikes) ||
      preRankedEvents;

    console.log(
      `🧠 [generateQuickOffer] Пул для единого LLM-фильтра: ${llmFilterInput.length} ` +
        `(из ${uniqueEvents.length} собранных кандидатов)`
    );

    const deferredFilterResult = await applyDeferredGlobalLlmFilter(llmFilterInput, {
      searchParams,
      history,
      userMessage,
      fallbackQuery,
      slots: effectiveSlots,
      alreadyShownEvents,
      requestId,
    });

    const llmFilteredEvents =
      Array.isArray(deferredFilterResult.events) && deferredFilterResult.events.length > 0
        ? deferredFilterResult.events
        : llmFilterInput;
    const llmFilteredEventsWithPreferenceRouteCoverage =
      preservePreferenceRouteCoverageAfterLlmFilter(
        llmFilteredEvents,
        llmFilterInput,
        effectiveSlots,
        QUICK_OFFER_DEFERRED_LLM_MAX_SELECTIONS
      );
    const llmFilteredEventsWithWeekendCoverage = preserveWeekendCoverageAfterLlmFilter(
      llmFilteredEventsWithPreferenceRouteCoverage,
      llmFilterInput,
      effectiveSlots,
      QUICK_OFFER_DEFERRED_LLM_MAX_SELECTIONS,
      userMessage
    );
    const llmFilteredEventsWithMoodDiversity = preserveMoodDiversityAfterLlmFilter(
      llmFilteredEventsWithWeekendCoverage,
      llmFilterInput,
      effectiveSlots,
      QUICK_OFFER_DEFERRED_LLM_MAX_SELECTIONS
    );

    await enrichEventsWithDetailedDescriptions(llmFilteredEventsWithMoodDiversity, {
      domain: searchParams.domain,
    });

    // Финальный проход ранжирования и детерминированных фильтров уже по сокращённому пулу.
    const rankedEvents = rankEvents(llmFilteredEventsWithMoodDiversity, rankingSlots, userMessage);
    const filteredByDislikes = filterEventsByDislikedPreferences(rankedEvents, userPreferences);
    const filteredBySeniorContext = filterEventsBySeniorFriendlyContext(
      filteredByDislikes,
      effectiveSlots
    );
    const filteredByBudget = filterEventsByBudget(filteredBySeniorContext, effectiveSlots);
    const filteredByChildAge = filterEventsByChildAge(filteredByBudget, effectiveSlots);
    const filteredByFamilyAge = filterEventsByFamilyFriendlyAge(filteredByChildAge, effectiveSlots);
    const filteredByMonth = filterEventsByMonth(filteredByFamilyAge, effectiveSlots, userMessage);
    const filteredByExplicitDate = filterEventsByExplicitDate(
      filteredByMonth,
      effectiveSlots,
      userMessage
    );
    const filteredByTime = filterEventsByTime(filteredByExplicitDate, effectiveSlots);

    const originalEvents = decorateDisplayDates(
      selectEventsForOffer(
        filteredByTime,
        effectiveSlots,
        Math.max(filteredByTime.length, MAX_EVENTS_PER_OFFER),
        userMessage
      )
    );
    await rewriteLongEventDescriptionsForDisplay(originalEvents);
    const eventsForResponse = originalEvents.slice(0, MAX_EVENTS_PER_OFFER);
    logEventDescriptions(eventsForResponse, 'quick');

    console.log(
      `🎯 Возвращаем ${eventsForResponse.length} событий для фронтенда (из ${uniqueEvents.length} собранных)`
    );
    console.log(`   - После единого LLM-фильтра: ${llmFilteredEvents.length} событий`);
    console.log(
      `   - После восстановления route coverage: ${llmFilteredEventsWithPreferenceRouteCoverage.length} событий`
    );
    console.log(
      `   - После восстановления покрытия выходных: ${llmFilteredEventsWithWeekendCoverage.length} событий`
    );
    console.log(
      `   - После восстановления mood-разнообразия: ${llmFilteredEventsWithMoodDiversity.length} событий`
    );
    console.log(`   - После ранжирования: ${rankedEvents.length} событий`);
    console.log(
      `   - После фильтрации по негативным предпочтениям: ${filteredByDislikes.length} событий`
    );
    console.log(`   - После senior-friendly фильтра: ${filteredBySeniorContext.length} событий`);
    console.log(`   - После фильтрации по бюджету: ${filteredByBudget.length} событий`);
    console.log(`   - После фильтрации по возрасту ребёнка: ${filteredByChildAge.length} событий`);
    console.log(`   - После family age-фильтра: ${filteredByFamilyAge.length} событий`);
    console.log(`   - После фильтрации по месяцу: ${filteredByMonth.length} событий`);
    console.log(
      `   - После фильтрации по конкретной дате: ${filteredByExplicitDate.length} событий`
    );
    console.log(`   - После фильтрации по времени: ${filteredByTime.length} событий`);

    eventsForResponse.forEach((event, index) => {
      const hasPriceMin = event.priceMin !== null && event.priceMin !== undefined;
      const hasPriceMax = event.priceMax !== null && event.priceMax !== undefined;
      const isFree =
        (hasPriceMin && event.priceMin === 0 && (!hasPriceMax || event.priceMax === 0)) ||
        (!hasPriceMin && hasPriceMax && event.priceMax === 0);
      const priceInfo = isFree
        ? 'бесплатно'
        : hasPriceMin
          ? hasPriceMax && event.priceMax !== event.priceMin
            ? `${event.priceMin}-${event.priceMax}`
            : `от ${event.priceMin}`
          : hasPriceMax
            ? `до ${event.priceMax}`
            : 'цена не указана';
      const priceInfoWithUnit =
        priceInfo === 'бесплатно' || priceInfo === 'цена не указана'
          ? priceInfo
          : `${priceInfo} руб.`;
      console.log(
        `   ${index + 1}. ${event.title} | ${event.date || 'Дата не указана'} ${event.time || ''} | ${priceInfoWithUnit} | ${event.venue || 'Место не указано'}`
      );
    });

    const result = {
      events: eventsForResponse,
      originalEvents,
      type: 'quick',
      usedPreferences: usedPreferences,
      popularSelectionUsed: Boolean(searchPlan.popularSelectionSlug),
    };

    if (shouldUseCache) {
      setCache(cacheKey, result, CACHE_TTL);
    }

    return result;
  } catch (error) {
    console.error('❌ Ошибка генерации быстрого предложения:', error);
    return {
      text: 'Извините, не удалось найти подходящие мероприятия. Попробуйте уточнить параметры поиска.',
      events: [],
      type: 'quick',
    };
  }
}

async function generateFinalOffer({
  slots,
  fallbackQuery = '',
  history = [],
  userMessage = '',
  alreadyShownEvents = [],
  skipCache = false,
  requestId = null,
  userPreferences = null,
  keywordOverride = null,
  allowPreferenceKeywordExpansion = false,
}) {
  try {
    const slotsWithImplicitDate = mergeSlotsWithImplicitDateFromUserMessage(slots, userMessage);
    const childAwareSlots = inferChildAgeSlotFromConversation(slotsWithImplicitDate, {
      userMessage,
      fallbackQuery,
      history,
    });
    const effectiveSlots = applyDateSlotDayOfWeekRefinement(
      inferSeniorFriendlySlotsFromConversation(childAwareSlots, {
        userMessage,
        fallbackQuery,
        history,
      }),
      { userMessage }
    );

    // Формируем план поиска
    const searchPlan = buildSearchPlanFromSlots(
      effectiveSlots,
      fallbackQuery,
      keywordOverride,
      userMessage
    );
    const searchParams = searchPlan.primaryParams;
    const searchCandidates =
      Array.isArray(searchPlan.candidates) && searchPlan.candidates.length > 0
        ? searchPlan.candidates
        : [{ params: searchParams, label: 'default', source: 'default' }];

    // Проверяем кеш
    const { excludeIds, excludeSignatures } = seedExclusionSets(alreadyShownEvents);
    const hasExclusions = excludeIds.size > 0 || excludeSignatures.size > 0;

    const shouldUseCache = !skipCache && !hasExclusions;
    // Включаем все слоты в ключ кеша, чтобы разные комбинации слотов давали разные ключи
    const slotsForCache = effectiveSlots
      .map((s) => ({ name: s.name, value: s.value }))
      .sort((a, b) => {
        if (a.name !== b.name) return a.name.localeCompare(b.name);
        return String(a.value).localeCompare(String(b.value));
      });
    const preferenceCacheToken = buildPreferenceCacheToken(
      userPreferences,
      allowPreferenceKeywordExpansion
    );
    const cacheKey = shouldUseCache
      ? `final_offer:${CACHE_VERSION}:${preferenceCacheToken}:${JSON.stringify(searchCandidates.map((candidate) => candidate.params))}:slots:${JSON.stringify(slotsForCache)}`
      : null;
    if (shouldUseCache) {
      const cached = getCache(cacheKey);
      if (cached) {
        console.log('💾 Финальное предложение найдено в кеше');
        const filteredCachedEvents = filterEventsByDislikedPreferences(
          cached.events || [],
          userPreferences
        );
        const hasOriginalPool =
          Array.isArray(cached.originalEvents) && cached.originalEvents.length > 0;
        const filteredOriginal = hasOriginalPool
          ? filterEventsByDislikedPreferences(cached.originalEvents, userPreferences)
          : filteredCachedEvents;
        const eventsRemoved = (cached.events || []).length - filteredCachedEvents.length;
        const poolRemoved = hasOriginalPool
          ? cached.originalEvents.length - filteredOriginal.length
          : 0;
        if (eventsRemoved > 0 || poolRemoved > 0) {
          console.log(
            `🚫 [generateFinalOffer] Кеш: негативные предпочтения — убрано с страницы: ${eventsRemoved}, из пула: ${poolRemoved}`
          );
        }
        return { ...cached, events: filteredCachedEvents, originalEvents: filteredOriginal };
      }
    }

    // Вызываем AI Tools для поиска событий
    const aiToolsUrl = getAiToolsUrl();
    const apiKey = getAiToolsApiKey();

    // Переменная для отслеживания использования предпочтений
    let usedPreferences = false;
    let searchResolution = null;
    const uniqueEvents = [];
    const seenIds = new Set(excludeIds);
    const seenSignatures = new Set(excludeSignatures);
    const eventsByKey = new Map();
    const maxPagesPerCandidate = searchPlan.moodProfileKey ? MOOD_SEARCH_ROUTE_MAX_PAGES : 1;

    outerFinalSearchLoop: for (
      let candidateIndex = 0;
      candidateIndex < searchCandidates.length;
      candidateIndex += 1
    ) {
      const candidate = searchCandidates[candidateIndex];
      const candidateParams = candidate?.params || searchParams;
      console.log(
        `🧭 [generateFinalOffer] Маршрут ${candidateIndex + 1}/${searchCandidates.length}: ${candidate?.label || 'default'} -> ` +
          `${JSON.stringify(candidateParams)}`
      );

      for (let page = 1; page <= maxPagesPerCandidate; page += 1) {
        const response = await fetch(`${aiToolsUrl}/api/tools/kassir-api/search`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...candidateParams,
            userPreferences: userPreferences || null,
            allowPreferenceKeywordExpansion,
            context: {
              history: (history || []).slice(-10),
              lastUserMessage: userMessage,
              fallbackQuery,
              slots: effectiveSlots,
            },
            page,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            `AI Tools ошибка: ${response.status} - ${errorData.error || response.statusText}`
          );
        }

        const data = await response.json();
        const rawEvents = data.data?.items || [];
        const activityDescriptionById = buildActivityDescriptionIndexFromPageKit(data.data?.raw);
        const sourceCounts = data.data?.meta?.sourceCounts || null;
        const pagesCount = data.data?.pagination?.pagesCount ?? null;

        if (!searchResolution && data.data?.meta?.searchResolution) {
          searchResolution = data.data.meta.searchResolution;
          if (searchResolution?.strictQuerySuppressed) {
            console.log(
              `🧭 [generateFinalOffer] AI Tools отключил строгий поиск по ${searchResolution.strictSource}: ` +
                `${searchResolution.strictValue || ''} -> ${searchResolution.appliedKeyword || '[empty]'}`
            );
          }
        }

        if (data.data?.meta?.usedPreferences) {
          usedPreferences = true;
          console.log(
            `🧠 [generateFinalOffer] Были использованы предпочтения пользователя при поиске`
          );
        }

        console.log(
          `✅ Получено ${rawEvents.length} событий от AI Tools (финальное предложение, маршрут ${candidateIndex + 1}, страница ${page})`
        );

        if (rawEvents.length === 0) {
          const hadSourceItems =
            (sourceCounts?.rawItems ?? 0) > 0 || (sourceCounts?.uniqueItems ?? 0) > 0;
          if (!hadSourceItems) {
            console.log(
              `⚠️ [generateFinalOffer] Пустой ответ на маршруте ${candidateIndex + 1}, перехожу к следующему маршруту`
            );
            break;
          }
        }

        rawEvents.forEach((eventItem, index) => {
          try {
            const normalized = attachSearchCandidateMetadata(
              normalizeEvent(eventItem, { activityDescriptionById }),
              candidate
            );
            const idKey = normalizeEventId(normalized.id);
            const signature = buildEventSignature(normalized);
            const dedupeKey = signature || idKey || normalized.url || normalized.title;

            if (dedupeKey && eventsByKey.has(dedupeKey)) {
              const existingEvent = eventsByKey.get(dedupeKey);
              mergeEventDates(existingEvent, normalized);
              mergeSearchCandidateMetadata(existingEvent, normalized);
              return;
            }

            if ((idKey && seenIds.has(idKey)) || (signature && seenSignatures.has(signature))) {
              return;
            }

            if (idKey) {
              seenIds.add(idKey);
            }
            if (signature) {
              seenSignatures.add(signature);
            }

            uniqueEvents.push(normalized);
            if (dedupeKey) {
              eventsByKey.set(dedupeKey, normalized);
            }
            console.log(
              `📋 Финальное предложение: добавлено событие ${uniqueEvents.length} (${index + 1} на странице): ${normalized.title}`
            );
          } catch (error) {
            console.error(
              `❌ Ошибка нормализации события финального предложения (${index + 1}):`,
              error
            );
          }
        });

        const canStopFinalMoodSweep = canStopMoodCandidateCollection({
          searchPlan,
          candidateIndex,
          page,
          searchCandidates,
        });
        if (uniqueEvents.length >= MOOD_FINAL_TARGET_CANDIDATES && canStopFinalMoodSweep) {
          console.log(
            `✅ [generateFinalOffer] Собрано ${uniqueEvents.length} кандидатов, дальнейший сбор не требуется`
          );
          break outerFinalSearchLoop;
        } else if (uniqueEvents.length >= MOOD_FINAL_TARGET_CANDIDATES && !canStopFinalMoodSweep) {
          const sweepLabel = searchPlan?.ambiguousCategoryShowAll
            ? 'initial multi-category sweep'
            : 'initial mood-sweep';
          console.log(
            `🎭 [generateFinalOffer] Собрано ${uniqueEvents.length} кандидатов, ` +
              `но продолжаю ${sweepLabel} (${candidateIndex + 1}/${searchCandidates.length}, page=${page})`
          );
          break;
        }

        if (
          isPopularSelectionBackfillCandidate(candidate) &&
          uniqueEvents.length >= MAX_EVENTS_PER_OFFER
        ) {
          console.log(
            `✅ [generateFinalOffer] Общая афиша добрала события после популярной подборки ` +
              `(${uniqueEvents.length}/${MAX_EVENTS_PER_OFFER}), прекращаю поиск.`
          );
          break outerFinalSearchLoop;
        }

        if (pagesCount && page >= pagesCount) {
          break;
        }
      }

      if (
        isPopularSelectionCandidate(candidate, searchPlan) &&
        uniqueEvents.length < MAX_EVENTS_PER_OFFER &&
        !hasPopularSelectionBackfillCandidate(searchCandidates)
      ) {
        const fallbackCandidate = buildPopularSelectionBackfillCandidate(candidateParams);
        searchCandidates.push(fallbackCandidate);
        console.log(
          `🔁 [generateFinalOffer] Популярная подборка дала ${uniqueEvents.length}/${MAX_EVENTS_PER_OFFER}; ` +
            `добираю события из общей афиши: ${JSON.stringify(fallbackCandidate.params)}`
        );
      }
    }

    if (uniqueEvents.length === 0) {
      console.log('⚠️ События не найдены или все оказались дубликатами (финальное предложение)');
      return {
        events: [],
        type: 'final',
        popularSelectionUsed: Boolean(searchPlan.popularSelectionSlug),
      };
    }

    await enrichEventsWithDetailedDescriptions(uniqueEvents, { domain: searchParams.domain });

    // Финализируем и сортируем даты в каждом событии
    uniqueEvents.forEach((event) => sortAndFinalizeDates(event));

    // Обновляем статус перед анализом событий (если есть события для анализа)
    if (requestId && uniqueEvents.length > 0) {
      const { updateStatus } = await import('../statusService.js');
      updateStatus(requestId, 'Анализируем афиши...');
      // Небольшая задержка, чтобы статус был виден пользователю
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    // Ранжируем события по релевантности
    // Ранжирование уже учитывает соответствие жанру и типу через scoreGenreTypeMatch
    // Нерелевантные события получат низкий балл и не попадут в топ-5
    const rankingSlots = getSlotsForRanking(effectiveSlots, searchResolution);
    const rankedEvents = rankEvents(uniqueEvents, rankingSlots, userMessage);

    // КРИТИЧЕСКИ ВАЖНО: Фильтруем события по негативным предпочтениям ПЕРЕД другими фильтрами
    const filteredByDislikes = filterEventsByDislikedPreferences(rankedEvents, userPreferences);
    const filteredBySeniorContext = filterEventsBySeniorFriendlyContext(
      filteredByDislikes,
      effectiveSlots
    );

    // Фильтруем события по бюджету - строго исключаем события, где максимальная цена превышает бюджет
    const filteredByBudget = filterEventsByBudget(filteredBySeniorContext, effectiveSlots);
    const filteredByChildAge = filterEventsByChildAge(filteredByBudget, effectiveSlots);

    const filteredByFamilyAge = filterEventsByFamilyFriendlyAge(filteredByChildAge, effectiveSlots);

    // Фильтруем события по месяцу, если указан только месяц (без конкретного дня)
    const filteredByMonth = filterEventsByMonth(filteredByFamilyAge, effectiveSlots, userMessage);

    // Если пользователь указал конкретный день, оставляем только события этого дня
    const filteredByExplicitDate = filterEventsByExplicitDate(
      filteredByMonth,
      effectiveSlots,
      userMessage
    );

    // Фильтруем события по времени, если указано время начала события
    const filteredByTime = filterEventsByTime(filteredByExplicitDate, effectiveSlots);

    const originalEvents = decorateDisplayDates(
      selectEventsForOffer(
        filteredByTime,
        effectiveSlots,
        Math.max(filteredByTime.length, MAX_EVENTS_PER_OFFER),
        userMessage
      )
    );
    await rewriteLongEventDescriptionsForDisplay(originalEvents);
    const eventsForResponse = originalEvents.slice(0, MAX_EVENTS_PER_OFFER);
    logEventDescriptions(eventsForResponse, 'final');

    if (eventsForResponse.length > 0) {
      console.log('📋 Топ событий от API Кассира (финальное предложение):');
      console.log(`   - После ранжирования: ${rankedEvents.length} событий`);
      console.log(
        `   - После фильтрации по негативным предпочтениям: ${filteredByDislikes.length} событий`
      );
      console.log(`   - После senior-friendly фильтра: ${filteredBySeniorContext.length} событий`);
      console.log(`   - После фильтрации по бюджету: ${filteredByBudget.length} событий`);
      console.log(`   - После family age-фильтра: ${filteredByFamilyAge.length} событий`);
      console.log(`   - После фильтрации по месяцу: ${filteredByMonth.length} событий`);
      console.log(
        `   - После фильтрации по конкретной дате: ${filteredByExplicitDate.length} событий`
      );
      console.log(`   - После фильтрации по времени: ${filteredByTime.length} событий`);
      eventsForResponse.forEach((event, index) => {
        const hasPriceMin = event.priceMin !== null && event.priceMin !== undefined;
        const hasPriceMax = event.priceMax !== null && event.priceMax !== undefined;
        const isFree =
          (hasPriceMin && event.priceMin === 0 && (!hasPriceMax || event.priceMax === 0)) ||
          (!hasPriceMin && hasPriceMax && event.priceMax === 0);
        const priceInfo = isFree
          ? 'бесплатно'
          : hasPriceMin
            ? hasPriceMax && event.priceMax !== event.priceMin
              ? `${event.priceMin}-${event.priceMax}`
              : `от ${event.priceMin}`
            : hasPriceMax
              ? `до ${event.priceMax}`
              : 'цена не указана';
        const priceInfoWithUnit =
          priceInfo === 'бесплатно' || priceInfo === 'цена не указана'
            ? priceInfo
            : `${priceInfo} руб.`;
        console.log(
          `   ${index + 1}. ${event.title} | ${event.date || 'Дата не указана'} ${event.time || ''} | ${priceInfoWithUnit} | ${event.venue || 'Место не указано'}`
        );
      });
    }

    const result = {
      events: eventsForResponse,
      originalEvents,
      type: 'final',
      usedPreferences: usedPreferences,
      popularSelectionUsed: Boolean(searchPlan.popularSelectionSlug),
    };

    if (shouldUseCache) {
      setCache(cacheKey, result, CACHE_TTL);
    }

    return result;
  } catch (error) {
    console.error('Ошибка генерации финального предложения:', error);
    return {
      text: 'Извините, не удалось найти подходящие мероприятия. Попробуйте уточнить параметры поиска.',
      events: [],
      type: 'final',
    };
  }
}

export { generateQuickOffer, generateFinalOffer };
