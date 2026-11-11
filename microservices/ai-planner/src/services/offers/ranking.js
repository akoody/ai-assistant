import { isVagueArtistDescriptor } from '../../../../../shared/vagueArtistUtils.js';
import {
  normalizeSearchFacetValue,
  isGenericMoodSearchQueryValue,
  isSeniorFriendlyEventCandidate,
  hasSeniorFriendlyContext,
  isFamilyContextValue,
} from './searchRouting.js';
import { getPositiveGenreSlots } from './eventIdentity.js';
import { parseEventDates, scoreDateMatch, scoreDateProximity } from './dateScoring.js';
import {
  isTheaterPerformanceRequestValue,
  isTheaterPerformanceCandidate,
  scoreGenreTypeMatch,
  scoreContextMatch,
  scoreSeniorFriendlyMatch,
  scorePriceMatch,
  scoreMoodMatch,
} from './eventScoring.js';
import { getStrictSearchMatchScore, shouldTrustSingleNamedSearchResult } from './namedSearch.js';

function rankEvents(events, slots, dateContextText = '') {
  if (!Array.isArray(events) || events.length === 0) {
    return events;
  }

  // Извлекаем слоты
  const dateSlot = slots.find((s) => s.name === 'дата_события');
  const genreSlots = getPositiveGenreSlots(slots);
  const hasGenreCriteria = genreSlots.length > 0;
  const typeSlot = slots.find(
    (s) => s.name === 'тип_события' || s.name === 'тип_мероприятия' || s.name === 'категория'
  );
  const contextSlot = slots.find((s) => s.name === 'контекст_события');
  const moodSlot = slots.find((s) => s.name === 'настроение');
  const budgetSlot = slots.find((s) => s.name === 'бюджет');
  const priceToSlot = slots.find((s) => s.name === 'цена_до');

  // Слоты для строгого текстового поиска
  const searchQuerySlot = slots.find((s) => s.name === 'поисковый_запрос');
  const artistSlot = slots.find(
    (s) => s.name === 'исполнитель' && !isVagueArtistDescriptor(s.value)
  );
  const eventNameSlot = slots.find((s) => s.name === 'название_мероприятия');
  const hasStrictArtistSearch = Boolean(artistSlot && artistSlot.value);

  // Определяем, есть ли строгий поисковый запрос
  // Игнорируем общие слова типа "все", "куда сходить" и т.д.
  let specificSearchQuery = null;
  let strictSearchSource = null;

  if (artistSlot && artistSlot.value) {
    specificSearchQuery = String(artistSlot.value).toLowerCase().trim();
    strictSearchSource = 'artist';
  } else if (eventNameSlot && eventNameSlot.value) {
    specificSearchQuery = String(eventNameSlot.value).toLowerCase().trim();
    strictSearchSource = 'event_name';
  } else if (searchQuerySlot && searchQuerySlot.value) {
    const normalizedSearchQuery = normalizeSearchFacetValue(searchQuerySlot.value);
    if (normalizedSearchQuery && !isGenericMoodSearchQueryValue(normalizedSearchQuery)) {
      const hasGenreOrTypeCriteria = hasGenreCriteria || (typeSlot && typeSlot.value);
      if (!hasGenreOrTypeCriteria) {
        specificSearchQuery = normalizedSearchQuery;
        strictSearchSource = 'search_query';
      }
    }
  }

  if (specificSearchQuery) {
    console.log(`🎯 [rankEvents] Строгий поиск по запросу: "${specificSearchQuery}"`);
  }

  const budget = budgetSlot
    ? parseFloat(String(budgetSlot.value).replace(/[^0-9]/g, ''))
    : priceToSlot
      ? parseFloat(String(priceToSlot.value).replace(/[^0-9]/g, ''))
      : null;
  const isTheaterRequest = isTheaterPerformanceRequestValue(typeSlot?.value);
  const seniorFriendlyContext = hasSeniorFriendlyContext(slots);
  const normalizedContextValue = contextSlot
    ? String(contextSlot.value).toLowerCase().replace(/ё/g, 'е').trim()
    : '';
  const context = seniorFriendlyContext
    ? 'семейный'
    : isFamilyContextValue(normalizedContextValue)
      ? 'семейный'
      : normalizedContextValue || null;

  if (context) {
    console.log(`🎯 [rankEvents] Учитываю контекст события: "${context}"`);
  }

  // Ранжируем события
  const scoredEvents = events.map((event) => {
    let score = 0;
    let hasDateMatch = false;
    let hasGenreMatch = false;
    let hasTypeMatch = false;
    let hasPriceMatch = false;
    let hasContextMatch = false;

    // 1. Соответствие дате (0-35 или штраф)
    const eventDates = parseEventDates(event);
    if (eventDates && dateSlot) {
      // Есть запрошенная дата - проверяем соответствие
      const dateScore = scoreDateMatch(eventDates, dateSlot, slots, dateContextText);
      score += dateScore;
      hasDateMatch = dateScore > 0;
    } else if (!eventDates && dateSlot) {
      // Событие без даты при запрошенной дате - штраф
      score -= 20;
    } else if (eventDates && !dateSlot) {
      // Нет запрошенной даты, но есть дата события - ранжируем по близости к сегодня
      const dateScore = scoreDateProximity(eventDates);
      score += dateScore;
      hasDateMatch = dateScore > 0;
    }

    // 2. Соответствие жанру (0-30)
    if (hasGenreCriteria) {
      const bestGenreScore = genreSlots.reduce((bestScore, genreSlot) => {
        const genreScore = scoreGenreTypeMatch(event, genreSlot.value, {
          matchVenue: false,
          matchCategory: true,
        });
        return Math.max(bestScore, genreScore);
      }, 0);
      score += bestGenreScore;
      hasGenreMatch = bestGenreScore > 0;
    }

    // 3. Соответствие типу события (0-30)
    if (typeSlot && typeSlot.value) {
      const typeScore = scoreGenreTypeMatch(event, typeSlot.value, {
        matchVenue: true,
        matchCategory: true,
      });
      score += typeScore;
      hasTypeMatch = typeScore > 0;
    }

    if (isTheaterRequest && !isTheaterPerformanceCandidate(event)) {
      score -= 120;
      console.log(
        `   🚫 [rankEvents] Театральный запрос: понижаю не-спектакльное событие "${event.title}"`
      );
    }

    // 4. Соответствие социальному контексту (-50 до +30)
    // КРИТИЧЕСКИ ВАЖНО: контекст (свидание, с друзьями и т.д.) сильно влияет на релевантность
    if (context) {
      const contextScore = scoreContextMatch(event, context);
      score += contextScore;
      hasContextMatch = contextScore > 0;

      // Если контекст = свидание и событие получило большой штраф, выводим в лог
      if (context === 'свидание' && contextScore < -20) {
        console.log(
          `   ⚠️ [rankEvents] Штраф за контекст "${context}": ${contextScore} для "${event.title}"`
        );
      }
    }

    if (seniorFriendlyContext && !hasGenreCriteria && !specificSearchQuery) {
      score += scoreSeniorFriendlyMatch(event);
    }

    // 5. Соответствие настроению пользователя
    if (moodSlot && moodSlot.value) {
      score += scoreMoodMatch(event, moodSlot.value);
    }

    // 6. Соответствие цене/бюджету (0-20 или штраф)
    if (budget && event.priceMin !== null && event.priceMin !== undefined) {
      const priceScore = scorePriceMatch(event, budget);
      score += priceScore;
      hasPriceMatch = priceScore > 0;
    } else if (budget && (event.priceMin === null || event.priceMin === undefined)) {
      // Есть бюджет, но нет цены события - небольшой штраф
      score -= 5;
    }

    // 7. Бонус за наличие всех важных полей
    if (event.title && event.date && event.venue) {
      score += 5;
    }

    // 8. СТРОГОЕ СООТВЕТСТВИЕ ПОИСКОВОМУ ЗАПРОСУ
    if (specificSearchQuery) {
      const strictMatch = getStrictSearchMatchScore(event, specificSearchQuery, {
        allowArtistRelaxedMatch: hasStrictArtistSearch,
        allowVenueMatch: strictSearchSource === 'search_query',
      });

      if (strictMatch > 0) {
        score += strictMatch;
      } else {
        // НЕТ совпадения - жесткий штраф, чтобы исключить из выдачи
        score -= 100;
        // console.log(`   ⛔ [rankEvents] Исключаю "${event.title}" - не соответствует запросу "${specificSearchQuery}"`);
      }
    }

    // 9. Дополнительный бонус за соответствие всем критериям
    const criteriaCount = [
      dateSlot,
      hasGenreCriteria,
      typeSlot,
      context,
      budget,
      specificSearchQuery,
    ].filter(Boolean).length;
    const matchedCount = [
      hasDateMatch,
      hasGenreMatch,
      hasTypeMatch,
      hasContextMatch,
      hasPriceMatch,
      score > 0,
    ].filter(Boolean).length;
    if (criteriaCount > 0 && matchedCount === criteriaCount) {
      score += 10; // Бонус за полное соответствие всем критериям
    }

    // 10. Дополнительный штраф за несоответствие нескольким критериям (если нет строгого поиска)
    if (!specificSearchQuery && criteriaCount >= 2) {
      const unmatchedCount = criteriaCount - matchedCount;
      if (unmatchedCount >= 2) {
        // Событие не соответствует 2+ критериям - дополнительный штраф
        score -= 20 * unmatchedCount;
      }
    }

    return { event, score };
  });

  // Сортируем по убыванию балла
  scoredEvents.sort((a, b) => b.score - a.score);

  let finalScoredEvents = scoredEvents;

  if (seniorFriendlyContext && !hasGenreCriteria && !specificSearchQuery) {
    const seniorSafeEvents = scoredEvents.filter((item) =>
      isSeniorFriendlyEventCandidate(item.event, slots)
    );
    finalScoredEvents = seniorSafeEvents;
    console.log(
      `👵 [rankEvents] Senior-friendly фильтр исключил ${scoredEvents.length - seniorSafeEvents.length} шумных событий`
    );
  }

  // Если был строгий поиск, фильтруем совсем неподходящие (со счетом <= -50)
  // Это гарантирует, что мы не покажем "Гипноз", если искали "Паша Воля"
  if (specificSearchQuery) {
    const filteredEvents = finalScoredEvents.filter((item) => item.score > -50);
    if (filteredEvents.length < finalScoredEvents.length) {
      console.log(
        `✂️ [rankEvents] Отфильтровано ${finalScoredEvents.length - filteredEvents.length} событий, не соответствующих запросу "${specificSearchQuery}"`
      );
    }
    if (
      filteredEvents.length === 0 &&
      shouldTrustSingleNamedSearchResult({
        finalScoredEvents,
        strictSearchSource,
        specificSearchQuery,
      })
    ) {
      const onlyEvent = finalScoredEvents[0]?.event;
      console.log(
        `🧭 [rankEvents] Kassir вернул единственный результат для именованного запроса "${specificSearchQuery}", ` +
          `оставляю "${onlyEvent?.title || 'Без названия'}" несмотря на строгий текстовый mismatch`
      );
      return finalScoredEvents.map((item) => item.event);
    }
    return filteredEvents.map((item) => item.event);
  }

  // Логируем топ-5 для отладки
  console.log('🎯 Ранжирование событий:');
  finalScoredEvents.slice(0, 5).forEach((item, index) => {
    console.log(
      `   ${index + 1}. [${item.score.toFixed(1)}] ${item.event.title} | ${item.event.date || 'нет даты'}`
    );
  });

  return finalScoredEvents.map((item) => item.event);
}

export { rankEvents };
