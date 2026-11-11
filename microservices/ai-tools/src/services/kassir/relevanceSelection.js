import { filterEventsByContext } from '../llmSearchService.js';
import { RAP_EQUIVALENTS } from './keywordPolicy.js';
import {
  applyShortGenreTokenFilter,
  applyRapNegativeFilter,
  applyMusicNonConcertNegativeFilter,
  shouldApplyTheaterPerformanceFilter,
  applyTheaterPerformanceFilter,
  applyStandupNegativeFilter,
  shouldExcludeStandupForConcertRequest,
} from './eventFilters.js';
import {
  applyRapRescueFilter,
  scoreRapCandidate,
  backfillShortGenreResults,
} from './genreRecovery.js';
import { extractEventSummary } from './eventIdentity.js';

async function selectRelevantItems({
  candidates = [],
  effectiveKeyword = '',
  querySuggestion = {},
  effectiveIntent = 'generic',
  detectedShortGenre = null,
  hasMoodSlot = false,
  moodValue = null,
  lastUserMessage = '',
  history = [],
  knownEvents = [],
  slots = [],
  allowLlmFilter = true,
  maxSelections = 6,
  isBroadSearch = false,
}) {
  const mergeSelectedWithRemainingCandidates = (
    selected = [],
    allCandidates = [],
    hardLimit = maxSelections
  ) => {
    const result = [];
    const seen = new Set();

    const push = (item) => {
      if (!item || seen.has(item) || result.length >= hardLimit) {
        return;
      }
      seen.add(item);
      result.push(item);
    };

    selected.forEach(push);
    allCandidates.forEach(push);

    return result;
  };

  let baseCandidates = Array.isArray(candidates) ? candidates : [];
  if (
    !isBroadSearch &&
    shouldExcludeStandupForConcertRequest({
      effectiveKeyword,
      querySuggestion,
      slots,
      lastUserMessage,
    })
  ) {
    const withoutStandup = applyStandupNegativeFilter(baseCandidates);
    if (withoutStandup.length !== baseCandidates.length) {
      console.log(
        `🚫 [KassirAPI] Концерты без стендапа: удалено ${baseCandidates.length - withoutStandup.length} стендап-событий`
      );
    }
    baseCandidates = withoutStandup;
  }

  if (
    !isBroadSearch &&
    shouldApplyTheaterPerformanceFilter({
      effectiveKeyword,
      querySuggestion,
      slots,
      lastUserMessage,
    })
  ) {
    const theaterFiltered = applyTheaterPerformanceFilter(baseCandidates);
    if (theaterFiltered.length !== baseCandidates.length) {
      console.log(
        `🎭 [KassirAPI] Театральный hard-filter: удалено ${baseCandidates.length - theaterFiltered.length} ` +
          `нерелевантных не-спектакльных событий`
      );
    }
    baseCandidates = theaterFiltered;
  }

  let filteredItems = baseCandidates;
  let filterInfo = null;

  if (baseCandidates.length === 0) {
    console.log('🔎 [KassirAPI] Ответ пустой (события не найдены)');
    return {
      baseCandidates,
      filteredItems,
      filterInfo,
    };
  }

  console.log(`🔎 [KassirAPI] Ответ: ${baseCandidates.length} событий после дедупликации/правил`);

  const hasContextIntent = effectiveIntent === 'context' || querySuggestion.context;
  const isArtistIntent = querySuggestion.intent === 'artist';
  const isCategoryIntent = effectiveIntent === 'category' || querySuggestion.intent === 'category';

  const musicGenres = [
    'поп',
    'рок',
    'джаз',
    'рэп',
    'хип-хоп',
    'блюз',
    'фолк',
    'метал',
    'инди',
    'регги',
    'соул',
    'фанк',
  ];
  const isShortMusicGenre = Boolean(detectedShortGenre && musicGenres.includes(detectedShortGenre));

  if (isShortMusicGenre) {
    console.log(
      `🎵 [KassirAPI] Обнаружен короткий жанр "${effectiveKeyword}" - LLM фильтр будет применен ОБЯЗАТЕЛЬНО`
    );
  }

  const shouldSkipLlmFilter =
    !hasContextIntent &&
    !hasMoodSlot &&
    !isShortMusicGenre &&
    (isArtistIntent || effectiveIntent === 'generic' || effectiveIntent === 'unknown') &&
    (!knownEvents || knownEvents.length < 10);

  let shortGenreFiltered = null;
  if (isShortMusicGenre) {
    shortGenreFiltered = applyShortGenreTokenFilter(baseCandidates, detectedShortGenre);
    if (shortGenreFiltered.length > 0 && shortGenreFiltered.length !== baseCandidates.length) {
      console.log(
        `🎵 [KassirAPI] Токен-фильтр жанра "${detectedShortGenre}": ${shortGenreFiltered.length}/${baseCandidates.length}`
      );
    }
    if (shortGenreFiltered.length === 0) {
      console.log(
        `🎵 [KassirAPI] Токен-фильтр жанра "${detectedShortGenre}" не нашёл явных совпадений, не сужаю пул кандидатов`
      );
    }
  }

  const llmCandidates =
    isShortMusicGenre && Array.isArray(shortGenreFiltered) && shortGenreFiltered.length > 0
      ? shortGenreFiltered
      : baseCandidates;

  const shouldSkipLlmFilterForFocusedSmallPool =
    !hasContextIntent &&
    !hasMoodSlot &&
    llmCandidates.length >= 5 &&
    llmCandidates.length <= 10 &&
    (isShortMusicGenre || isCategoryIntent);
  const softCategoryPoolLimit = Math.max(maxSelections, 18);
  const shouldUseSoftCategoryRerank =
    !hasContextIntent &&
    !hasMoodSlot &&
    isCategoryIntent &&
    llmCandidates.length >= 5 &&
    llmCandidates.length <= Math.max(softCategoryPoolLimit, 30);
  const shouldUseSoftLlmRerank =
    !hasContextIntent &&
    !hasMoodSlot &&
    ((llmCandidates.length >= 5 && llmCandidates.length <= 14 && isShortMusicGenre) ||
      shouldUseSoftCategoryRerank);

  if (!allowLlmFilter) {
    console.log(
      `⏭️ [KassirAPI] LLM фильтр отложен: возвращаю ${llmCandidates.length} кандидатов для общего rerank/filter`
    );
    filteredItems = llmCandidates;
    filterInfo = {
      comment: 'llm-filter-deferred',
      selectedIndexes: llmCandidates.map((_, index) => index),
    };
  } else if (shouldSkipLlmFilterForFocusedSmallPool) {
    console.log(
      `🪶 [KassirAPI] Пропускаю жёсткий LLM-фильтр для компактного релевантного пула ` +
        `(${llmCandidates.length} событий, intent=${effectiveIntent}, genre=${detectedShortGenre || 'n/a'})`
    );
    filteredItems = llmCandidates;
    filterInfo = {
      comment: 'llm-filter-skipped-for-focused-small-pool',
      selectedIndexes: llmCandidates.map((_, index) => index),
    };
  } else if (shouldSkipLlmFilter) {
    console.log(
      `ℹ️ [KassirAPI] Пропускаю LLM фильтр (intent: ${effectiveIntent}, уже показано: ${knownEvents?.length || 0}), возвращаю все ${llmCandidates.length} событий`
    );
    filteredItems = llmCandidates;
    filterInfo = {
      comment: 'llm-filter-skipped-for-generic',
      selectedIndexes: llmCandidates.map((_, index) => index),
    };
  } else {
    console.log(
      `🔍 [KassirAPI] Применяю LLM фильтр (intent: ${effectiveIntent}, isShortMusicGenre: ${isShortMusicGenre}, keyword: "${effectiveKeyword}", maxSelections: ${maxSelections})`
    );
    const filterResult = await filterEventsByContext({
      events: llmCandidates,
      intent: effectiveIntent,
      context: querySuggestion.context || null,
      mood: moodValue || null,
      lastUserMessage,
      history,
      alreadyShownEvents: knownEvents,
      maxSelections,
    });

    if (filterResult && Array.isArray(filterResult.selectedIndexes)) {
      const selected = filterResult.selectedIndexes
        .map((index) => llmCandidates[index])
        .filter(Boolean);

      if (selected.length > 0) {
        filteredItems = shouldUseSoftLlmRerank
          ? mergeSelectedWithRemainingCandidates(
              selected,
              llmCandidates,
              Math.min(maxSelections, llmCandidates.length)
            )
          : selected;
        filterInfo = {
          comment: shouldUseSoftLlmRerank
            ? `${filterResult.comment || ''} soft-rerank-preserve-relevant`.trim()
            : filterResult.comment || '',
          selectedIndexes: filterResult.selectedIndexes,
        };
        if (shouldUseSoftLlmRerank && filteredItems.length !== selected.length) {
          console.log(
            `🪶 [KassirAPI] LLM использован как мягкий rerank: сохранено ${filteredItems.length}/${llmCandidates.length} ` +
              `релевантных событий вместо жёсткого отсечения до ${selected.length}`
          );
        }
      } else {
        if (isShortMusicGenre) {
          if (detectedShortGenre && RAP_EQUIVALENTS.has(detectedShortGenre)) {
            const fallbackItems = applyRapRescueFilter(llmCandidates);
            filteredItems = fallbackItems;
            filterInfo = {
              comment:
                `${filterResult.comment || 'llm-filtered-all-out'} rap-fallback-negative-filter`.trim(),
              selectedIndexes: [],
            };
            console.log(
              '⚠️ [KassirAPI] LLM фильтр для короткого жанра (рэп) не выбрал событий, используем fallback negative-filter.'
            );
          } else {
            const fallback = applyMusicNonConcertNegativeFilter(llmCandidates);
            filteredItems =
              Array.isArray(fallback) && fallback.length > 0 ? fallback : llmCandidates;
            filterInfo = {
              comment:
                `${filterResult.comment || 'llm-filtered-all-out'} short-genre-fallback-to-candidates`.trim(),
              selectedIndexes: [],
            };
            console.log(
              '⚠️ [KassirAPI] LLM фильтр для короткого жанра не выбрал событий, возвращаю кандидатов без LLM.'
            );
          }
        } else if (effectiveIntent === 'mood') {
          filteredItems = [];
          filterInfo = {
            comment: filterResult.comment || 'llm-filtered-all-out(mood)',
            selectedIndexes: [],
          };
          console.log('⚠️ [KassirAPI] LLM mood-фильтр не выбрал событий, возвращаю пустой список.');
        } else {
          filteredItems = baseCandidates;
          filterInfo = {
            comment: filterResult.comment || 'llm-empty-fallback',
            selectedIndexes: [],
          };
          console.log(
            '⚠️ [KassirAPI] LLM фильтр не выбрал событий, возвращаем оригинальный список.'
          );
        }
      }
    }
  }

  if (detectedShortGenre && RAP_EQUIVALENTS.has(detectedShortGenre)) {
    const beforeCount = filteredItems.length;
    filteredItems = applyRapNegativeFilter(filteredItems);
    if (filteredItems.length !== beforeCount) {
      filterInfo = {
        comment: `${filterInfo?.comment || ''} rap-negative-filter`.trim(),
        selectedIndexes: (filterInfo?.selectedIndexes || []).slice(),
      };
      console.log(
        `🧹 [KassirAPI] Рэп-фильтр: удалено нерелевантных (джаз/оркестр/brass/театр): ${beforeCount - filteredItems.length}`
      );
    }

    const minDesired = 4;
    if (filteredItems.length > 0 && filteredItems.length < minDesired) {
      const rescued = applyRapRescueFilter(baseCandidates);
      const existingIds = new Set(
        filteredItems
          .map(
            (item) =>
              item?.object?.id ??
              item?.id ??
              item?.object?.backofficeId ??
              item?.object?.activity?.id
          )
          .map((value) => (value === null || value === undefined ? null : String(value)))
          .filter(Boolean)
      );

      let added = 0;
      rescued.forEach((item) => {
        const idCandidate =
          item?.object?.id ?? item?.id ?? item?.object?.backofficeId ?? item?.object?.activity?.id;
        const idKey =
          idCandidate === null || idCandidate === undefined ? null : String(idCandidate);
        if (idKey && existingIds.has(idKey)) {
          return;
        }
        filteredItems.push(item);
        if (idKey) {
          existingIds.add(idKey);
        }
        added += 1;
      });

      if (added > 0) {
        filterInfo = {
          comment: `${filterInfo?.comment || ''} rap-positive-rescue(+${added})`.trim(),
          selectedIndexes: (filterInfo?.selectedIndexes || []).slice(),
        };
        console.log(`🛟 [KassirAPI] Рэп-rescue: добавлено по позитивным маркерам: ${added}`);
      }
    }

    if (filteredItems.length > 0 && filteredItems.length < minDesired) {
      const pool = applyRapNegativeFilter(baseCandidates);
      const existingIds = new Set(
        filteredItems
          .map(
            (item) =>
              item?.object?.id ??
              item?.id ??
              item?.object?.backofficeId ??
              item?.object?.activity?.id
          )
          .map((value) => (value === null || value === undefined ? null : String(value)))
          .filter(Boolean)
      );

      const poolSorted = pool.slice().sort((a, b) => scoreRapCandidate(b) - scoreRapCandidate(a));

      let added = 0;
      for (const item of poolSorted) {
        if (filteredItems.length >= minDesired) {
          break;
        }
        const idCandidate =
          item?.object?.id ?? item?.id ?? item?.object?.backofficeId ?? item?.object?.activity?.id;
        const idKey =
          idCandidate === null || idCandidate === undefined ? null : String(idCandidate);
        if (idKey && existingIds.has(idKey)) {
          continue;
        }
        filteredItems.push(item);
        if (idKey) {
          existingIds.add(idKey);
        }
        added += 1;
      }

      if (added > 0) {
        filterInfo = {
          comment: `${filterInfo?.comment || ''} rap-backfill(+${added})`.trim(),
          selectedIndexes: (filterInfo?.selectedIndexes || []).slice(),
        };
        console.log(
          `🧩 [KassirAPI] Рэп-backfill: добили выдачу из negative-filter кандидатов: +${added} (minDesired=${minDesired})`
        );
      }
    }
  }

  if (isShortMusicGenre && detectedShortGenre && !RAP_EQUIVALENTS.has(detectedShortGenre)) {
    const minDesired = Math.min(5, baseCandidates.length);
    if (filteredItems.length > 0 && filteredItems.length < minDesired) {
      const backfilled = backfillShortGenreResults({
        filteredItems,
        baseCandidates:
          Array.isArray(shortGenreFiltered) && shortGenreFiltered.length > 0
            ? shortGenreFiltered
            : baseCandidates,
        detectedShortGenre,
        minDesired,
      });

      if (backfilled.added > 0) {
        filteredItems = backfilled.items;
        filterInfo = {
          comment: `${filterInfo?.comment || ''} short-genre-backfill(+${backfilled.added})`.trim(),
          selectedIndexes: (filterInfo?.selectedIndexes || []).slice(),
        };
        console.log(
          `🧩 [KassirAPI] Добрал событий для жанра "${detectedShortGenre}": +${backfilled.added} (итого ${filteredItems.length})`
        );
      }
    }
  }

  filteredItems.forEach((item, index) => {
    const summary = extractEventSummary(item);
    const pricePart =
      summary.priceMin != null && summary.priceMax != null
        ? `${summary.priceMin}-${summary.priceMax}`
        : summary.priceMin != null
          ? `${summary.priceMin}`
          : summary.priceMax != null
            ? `${summary.priceMax}`
            : '—';
    console.log(
      `   ${index + 1}. ${summary.title} | дата: ${summary.date || '—'} | цены: ${pricePart}`
    );
  });

  return {
    baseCandidates,
    filteredItems,
    filterInfo,
  };
}

export { selectRelevantItems };
