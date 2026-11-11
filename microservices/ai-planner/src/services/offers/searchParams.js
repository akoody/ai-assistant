import {
  enrichSlotWithDateConsideringSlots,
  isCalendarSchedulingOnlySearchString,
  isCalendarSchedulingSearchNoiseToken,
} from '../dateParsingUtils.js';
import { parseBudgetValue } from '../../../../../shared/moneyUtils.js';
import { isVagueArtistDescriptor } from '../../../../../shared/vagueArtistUtils.js';
import {
  DEFAULT_SLUG,
  CHILD_SLUG,
  DEFAULT_SORT,
  DEFAULT_PLATFORM_STATE,
  DEFAULT_DOMAIN,
} from './searchDefinitions.js';
import {
  normalizeSearchFacetValue,
  isGenericMoodSearchQueryValue,
  isPopularitySortOnlyValue,
  removePopularitySortOnlyTokens,
  isInvalidArtistSlotForStrictSearch,
  resolveCategorySearchRouting,
  resolveChildAgeGenreSlug,
  shouldOmitCategoryFacetFromKeyword,
  resolveMoodSearchRouting,
  resolvePopularCitySelectionSlug,
} from './searchRouting.js';
import { normalizeCityValue, getDomainForCity } from './cityDomains.js';
import { formatDateForKassir } from './budgetPolicy.js';

const SPECIFIC_QUERY_SLOTS = new Set([
  'жанр',
  'жанр_музыки',
  'предпочтения_жанры',
  'тип_события',
  'тип_мероприятия',
  'категория',
  'исполнитель',
  'название_мероприятия',
]);

const META_PREFERENCE_QUERY_STEMS = new Set([
  'из',
  'по',
  'мо',
  'сво',
  'любим',
  'нрав',
  'предпочт',
  'вкус',
  'что',
  'то',
  'мне',
  'я',
  'оно',
  'это',
]);

