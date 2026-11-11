import { DEFAULT_SLUG } from './searchDefinitions.js';
import {
  normalizeSearchFacetValue,
  AMBIGUOUS_CATEGORY_SHOW_ALL_SLOT_NAME,
  getAmbiguousGenreShowAllRouteDefinitions,
  pruneBroadRootCandidatesWhenSpecificGenreSlugExists,
  resolveMoodSearchRouting,
  hasBroadMultiCategorySelectionText,
  resolvePopularCitySelectionSlug,
} from './searchRouting.js';
import { buildSearchParamsFromSlots } from './searchParams.js';

function buildSearchPlanFromSlots(
  slots,
  fallbackQuery = '',
  keywordOverride = null,
  dateContextText = ''
) {
  const effectiveSlots = Array.isArray(slots)
    ? slots.filter((slot) => slot && !slot.isNegative)
    : [];
  const popularSelectionSlug = resolvePopularCitySelectionSlug({
    slots,
    fallbackQuery,
    keywordOverride,
    userMessage: dateContextText,
  });

  // 1. Проверяем на широкий мульти-категорийный запрос (по тексту или по количеству категорий)
  const eventTypeSlotNames = new Set(['тип_мероприятия', 'тип_события', 'категория']);
  const eventTypeSlots = effectiveSlots.filter((s) => eventTypeSlotNames.has(s.name));
  const uniqueCategoryValues = new Set(
    eventTypeSlots.map((s) => normalizeSearchFacetValue(s.value)).filter(Boolean)
  );

  const textCandidates = [fallbackQuery, keywordOverride, dateContextText].filter(Boolean);
  const hasBroadSignal = textCandidates.some((text) => hasBroadMultiCategorySelectionText(text));

  if (!popularSelectionSlug && (uniqueCategoryValues.size > 1 || hasBroadSignal)) {
    console.log(
      `🌐 [buildSearchPlanFromSlots] Переключение на широкий поиск (категорий: ${uniqueCategoryValues.size}, broadSignal: ${hasBroadSignal})`
    );
    const params = buildSearchParamsFromSlots(
      slots,
      fallbackQuery,
      keywordOverride,
      dateContextText
    );

    // Принудительно используем общий раздел поиска, так как категорий несколько
    params.slug = DEFAULT_SLUG;
    params.isBroadSearch = true;

    return {
      primaryParams: params,
      candidates: [
        {
          params,
          label: 'Все мероприятия',
          source: uniqueCategoryValues.size > 1 ? 'multi_category' : 'broad_text',
        },
      ],
      moodProfileKey: null,
      popularSelectionSlug: null,
    };
  }

  const moodRouting = resolveMoodSearchRouting({ slots, fallbackQuery, keywordOverride });

  const genreSlotNames = new Set(['жанр', 'жанр_музыки', 'предпочтения_жанры']);
  const genreSlots = effectiveSlots.filter(
    (slot) =>
      genreSlotNames.has(String(slot?.name || '').trim()) && String(slot?.value || '').trim()
  );

  if (!moodRouting) {
    const ambiguousCategoryRouteDefinitions =
      getAmbiguousGenreShowAllRouteDefinitions(effectiveSlots);
    if (ambiguousCategoryRouteDefinitions.length > 1) {
      const candidateBaseSlots = effectiveSlots.filter(
        (slot) =>
          String(slot?.name || '').trim() !== AMBIGUOUS_CATEGORY_SHOW_ALL_SLOT_NAME &&
          !['тип_мероприятия', 'тип_события', 'категория'].includes(String(slot?.name || '').trim())
      );
      const candidates = [];
      const seen = new Set();

      ambiguousCategoryRouteDefinitions.forEach((route) => {
        const params = buildSearchParamsFromSlots(
          [
            ...candidateBaseSlots,
            {
              name: 'тип_мероприятия',
              value: route.label,
              confidence: 0.95,
              source: 'ambiguous_category_show_all',
            },
          ],
          fallbackQuery,
          keywordOverride,
          dateContextText
        );
        const signature = JSON.stringify(params);
        if (seen.has(signature)) {
          return;
        }

        seen.add(signature);
        candidates.push({
          params,
          label: route.label,
          source: route.source,
        });
      });

      if (candidates.length > 1) {
        return {
          primaryParams: candidates[0].params,
          candidates,
          moodProfileKey: null,
          popularSelectionSlug,
          ambiguousCategoryShowAll: true,
        };
      }
    }

    if (genreSlots.length > 1) {
      const nonGenreSlots = effectiveSlots.filter(
        (slot) => !genreSlotNames.has(String(slot?.name || '').trim())
      );
      const candidates = [];
      const seen = new Set();

      genreSlots.forEach((genreSlot, index) => {
        const params = buildSearchParamsFromSlots(
          [...nonGenreSlots, genreSlot],
          fallbackQuery,
          keywordOverride,
          dateContextText
        );
        const signature = JSON.stringify(params);
        if (seen.has(signature)) {
          return;
        }

        seen.add(signature);
        candidates.push({
          params,
          label: `genre:${String(genreSlot.value || '').trim() || index + 1}`,
          source: `genre:${normalizeSearchFacetValue(genreSlot.value || '') || index + 1}`,
        });
      });

      const prunedCandidates = pruneBroadRootCandidatesWhenSpecificGenreSlugExists(candidates);

      if (prunedCandidates.length > 1) {
        // Several genre routes are searched independently; the primary route must not carry
        // a keyword that belongs to only one of them.
        const { keyword: _routeKeyword, ...primaryParams } = prunedCandidates[0].params;
        return {
          primaryParams,
          candidates: prunedCandidates,
          moodProfileKey: null,
          popularSelectionSlug,
        };
      }

      if (prunedCandidates.length === 1) {
        return {
          primaryParams: prunedCandidates[0].params,
          candidates: prunedCandidates,
          moodProfileKey: null,
          popularSelectionSlug,
        };
      }
    }

    const primaryParams = buildSearchParamsFromSlots(
      slots,
      fallbackQuery,
      keywordOverride,
      dateContextText
    );
    return {
      primaryParams,
      candidates: [
        {
          params: primaryParams,
          label: 'default',
          source: 'default',
        },
      ],
      moodProfileKey: null,
      popularSelectionSlug,
    };
  }

  const primaryParams = buildSearchParamsFromSlots(
    slots,
    fallbackQuery,
    keywordOverride,
    dateContextText
  );
  const sharedParams = { ...primaryParams };
  delete sharedParams.keyword;

  const candidates = [];
  const seen = new Set();

  moodRouting.routes.forEach((route, index) => {
    if (!route?.slug) {
      return;
    }

    const params = {
      ...sharedParams,
      slug: route.slug,
    };

    if (route.keyword) {
      params.keyword = route.keyword;
    }

    const signature = JSON.stringify(params);
    if (seen.has(signature)) {
      return;
    }

    seen.add(signature);
    candidates.push({
      params,
      label: route.label || route.key || `mood-route-${index + 1}`,
      source: `mood:${moodRouting.key}:${route.key || index + 1}`,
    });
  });

  if (candidates.length === 0) {
    candidates.push({
      params: primaryParams,
      label: 'default',
      source: 'default',
    });
  }

  return {
    primaryParams,
    candidates,
    moodProfileKey: moodRouting.key,
    popularSelectionSlug,
  };
}

export { buildSearchPlanFromSlots };