function normalizeMetaPreferenceStem(token = '') {
  const normalized = String(token || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .trim();

  if (!normalized) return '';
  if (normalized === 'из' || normalized === 'по') return normalized;
  if (normalized.startsWith('мо')) return 'мо';
  if (normalized.startsWith('сво')) return 'сво';
  if (normalized.startsWith('любим') || normalized.startsWith('любл')) return 'любим';
  if (normalized.startsWith('нрав')) return 'нрав';
  if (normalized.startsWith('предпочт')) return 'предпочт';
  if (normalized.startsWith('вкус')) return 'вкус';
  if (normalized.startsWith('что')) return 'что';
  if (normalized === 'то') return 'то';
  if (normalized === 'мне') return 'мне';
  if (normalized === 'я') return 'я';
  if (normalized === 'это') return 'это';
  if (normalized === 'оно') return 'оно';

  return normalized;
}

function isMetaPreferenceSearchQueryValue(value = '') {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[.,!?;:()[\]{}"'`«»]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return false;
  }

  const directMetaPatterns = [
    /^из\s+любим(?:ого|ых)?$/u,
    /^из\s+того,\s*что\s+(?:я|мне)\s+(?:люблю|нравится)$/u,
    /^по\s+мо(?:им|ему|им)?\s+предпочт/u,
    /^по\s+сво(?:им|ему|им)?\s+предпочт/u,
    /^по\s+вкус/u,
    /^что\s+(?:я\s+люблю|мне\s+нрав)/u,
    /^мо(?:е|ё|и)?\s+любим(?:ое|ые)?$/u,
    /^сво(?:е|ё|и)?\s+любим(?:ое|ые)?$/u,
  ];

  if (directMetaPatterns.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  const tokens = normalized.match(/[\p{L}\p{N}]+/gu) || [];
  if (tokens.length === 0) {
    return false;
  }

  const stems = tokens.map(normalizeMetaPreferenceStem).filter(Boolean);
  if (stems.length === 0) {
    return false;
  }

  const hasPreferenceCue = stems.some(
    (stem) => stem === 'любим' || stem === 'нрав' || stem === 'предпочт' || stem === 'вкус'
  );

  if (!hasPreferenceCue) {
    return false;
  }

  return stems.every((stem) => META_PREFERENCE_QUERY_STEMS.has(stem));
}

function addQueryPart(collection, value) {
  if (!value) {
    return;
  }

  const stringValue = String(value).trim();
  if (!stringValue) {
    return;
  }

  collection.push(stringValue);
}

function normalizeArtistNameForSearch(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const normalized = raw.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  const parts = normalized.split(' ').filter(Boolean);
  if (parts.length < 2 || parts.length > 3) return null;

  // Очень осторожная эвристика: полное имя/фамилия в родительном падеже часто заканчиваются на "а"
  // ("егора крида" -> "егор крид"). Применяем только если все части заканчиваются на "а".
  if (!parts.every((p) => p.length >= 4 && p.endsWith('а'))) return null;

  const converted = parts
    .map((p) => p.slice(0, -1))
    .join(' ')
    .trim();
  if (!converted || converted === normalized) return null;
  return converted;
}

function buildSearchParamsFromSlots(
  slots,
  fallbackQuery = '',
  keywordOverride = null,
  dateContextText = ''
) {
  const filteredSlots = slots.filter((slot) => {
    if (slot.isNegative) {
      console.log(
        `🚫 [buildSearchParamsFromSlots] Игнорирую негативный слот: ${slot.name} = ${slot.value}`
      );
      return false;
    }
    return true;
  });

  // определяем есть ли романтический контекст
  const moodSlot = filteredSlots.find((s) => s.name === 'настроение');
  const contextSlotForMood = filteredSlots.find((s) => s.name === 'контекст_события');
  const moodVal = moodSlot ? String(moodSlot.value || '').toLowerCase() : '';
  const contextVal = contextSlotForMood ? String(contextSlotForMood.value || '').toLowerCase() : '';
  const hasRomanticMood =
    /(романт|свидани|для\s*двоих|влюблен)/i.test(moodVal) || /(романт|свидани)/i.test(contextVal);

  // Используем конкретные слоты для keyword.
  // 'поисковый_запрос' тоже учитываем (если он достаточно конкретный), иначе запросы
  // вроде "хочу на каток" превращаются в поиск без keyword и дают нерелевантную выдачу.
  const queryParts = [];
  const ignoreForQuery = new Set([
    'город',
    'дата_события',
    'цена_от',
    'цена_до',
    'бюджет',
    'объект',
    'количество',
    'возрастное_ограничение',
    'возраст_ребенка',
    'настроение', // Настроение используется LLM в context для определения категории, но не добавляется в keyword
  ]);

  let detectedDomain;
  let dateFromFormatted;
  let dateToFormatted;
  let priceMinValue;
  let priceMaxValue;
  let budgetValue;
  let hasExplicitDate = false;
  let isChildAudience = false;
  let hasAudienceSlot = false;
  let requestedChildAge = null;
  let hasStrictNamedTarget = false;
  const eventTypeValues = [];
  const genreValues = [];
  const normalizedFacetValuesExcludingArtist = new Set(
    filteredSlots
      .filter(
        (slot) =>
          slot &&
          [
            'тип_события',
            'тип_мероприятия',
            'категория',
            'жанр',
            'жанр_музыки',
            'предпочтения_жанры',
          ].includes(slot.name)
      )
      .map((slot) => normalizeSearchFacetValue(slot.value))
      .filter(Boolean)
  );

  for (const slot of filteredSlots) {
    const slotName = slot.name;
    const slotValue = slot.value;
    switch (slotName) {
      case 'город': {
        const city = normalizeCityValue(slotValue);
        if (city) {
          const domain = getDomainForCity(city);
          if (domain) {
            detectedDomain = domain;
          }
        }
        break;
      }
      case 'дата_события': {
        const normalizedDateSlot = enrichSlotWithDateConsideringSlots(
          slot,
          filteredSlots,
          dateContextText
        );

        if (normalizedDateSlot.dateRange) {
          const startDate = new Date(normalizedDateSlot.dateRange.startDate);
          const endDate = new Date(normalizedDateSlot.dateRange.endDate);
          dateFromFormatted = formatDateForKassir(startDate);
          dateToFormatted = formatDateForKassir(endDate);
          hasExplicitDate = true;
        } else if (normalizedDateSlot.parsedDate) {
          const date = new Date(normalizedDateSlot.parsedDate);
          dateFromFormatted = formatDateForKassir(date);
          dateToFormatted = formatDateForKassir(date);
          hasExplicitDate = true;
        }
        break;
      }
      case 'жанр':
      case 'жанр_музыки':
      case 'предпочтения_жанры': {
        if (isPopularitySortOnlyValue(slotValue)) {
          console.log(
            `↕️ [buildSearchParamsFromSlots] Игнорирую сортировочный слот "${slotName}: ${slotValue}" для keyword; sort=${DEFAULT_SORT} уже означает популярное`
          );
          break;
        }
        // Используем только конкретные слоты жанра
        addQueryPart(queryParts, slotValue);
        genreValues.push(slotValue);
        break;
      }
      case 'тип_события':
      case 'тип_мероприятия':
      case 'категория': {
        if (hasRomanticMood) {
          console.log(
            `💕 [buildSearchParamsFromSlots] Романтический контекст: сохраняю явный слот "${slotName}: ${slotValue}" в keyword`
          );
        }
        // Используем только конкретные слоты типа/категории
        addQueryPart(queryParts, slotValue);
        eventTypeValues.push(slotValue);
        break;
      }
      case 'исполнитель':
      case 'название_мероприятия': {
        const isVagueArtist = slotName === 'исполнитель' && isVagueArtistDescriptor(slotValue);
        const isInvalidArtist =
          slotName === 'исполнитель' && isInvalidArtistSlotForStrictSearch(slotValue);
        const normalizedArtistValue = normalizeSearchFacetValue(slotValue);
        const conflictsWithKnownFacet =
          slotName === 'исполнитель' &&
          Boolean(
            normalizedArtistValue && normalizedFacetValuesExcludingArtist.has(normalizedArtistValue)
          );
        if (isVagueArtist || isInvalidArtist) {
          console.log(
            `🪶 [buildSearchParamsFromSlots] Игнорирую слот исполнителя "${slotValue}" ` +
              'для strict search и keyword: значение расплывчатое или похоже на дату/жанр/категорию/настроение'
          );
          break;
        }
        if (conflictsWithKnownFacet) {
          console.log(
            `🪶 [buildSearchParamsFromSlots] Игнорирую слот исполнителя "${slotValue}" ` +
              'для strict search и keyword: значение совпадает с уже найденным жанром/категорией'
          );
          break;
        }
        hasStrictNamedTarget = true;
        // Используем конкретные слоты исполнителя/названия
        addQueryPart(queryParts, slotValue);
        if (slotName === 'исполнитель') {
          const normalizedArtist = normalizeArtistNameForSearch(slotValue);
          if (normalizedArtist) {
            addQueryPart(queryParts, normalizedArtist);
          }
        }
        break;
      }
      case 'поисковый_запрос': {
        if (isGenericMoodSearchQueryValue(slotValue)) {
          break;
        }
        if (isMetaPreferenceSearchQueryValue(slotValue)) {
          console.log(
            `🧠 [buildSearchParamsFromSlots] Игнорирую meta-поисковый_запрос "${slotValue}" ` +
              'для Kassir keyword: это ссылка на предпочтения, а не текст для полнотекстового поиска'
          );
          break;
        }
        const raw = String(slotValue || '').trim();
        if (!raw || isCalendarSchedulingOnlySearchString(raw)) {
          break;
        }
        const cleaned = raw
          .toLowerCase()
          .replace(/ё/g, 'е')
          .replace(/[.,!?;:()[\]{}"'`«»]/gu, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .split(' ')
          .filter(Boolean)
          .filter((t) => !isCalendarSchedulingSearchNoiseToken(t))
          .filter((t) => !isPopularitySortOnlyValue(t))
          .filter((t) => t.length > 2)
          .join(' ')
          .trim();
        if (!cleaned) {
          break;
        }
        addQueryPart(queryParts, cleaned);
        break;
      }
      case 'цена_от': {
        const minPrice = parseBudgetValue(slotValue);
        if (Number.isFinite(minPrice) && minPrice > 0) {
          priceMinValue = minPrice;
        }
        break;
      }
      case 'цена_до': {
        const maxPrice = parseBudgetValue(slotValue);
        if (Number.isFinite(maxPrice) && maxPrice > 0) {
          priceMaxValue = maxPrice;
        }
        break;
      }
      case 'бюджет': {
        const budget = parseBudgetValue(slotValue);
        if (Number.isFinite(budget) && budget > 0) {
          budgetValue = budget;
        }
        break;
      }
      case 'возрастное_ограничение': {
        hasAudienceSlot = true;
        const normalizedAudience = String(slotValue || '').toLowerCase();
        console.log(
          `🔍 [buildSearchParamsFromSlots] Обработка возрастного_ограничения: "${slotValue}" -> normalized: "${normalizedAudience}"`
        );
        if (normalizedAudience.includes('дет')) {
          isChildAudience = true;
        } else if (normalizedAudience.includes('взросл')) {
          // НЕ перезаписываем isChildAudience, если явно указан возраст ребенка!
          if (requestedChildAge === null) {
            isChildAudience = false;
          }
        } else if (normalizedAudience.includes('молод') || normalizedAudience === 'молодёжь') {
          // Для молодежи используем взрослую афишу, но добавляем в keyword для фильтрации
          if (requestedChildAge === null) {
            isChildAudience = false;
          }
          // Добавляем "молодёжь" в keyword для поиска подходящих событий
          console.log(`✅ [buildSearchParamsFromSlots] Добавляю "молодёжь" в keyword`);
          addQueryPart(queryParts, 'молодёжь');
        } else {
          // fallback на взрослую афишу (если нет явного ребенка)
          if (requestedChildAge === null) {
            isChildAudience = false;
          }
        }
        break;
      }
      case 'возраст_ребенка': {
        const parsedChildAge = Number.parseInt(String(slotValue || '').replace(/[^0-9]/g, ''), 10);
        if (Number.isFinite(parsedChildAge) && parsedChildAge >= 0 && parsedChildAge <= 17) {
          hasAudienceSlot = true;
          isChildAudience = true;
          requestedChildAge = parsedChildAge;
        }
        break;
      }
      default: {
        // Для остальных слотов проверяем, являются ли они конкретными запросами
        if (!ignoreForQuery.has(slotName) && SPECIFIC_QUERY_SLOTS.has(slotName)) {
          addQueryPart(queryParts, slotValue);
        }
        break;
      }
    }
  }

  const uniqueQueryParts = Array.from(new Set(queryParts.map((part) => part.toLowerCase())))
    .map((lowerPart) => queryParts.find((part) => part.toLowerCase() === lowerPart))
    .filter(Boolean);

  if (!hasAudienceSlot) {
    isChildAudience = false;
  }

  if (isChildAudience) {
    const childConcertSignal = [
      ...genreValues,
      ...eventTypeValues,
      fallbackQuery,
      keywordOverride,
      uniqueQueryParts.join(' '),
    ]
      .filter(Boolean)
      .map((t) => String(t).toLowerCase().replace(/ё/g, 'е'))
      .join(' | ');
    const hasChildConcertPhrase =
      /детск\w*\s+концерт/u.test(childConcertSignal) ||
      /концерт\w*\s+для\s*дет/u.test(childConcertSignal);
    const alreadyHasChildConcertGenre = genreValues.some((g) =>
      /детск.*концерт/u.test(
        String(g || '')
          .toLowerCase()
          .replace(/ё/g, 'е')
      )
    );
    if (hasChildConcertPhrase && !alreadyHasChildConcertGenre) {
      genreValues.push('детские концерты');
      console.log(
        '🧒 [buildSearchParamsFromSlots] Явный сигнал детских концертов в фасетах/тексте — ' +
          'добавляю жанр для slug /detskaya-afisha/koncert/'
      );
    }
  }

  // Cross-slot: театр/спектакль + детям → детские спектакли
  if (!isChildAudience) {
    const hasTheaterType = eventTypeValues.some((v) =>
      /театр|спектакл/u.test(
        String(v || '')
          .toLowerCase()
          .replace(/ё/g, 'е')
      )
    );
    const hasChildrenInSlots = filteredSlots.some((slot) => {
      if (!slot || slot.isNegative) return false;
      const sn = String(slot.name || '').trim();
      const sv = String(slot.value || '')
        .toLowerCase()
        .replace(/ё/g, 'е')
        .trim();
      if (sn === 'настроение' || sn === 'контекст_события') {
        return /детям|для\s*дет|детск|ребенк|малыш/u.test(sv);
      }
      return false;
    });
    const hasChildrenInFallback = /детям|для\s*дет|детск|ребенк|малыш/u.test(
      String(fallbackQuery || '')
        .toLowerCase()
        .replace(/ё/g, 'е')
    );

    if (hasTheaterType && (hasChildrenInSlots || hasChildrenInFallback)) {
      isChildAudience = true;
      genreValues.push('детские спектакли');
      console.log(
        '🎭 [buildSearchParamsFromSlots] Сигнал "театр/спектакль детям" → перенаправляю в /detskaya-afisha/spectakli/'
      );
    }
  }

  const moodRouting = resolveMoodSearchRouting({
    slots: filteredSlots,
    fallbackQuery,
    keywordOverride,
  });
  const popularSelectionSlug = resolvePopularCitySelectionSlug({
    slots: filteredSlots,
    fallbackQuery,
    keywordOverride,
    userMessage: dateContextText,
  });
  const categoryRouting = hasStrictNamedTarget
    ? null
    : resolveCategorySearchRouting({
        typeValues: eventTypeValues,
        genreValues,
        fallbackValues: [fallbackQuery, keywordOverride],
        isChildAudience,
      });
  const childAgeGenreSlug = resolveChildAgeGenreSlug(requestedChildAge);
  let selectedSlug =
    moodRouting?.primary?.slug ||
    popularSelectionSlug ||
    categoryRouting?.slug ||
    (isChildAudience ? CHILD_SLUG : DEFAULT_SLUG);

  const shouldApplyChildAgeGenreFallback =
    isChildAudience &&
    childAgeGenreSlug &&
    (!categoryRouting ||
      (categoryRouting.categoryConfig?.key === 'children' && categoryRouting.slug === CHILD_SLUG));

  if (shouldApplyChildAgeGenreFallback) {
    selectedSlug = childAgeGenreSlug;
    console.log(
      `🧒 [buildSearchParamsFromSlots] Возраст ребёнка ${requestedChildAge}: ` +
        `использую возрастной детский slug ${selectedSlug} вместо общей детской афиши`
    );
  }

  const normalizedEventTypeValues = new Set(
    eventTypeValues.map((value) => normalizeSearchFacetValue(value)).filter(Boolean)
  );
  let effectiveQueryParts = categoryRouting
    ? uniqueQueryParts.filter((part) => !shouldOmitCategoryFacetFromKeyword(part, categoryRouting))
    : uniqueQueryParts;

  if (popularSelectionSlug) {
    effectiveQueryParts = [];
  }

  if (hasStrictNamedTarget && normalizedEventTypeValues.size > 0) {
    effectiveQueryParts = effectiveQueryParts.filter((part) => {
      const normalizedPart = normalizeSearchFacetValue(part);
      return !normalizedEventTypeValues.has(normalizedPart);
    });
    console.log(
      '🎯 [buildSearchParamsFromSlots] Найден именованный запрос: использую общий поиск и убираю категорийные фильтры из keyword'
    );
  }

  const params = {
    slug: selectedSlug,
    platformState: DEFAULT_PLATFORM_STATE,
    sort: DEFAULT_SORT,
    domain: detectedDomain || DEFAULT_DOMAIN,
  };

  const override = typeof keywordOverride === 'string' ? keywordOverride.trim() : '';
  const effectiveOverride = moodRouting
    ? ''
    : popularSelectionSlug
      ? ''
      : isPopularitySortOnlyValue(override) ||
          (categoryRouting && shouldOmitCategoryFacetFromKeyword(override, categoryRouting))
        ? ''
        : override;
  const baseKeyword = moodRouting
    ? ''
    : removePopularitySortOnlyTokens(
        effectiveQueryParts.length > 0 ? effectiveQueryParts.join(' ') : ''
      );
  const normalizedSelectedSlug = String(selectedSlug || '').trim();
  if (moodRouting?.primary) {
    console.log(
      `🎭 [buildSearchParamsFromSlots] Mood routing (${moodRouting.key}): использую первичный slug ${normalizedSelectedSlug}`
    );
  } else if (categoryRouting?.categoryConfig) {
    console.log(
      `🧭 [buildSearchParamsFromSlots] Категорийный slug распознан (${categoryRouting.categoryConfig.key}), использую slug ${normalizedSelectedSlug} ` +
        `и keyword "${baseKeyword || '∅'}"`
    );
  } else if (popularSelectionSlug) {
    console.log(
      `🔥 [buildSearchParamsFromSlots] Неопределённый запрос по городу: использую подборку популярных событий ${normalizedSelectedSlug}`
    );
  }
  if (effectiveOverride) {
    const overrideLower = effectiveOverride.toLowerCase();
    const baseLower = baseKeyword.toLowerCase();
    if (baseKeyword && !baseLower.includes(overrideLower)) {
      params.keyword = `${effectiveOverride} ${baseKeyword}`;
    } else if (baseKeyword) {
      params.keyword = baseKeyword;
    } else {
      params.keyword = effectiveOverride;
    }
  } else if (baseKeyword) {
    params.keyword = baseKeyword;
  }

  if (!params.keyword && moodRouting?.primary?.keyword) {
    params.keyword = moodRouting.primary.keyword;
  }

  if (hasExplicitDate) {
    params.date_from = dateFromFormatted;
    params.date_to = dateToFormatted;
    console.log(
      `📅 [buildSearchParamsFromSlots] Установлена явная дата: ${dateFromFormatted} - ${dateToFormatted}`
    );
  } else {
    console.log(
      '📅 [buildSearchParamsFromSlots] Явная дата не указана - не ограничиваю поиск по date_from/date_to'
    );
  }

  if (typeof priceMinValue === 'number' && !Number.isNaN(priceMinValue) && priceMinValue > 0) {
    params.price_from = priceMinValue;
  }

  const upperBounds = [priceMaxValue, budgetValue].filter(
    (value) => typeof value === 'number' && !Number.isNaN(value) && value > 0
  );

  if (upperBounds.length > 0) {
    params.price_to = Math.min(...upperBounds);
    if (params.price_from === undefined) {
      params.price_from = 0;
    }
  }

  return params;
}

export { buildSearchParamsFromSlots };
