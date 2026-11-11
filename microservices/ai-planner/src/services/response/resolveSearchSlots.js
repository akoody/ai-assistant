import { isAuthoritativeOffTopicIntent } from './intentPolicy.js';
import { deriveFallbackQuery, augmentSlotsWithQuery } from './searchQuery.js';
import { resolveMoodSearchSignal } from '../offerService.js';
import { resolveMoodSlotValueFromSignal } from './moodHealth.js';
import {
  mergeSlots,
  getFirstComparableSlotValue,
  normalizeComparableSlotValue,
  removeSlotsByName,
  BUDGET_SLOT_NAMES,
  hasQuerySlot,
} from './slotUtils.js';
import { saveSlotToDatabase } from '../slotsService.js';
import { normalizeCategory } from './categoryDefinitions.js';
import {
  resolveDetectedCategoryForSearch,
  hasExplicitChildAudienceInText,
  hasExplicitDateContextInText,
  resolveNamedTargetSlotReset,
  buildShowAllResetSlotNames,
} from './searchReset.js';
import { normalizeText } from './textUtils.js';
import {
  detectChildrenGenreFromText,
  detectCircusGenreFromText,
  detectFestivalGenreFromText,
  detectTheaterGenreFromText,
  detectConcertGenreFromText,
  getAmbiguousGenreContextSlot,
  GENRE_SLOT_NAMES,
  AMBIGUOUS_CATEGORY_SHOW_ALL_SLOT_NAME,
  AMBIGUOUS_CATEGORY_SHOW_ALL_SLOT_VALUE,
  applyExplicitAnyBudgetSelectionToSlots,
} from './categoryRouting.js';
import {
  upsertEphemeralSlot,
  wantsSimilarAlternatives,
  buildSimilarEventGenreSlot,
} from './responseQuality.js';
import { SIMILAR_EVENT_RESET_SLOT_NAMES } from './eventProbe.js';
import { normalizeEventTypeForPreferences } from './preferenceFeedback.js';
import {
  mergeSlotsWithImplicitDateFromUserMessage,
  applyDateSlotDayOfWeekRefinement,
} from '../dateParsingUtils.js';
import { hasSlotsChanged, resetOfferFlags, updateSessionSlotsSnapshot } from '../sessionService.js';
import { detectRequestType } from '../slotsRequirementsService.js';

export async function resolveSearchSlots({
  request: { userId, sessionId, userMessage },
  routing: {
    isChangePreferencesRequest,
    isChangeCityRequest,
    offTopicIntent,
    detectedIntents,
    clarificationTarget,
    session,
    isExplicitAnyGenre,
    isExplicitAnyBudget,
  },
  slots: {
    mergedSlots,
    directPreferenceChange,
    newlyExtractedSlots,
    showAllIntent,
    shownEventsHistory,
    eventsToExclude,
    normalizedRecoveredUiSlot,
    userPreferences,
    cheapBudgetRequested,
    keywordOverride,
  },
}) {
  const dateSlot = mergedSlots.find((s) => s.name === 'дата_события');
  if (dateSlot) {
    console.log(`📅 [${userId}][${sessionId}] Финальный слот даты после объединения:`, {
      name: dateSlot.name,
      value: dateSlot.value,
      hasParsedDate: !!dateSlot.parsedDate,
      hasDateRange: !!dateSlot.dateRange,
      dateRange: dateSlot.dateRange
        ? {
            startDate: dateSlot.dateRange.startDate?.toISOString(),
            endDate: dateSlot.dateRange.endDate?.toISOString(),
          }
        : null,
    });
  }
  const fallbackQuerySource =
    isChangePreferencesRequest && directPreferenceChange?.positivePart
      ? directPreferenceChange.positivePart
      : userMessage;
  const fallbackQuery =
    isChangeCityRequest || isAuthoritativeOffTopicIntent(offTopicIntent)
      ? ''
      : deriveFallbackQuery(fallbackQuerySource, mergedSlots);

  const inferredMoodSignal = resolveMoodSearchSignal({
    slots: mergedSlots,
    fallbackQuery,
    keywordOverride: fallbackQuerySource,
  });
  const hasExplicitMoodSlot = mergedSlots.some(
    (slot) => slot && slot.name === 'настроение' && String(slot.value || '').trim().length > 0
  );
  if (
    !hasExplicitMoodSlot &&
    inferredMoodSignal?.moodValue &&
    (inferredMoodSignal.source === 'context' || inferredMoodSignal.source === 'text')
  ) {
    const resolvedInferredMoodValue = resolveMoodSlotValueFromSignal(inferredMoodSignal);
    const inferredMoodSlot = {
      name: 'настроение',
      value: resolvedInferredMoodValue,
      confidence: 0.88,
      source: `mood_${inferredMoodSignal.source}_rule`,
    };
    newlyExtractedSlots.push(inferredMoodSlot);
    mergedSlots = mergeSlots(mergedSlots, [inferredMoodSlot]);
    await saveSlotToDatabase(userId, inferredMoodSlot);
    console.log(
      `🎭 [${userId}][${sessionId}] Восстанавливаю mood-сигнал из ${inferredMoodSignal.source}: ` +
        `"${resolvedInferredMoodValue}". Сохраняю слот настроения для текущего сценария.`
    );
  } else if (hasExplicitMoodSlot && inferredMoodSignal?.source === 'slot') {
    // Пользователь мог сменить настроение, но AI Slots не извлёк новый слот.
    // Проверяем текст сообщения напрямую (без учёта существующего слота настроения).
    const textOnlyMoodSignal = resolveMoodSearchSignal({
      slots: [],
      fallbackQuery,
      keywordOverride: fallbackQuerySource,
    });
    if (textOnlyMoodSignal?.moodValue && textOnlyMoodSignal.source === 'text') {
      const existingMoodProfileKey = inferredMoodSignal?.profile?.key;
      const newMoodProfileKey = textOnlyMoodSignal?.profile?.key;
      if (
        newMoodProfileKey &&
        (!existingMoodProfileKey || existingMoodProfileKey !== newMoodProfileKey)
      ) {
        const resolvedTextMoodValue = resolveMoodSlotValueFromSignal(textOnlyMoodSignal);
        const changedMoodSlot = {
          name: 'настроение',
          value: resolvedTextMoodValue,
          confidence: 0.88,
          source: 'mood_text_change_rule',
        };
        newlyExtractedSlots.push(changedMoodSlot);
        mergedSlots = mergeSlots(mergedSlots, [changedMoodSlot]);
        await saveSlotToDatabase(userId, changedMoodSlot);
        console.log(
          `🎭 [${userId}][${sessionId}] Смена настроения обнаружена в тексте: ` +
            `"${inferredMoodSignal.moodValue}" (${existingMoodProfileKey}) → ` +
            `"${resolvedTextMoodValue}" (${newMoodProfileKey}). Обновляю слот настроения.`
        );
      }
    }
  }

  // Определяем текущую категорию из существующих слотов
  const currentEventTypeSlot = mergedSlots.find(
    (s) => s.name === 'тип_мероприятия' || s.name === 'тип_события'
  );
  const currentCategory = currentEventTypeSlot
    ? normalizeCategory(currentEventTypeSlot.value)
    : null;

  let detectedCategory = resolveDetectedCategoryForSearch({
    newlyExtractedSlots,
    fallbackQuery,
    userMessage,
    detectedIntents,
    isChangePreferencesRequest,
    directPreferenceChange,
    userId,
    sessionId,
  });

  if (currentCategory) {
    console.log(`🔍 [${userId}][${sessionId}] Текущая категория: "${currentCategory}"`);
  }
  if (detectedCategory) {
    console.log(`🔍 [${userId}][${sessionId}] Обнаруженная категория: "${detectedCategory}"`);
  }

  const hasChildAudienceSignal = Boolean(
    hasExplicitChildAudienceInText(userMessage) ||
    hasExplicitChildAudienceInText(fallbackQuery) ||
    mergedSlots.some((slot) => {
      const slotName = String(slot?.name || '').trim();
      const slotValue = normalizeText(String(slot?.value || ''));
      return (
        slotName === 'возраст_ребенка' ||
        (slotName === 'контекст_события' && slotValue.includes('деть')) ||
        (slotName === 'возрастное_ограничение' && slotValue.includes('дет'))
      );
    })
  );
  const detectedChildrenGenre =
    detectChildrenGenreFromText(fallbackQuery) ||
    detectChildrenGenreFromText(userMessage) ||
    detectedIntents
      .map((intent) => String(intent?.trigger || '').trim())
      .map((trigger) => detectChildrenGenreFromText(trigger))
      .find(Boolean) ||
    '';
  const detectedCircusGenre =
    detectCircusGenreFromText(fallbackQuery) ||
    detectCircusGenreFromText(userMessage) ||
    detectedIntents
      .map((intent) => String(intent?.trigger || '').trim())
      .map((trigger) => detectCircusGenreFromText(trigger))
      .find(Boolean) ||
    '';
  const effectiveDetectedChildGenre =
    detectedChildrenGenre || (hasChildAudienceSignal ? detectedCircusGenre : '');
  const canApplyChildGenre =
    Boolean(effectiveDetectedChildGenre) &&
    (effectiveDetectedChildGenre !== 'цирк / клоунада' ||
      hasChildAudienceSignal ||
      (detectedCategory || currentCategory) === 'детям');

  if (!detectedCategory && !currentCategory && hasChildAudienceSignal) {
    detectedCategory = 'детям';
    console.log(
      `🧒 [${userId}][${sessionId}] По явному детскому контексту устанавливаю категорию "детям".`
    );
  }

  if (!detectedCategory && !currentCategory && canApplyChildGenre) {
    detectedCategory = 'детям';
    console.log(`🧒 [${userId}][${sessionId}] По детскому жанру устанавливаю категорию "детям".`);
  }

  const currentGenreValue = getFirstComparableSlotValue(mergedSlots, [
    'жанр',
    'жанр_музыки',
    'предпочтения_жанры',
  ]);

  if (
    (detectedCategory || currentCategory) === 'детям' &&
    canApplyChildGenre &&
    !currentGenreValue &&
    !newlyExtractedSlots.some(
      (slot) => slot && ['жанр', 'жанр_музыки', 'предпочтения_жанры'].includes(slot.name)
    )
  ) {
    const childrenGenreSlot = {
      name: 'жанр',
      value: effectiveDetectedChildGenre,
      confidence: 0.92,
      source: 'child_genre_rule',
    };

    newlyExtractedSlots.push(childrenGenreSlot);
    mergedSlots = mergeSlots(mergedSlots, [childrenGenreSlot]);
    await saveSlotToDatabase(userId, childrenGenreSlot);
    console.log(
      `🧒 [${userId}][${sessionId}] Детский жанр обнаружен в тексте: "${effectiveDetectedChildGenre}". ` +
        `Сохраняю слот жанра для точного поиска.`
    );
  }

  const upgradableChildGenre = normalizeComparableSlotValue(currentGenreValue || '');
  if (
    (detectedCategory || currentCategory) === 'детям' &&
    effectiveDetectedChildGenre === 'детские концерты' &&
    upgradableChildGenre === 'детские'
  ) {
    const upgradedChildConcertSlot = {
      name: 'жанр',
      value: 'детские концерты',
      confidence: 0.93,
      source: 'child_concert_genre_upgrade',
    };
    const genreIdx = newlyExtractedSlots.findIndex(
      (slot) => slot && ['жанр', 'жанр_музыки', 'предпочтения_жанры'].includes(slot.name)
    );
    if (genreIdx >= 0) {
      newlyExtractedSlots.splice(genreIdx, 1, upgradedChildConcertSlot);
    } else {
      newlyExtractedSlots.push(upgradedChildConcertSlot);
    }
    mergedSlots = mergeSlots(mergedSlots, [upgradedChildConcertSlot]);
    await saveSlotToDatabase(userId, upgradedChildConcertSlot);
    console.log(
      `🧒 [${userId}][${sessionId}] Уточняю слот жанра "детские" → "детские концерты" ` +
        'для slug /detskaya-afisha/koncert/.'
    );
  }
  const positiveSearchSource =
    directPreferenceChange?.canApplyDirectly && directPreferenceChange?.positivePart
      ? directPreferenceChange.positivePart
      : userMessage;
  const detectedFestivalGenre =
    detectFestivalGenreFromText(fallbackQuery) ||
    detectFestivalGenreFromText(positiveSearchSource) ||
    detectedIntents
      .map((intent) => String(intent?.trigger || '').trim())
      .map((trigger) => detectFestivalGenreFromText(trigger))
      .find(Boolean) ||
    '';
  const detectedTheaterGenre =
    detectTheaterGenreFromText(fallbackQuery) ||
    detectTheaterGenreFromText(positiveSearchSource) ||
    detectedIntents
      .map((intent) => String(intent?.trigger || '').trim())
      .map((trigger) => detectTheaterGenreFromText(trigger))
      .find(Boolean) ||
    '';
  const detectedConcertGenre =
    detectConcertGenreFromText(fallbackQuery) ||
    detectConcertGenreFromText(positiveSearchSource) ||
    detectedIntents
      .map((intent) => String(intent?.trigger || '').trim())
      .map((trigger) => detectConcertGenreFromText(trigger))
      .find(Boolean) ||
    null;
  const effectiveFestivalCategory = detectedCategory || currentCategory;

  if (!detectedCategory && !currentCategory && detectedTheaterGenre) {
    detectedCategory = 'театры';
    console.log(
      `🎭 [${userId}][${sessionId}] Театральный жанр "${detectedTheaterGenre}" обнаружен в тексте. ` +
        'Устанавливаю категорию "театры".'
    );
  }

  if (!detectedCategory && !currentCategory && detectedConcertGenre) {
    detectedCategory = 'концерты';
    console.log(
      `🎵 [${userId}][${sessionId}] Музыкальный жанр "${detectedConcertGenre.value}" обнаружен в тексте. ` +
        'Устанавливаю категорию "концерты".'
    );
  }

  if (
    effectiveFestivalCategory === 'фестивали' &&
    detectedFestivalGenre &&
    !currentGenreValue &&
    !newlyExtractedSlots.some(
      (slot) => slot && ['жанр', 'жанр_музыки', 'предпочтения_жанры'].includes(slot.name)
    )
  ) {
    const festivalGenreSlot = {
      name: 'жанр',
      value: detectedFestivalGenre,
      confidence: 0.92,
      source: 'festival_genre_rule',
    };

    newlyExtractedSlots.push(festivalGenreSlot);
    mergedSlots = mergeSlots(mergedSlots, [festivalGenreSlot]);
    await saveSlotToDatabase(userId, festivalGenreSlot);
    console.log(
      `🌿 [${userId}][${sessionId}] Жанр фестиваля обнаружен в тексте: "${detectedFestivalGenre}". ` +
        `Сохраняю слот жанра для точного поиска.`
    );
  }

  if (
    (detectedCategory || currentCategory) === 'театры' &&
    detectedTheaterGenre &&
    !currentGenreValue &&
    !newlyExtractedSlots.some(
      (slot) => slot && ['жанр', 'жанр_музыки', 'предпочтения_жанры'].includes(slot.name)
    )
  ) {
    const theaterGenreSlot = {
      name: 'жанр',
      value: detectedTheaterGenre,
      confidence: 0.92,
      source: 'theater_genre_rule',
    };

    newlyExtractedSlots.push(theaterGenreSlot);
    mergedSlots = mergeSlots(mergedSlots, [theaterGenreSlot]);
    await saveSlotToDatabase(userId, theaterGenreSlot);
    console.log(
      `🎭 [${userId}][${sessionId}] Театральный жанр обнаружен в тексте: "${detectedTheaterGenre}". ` +
        `Сохраняю слот жанра для точного поиска.`
    );
  }

  if (
    (detectedCategory || currentCategory) === 'концерты' &&
    detectedConcertGenre &&
    !currentGenreValue &&
    !newlyExtractedSlots.some(
      (slot) => slot && ['жанр', 'жанр_музыки', 'предпочтения_жанры'].includes(slot.name)
    )
  ) {
    const concertGenreSlot = {
      name: detectedConcertGenre.slotName,
      value: detectedConcertGenre.value,
      confidence: 0.92,
      source: 'concert_genre_rule',
    };

    newlyExtractedSlots.push(concertGenreSlot);
    mergedSlots = mergeSlots(mergedSlots, [concertGenreSlot]);
    await saveSlotToDatabase(userId, concertGenreSlot);
    console.log(
      `🎵 [${userId}][${sessionId}] Музыкальный жанр обнаружен в тексте: "${detectedConcertGenre.value}". ` +
        `Сохраняю слот жанра для точного поиска.`
    );
  }

  // Если категория найдена и отличается от текущей, обновляем слоты
  let categoryChanged = false;

  if (detectedCategory && (!currentCategory || currentCategory !== detectedCategory)) {
    console.log(
      `🔄 [${userId}][${sessionId}] Обнаружена смена категории: "${currentCategory || 'нет'}" -> "${detectedCategory}". Обновляю слот типа мероприятия.`
    );

    // При смене категории сбрасываем слоты, которые часто "привязаны" к предыдущей категории
    // (например, "Театры" после "Концерты: классика" не должен тащить жанр "классика" в новый запрос).
    const resetOnCategoryChange = new Set([
      'тип_мероприятия',
      'тип_события',
      'жанр',
      'жанр_музыки',
      'исполнитель',
      'название_мероприятия',
      'поисковый_запрос',
      'настроение',
    ]);

    const shouldKeepSlot = (slot) => slot && slot.name && !resetOnCategoryChange.has(slot.name);

    // Сбрасываем только унаследованный контекст из уже собранных слотов.
    // Свежие слоты из текущего сообщения (например, артист/жанр/дата) должны
    // остаться, иначе запрос "концерт Басты" схлопывается в обычные "концерты".
    const filteredCurrentSlots = mergedSlots.filter(shouldKeepSlot);

    // Добавляем новый слот с правильной категорией
    const categorySlot = { name: 'тип_мероприятия', value: detectedCategory };

    // КРИТИЧЕСКИ ВАЖНО: Сохраняем слот категории в БД, чтобы он не терялся между запросами
    await saveSlotToDatabase(userId, categorySlot);
    console.log(`💾 [${userId}][${sessionId}] Слот категории "${detectedCategory}" сохранён в БД`);

    // Объединяем слоты: база без устаревшего категорийного контекста + все
    // свежие извлеченные слоты текущего сообщения + новая категория.
    const slotsToMerge =
      newlyExtractedSlots.length > 0 ? [...newlyExtractedSlots, categorySlot] : [categorySlot];

    mergedSlots = mergeSlots(filteredCurrentSlots, slotsToMerge);

    categoryChanged = true;
  }

  let effectiveSlots = augmentSlotsWithQuery(mergedSlots, fallbackQuery, {
    userMessage,
    offTopicIntent,
  });
  const ambiguousGenreContextSlot =
    clarificationTarget === 'ambiguous_category'
      ? getAmbiguousGenreContextSlot(
          Array.isArray(session?.slotsSnapshot) ? session.slotsSnapshot : []
        )
      : null;

  if (ambiguousGenreContextSlot) {
    const removedGenreValues = effectiveSlots
      .filter((slot) => slot && GENRE_SLOT_NAMES.has(slot.name))
      .map((slot) => `${slot.name}="${slot.value}"`);

    effectiveSlots = mergeSlots(removeSlotsByName(effectiveSlots, GENRE_SLOT_NAMES), [
      ambiguousGenreContextSlot,
    ]);

    console.log(
      `🧭 [${userId}][${sessionId}] Восстанавливаю жанр из неоднозначного уточнения: ` +
        `${ambiguousGenreContextSlot.name}="${ambiguousGenreContextSlot.value}"` +
        `${removedGenreValues.length > 0 ? `, снимаю прежние жанры [${removedGenreValues.join(', ')}]` : ''}`
    );
  }

  // "Безопасная" коррекция: если текст явно про свидание/пару, используем контекст ТОЛЬКО в рамках сессии
  // (в user.slots не сохраняем). Это нужно, чтобы на следующих шагах ("Покажи все") контекст не терялся.
  if (hasExplicitDateContextInText(userMessage)) {
    const existingContext = effectiveSlots.find((slot) => slot?.name === 'контекст_события');
    const existingValue = String(existingContext?.value || '').toLowerCase();
    if (existingValue !== 'свидание') {
      effectiveSlots = [
        ...effectiveSlots.filter((slot) => slot?.name !== 'контекст_события'),
        { name: 'контекст_события', value: 'свидание', confidence: 1.0, source: 'rule' },
      ];
      console.log(
        `💞 [${userId}][${sessionId}] Явный контекст свидания из текста — применяю для сессии (без сохранения в user.slots)`
      );
    }
  }

  const namedTargetReset = resolveNamedTargetSlotReset(newlyExtractedSlots, userMessage);
  if (namedTargetReset) {
    const removedNamedTargetFilters = effectiveSlots
      .filter((slot) => slot && namedTargetReset.slotsToRemove.has(slot.name))
      .map((slot) => `${slot.name}="${slot.value}"`);

    if (removedNamedTargetFilters.length > 0) {
      effectiveSlots = removeSlotsByName(effectiveSlots, namedTargetReset.slotsToRemove);
    }

    if (namedTargetReset.injectConcertCategory) {
      effectiveSlots = upsertEphemeralSlot(effectiveSlots, {
        name: 'тип_мероприятия',
        value: 'концерты',
        confidence: 0.9,
        source: 'named_target_rule',
      });
    }

    if (removedNamedTargetFilters.length > 0 || namedTargetReset.injectConcertCategory) {
      const logParts = [];
      if (removedNamedTargetFilters.length > 0) {
        logParts.push(`снимаю унаследованные фильтры [${removedNamedTargetFilters.join(', ')}]`);
      }
      if (namedTargetReset.injectConcertCategory) {
        logParts.push('подставляю тип_мероприятия="концерты"');
      }
      console.log(
        `🎯 [${userId}][${sessionId}] Новый именованный запрос — ${logParts.join(', ')}.`
      );
    }
  }

  // КРИТИЧЕСКИ ВАЖНО: "Покажи все" в сценарии уточнения категории должно снять категорийный фильтр,
  // чтобы искать по общей афише. В прочих сценариях снимаем только уточняющие фильтры.
  if (showAllIntent) {
    const resetOnShowAll = buildShowAllResetSlotNames({
      effectiveSlots,
      clarificationTarget,
    });

    const removedSlotNames = effectiveSlots
      .filter((slot) => slot && resetOnShowAll.has(slot.name))
      .map((slot) => slot.name);

    effectiveSlots = effectiveSlots.filter((slot) => !(slot && resetOnShowAll.has(slot.name)));

    if (clarificationTarget === 'ambiguous_category') {
      effectiveSlots = effectiveSlots.filter(
        (slot) => !(slot && slot.name === AMBIGUOUS_CATEGORY_SHOW_ALL_SLOT_NAME)
      );
      effectiveSlots.push({
        name: AMBIGUOUS_CATEGORY_SHOW_ALL_SLOT_NAME,
        value: AMBIGUOUS_CATEGORY_SHOW_ALL_SLOT_VALUE,
        confidence: 0.95,
        source: 'planner_show_all',
      });
    } else {
      effectiveSlots.push({ name: 'поисковый_запрос', value: 'все' });
    }

    if (removedSlotNames.length > 0) {
      categoryChanged = true;
      console.log(
        clarificationTarget === 'ambiguous_category'
          ? `🔄 [${userId}][${sessionId}] Intent "Покажи все" после уточнения неоднозначного жанра: сбрасываю категорийные фильтры [${Array.from(new Set(removedSlotNames)).join(', ')}], сохраняю жанр и включаю multi-category поиск`
          : `🔄 [${userId}][${sessionId}] Intent "Покажи все": сбрасываю фильтры [${Array.from(new Set(removedSlotNames)).join(', ')}], устанавливаю поисковый_запрос="все"`
      );
    } else {
      console.log(
        clarificationTarget === 'ambiguous_category'
          ? `🔍 [${userId}][${sessionId}] Обнаружен intent "Покажи все" для неоднозначного жанра, запускаю multi-category поиск по связанным категориям`
          : `🔍 [${userId}][${sessionId}] Обнаружен intent "Покажи все", устанавливаю слот поискового запроса`
      );
    }
  }

  if (isExplicitAnyGenre) {
    const genreSlotNames = new Set(['жанр', 'жанр_музыки', 'предпочтения_жанры']);
    const removedGenreSlotNames = effectiveSlots
      .filter((slot) => slot && genreSlotNames.has(slot.name))
      .map((slot) => slot.name);

    effectiveSlots = removeSlotsByName(effectiveSlots, genreSlotNames);

    if (removedGenreSlotNames.length > 0) {
      categoryChanged = true;
      console.log(
        `🎚️ [${userId}][${sessionId}] Явно выбран "Любой" жанр — снимаю жанровые ограничения ` +
          `[${Array.from(new Set(removedGenreSlotNames)).join(', ')}], сохраняя текущую категорию.`
      );
    }
  }

  if (showAllIntent && clarificationTarget === 'genre' && shownEventsHistory.length > 0) {
    eventsToExclude = shownEventsHistory;
    console.log(
      `🔁 [${userId}][${sessionId}] Сценарий "Уточнить жанр" -> "Покажи все": ` +
        'исключаю ранее показанные события, чтобы не возвращать повторные карточки.'
    );
  }

  if (isExplicitAnyBudget) {
    const removedBudgetSlotNames = effectiveSlots
      .filter((slot) => slot && BUDGET_SLOT_NAMES.has(slot.name))
      .map((slot) => slot.name);

    effectiveSlots = applyExplicitAnyBudgetSelectionToSlots(
      effectiveSlots,
      normalizedRecoveredUiSlot && BUDGET_SLOT_NAMES.has(normalizedRecoveredUiSlot.name)
        ? normalizedRecoveredUiSlot
        : null
    );

    if (removedBudgetSlotNames.length > 0) {
      console.log(
        `💰 [${userId}][${sessionId}] Явно выбран "Любой" бюджет — снимаю ценовые ограничения [${Array.from(new Set(removedBudgetSlotNames)).join(', ')}]`
      );
    } else {
      console.log(
        `💰 [${userId}][${sessionId}] Явно выбран "Любой" бюджет — фиксирую ответ без ценового ограничения.`
      );
    }

    if (userPreferences?.priceRange) {
      userPreferences = {
        ...userPreferences,
        priceRange: null,
      };
      console.log(
        `💰 [${userId}][${sessionId}] Игнорирую сохранённое ценовое предпочтение для текущего запроса ("Любой" бюджет).`
      );
    }
  }

  const selectedEventForRefinement = session?.selectedEvent || null;
  const similarAlternativesRequested = wantsSimilarAlternatives(userMessage);
  const cheaperSimilarRefinement = Boolean(
    selectedEventForRefinement && cheapBudgetRequested && similarAlternativesRequested
  );

  if (cheaperSimilarRefinement) {
    const removedRefinementSlots = effectiveSlots
      .filter((slot) => slot && SIMILAR_EVENT_RESET_SLOT_NAMES.has(slot.name))
      .map((slot) => `${slot.name}="${slot.value}"`);

    effectiveSlots = removeSlotsByName(effectiveSlots, SIMILAR_EVENT_RESET_SLOT_NAMES);

    const eventTypeFromSelectedEvent = normalizeEventTypeForPreferences(
      selectedEventForRefinement.category || selectedEventForRefinement.type || ''
    );
    const hasEventTypeSlot = effectiveSlots.some(
      (slot) => slot && (slot.name === 'тип_мероприятия' || slot.name === 'тип_события')
    );
    if (eventTypeFromSelectedEvent && !hasEventTypeSlot) {
      effectiveSlots = upsertEphemeralSlot(effectiveSlots, {
        name: 'тип_мероприятия',
        value: eventTypeFromSelectedEvent,
        confidence: 0.85,
        source: 'selected_event_context',
      });
    }

    const hasGenreSlot = effectiveSlots.some(
      (slot) => slot && (slot.name === 'жанр' || slot.name === 'жанр_музыки')
    );
    const selectedEventGenreSlot = !hasGenreSlot
      ? buildSimilarEventGenreSlot(selectedEventForRefinement)
      : null;

    if (selectedEventGenreSlot) {
      effectiveSlots = upsertEphemeralSlot(effectiveSlots, selectedEventGenreSlot);
    }

    if (!keywordOverride && selectedEventGenreSlot?.value) {
      keywordOverride = selectedEventGenreSlot.value;
    }

    console.log(
      `🔁 [${userId}][${sessionId}] Запрос "похожее, но подешевле" — убираю привязку к конкретному событию и ищу похожие варианты.`,
      {
        selectedEvent: selectedEventForRefinement.title || null,
        removedSlots: removedRefinementSlots,
        keywordOverride,
      }
    );
  }

  effectiveSlots = mergeSlotsWithImplicitDateFromUserMessage(effectiveSlots, userMessage);
  effectiveSlots = applyDateSlotDayOfWeekRefinement(effectiveSlots, { userMessage });

  console.log(
    `📊 [${userId}][${sessionId}] Текущие слоты (с учетом запроса):`,
    JSON.stringify(effectiveSlots.map((s) => ({ name: s.name, value: s.value })))
  );
  if (!hasQuerySlot(mergedSlots) && fallbackQuery) {
    console.log(
      `🧭 [${userId}][${sessionId}] Используется резервный поисковый запрос: "${fallbackQuery}"`
    );
  }
  if (categoryChanged) {
    console.log(
      `🔄 [${userId}][${sessionId}] Категория изменена, обновлены слоты. Новая категория: "${detectedCategory}"`
    );
  }

  // Проверяем, изменились ли слоты (включая изменение категории)
  const slotsChanged =
    (await hasSlotsChanged(userId, sessionId, effectiveSlots)) || categoryChanged;

  // Определяем, изменилась ли дата события (для исключения дублей при уточнении даты)
  const previousSlotsSnapshot = session.slotsSnapshot || [];
  const currentDateSlotForDiff = effectiveSlots.find((s) => s.name === 'дата_события');
  const previousDateSlotForDiff = previousSlotsSnapshot.find((s) => s.name === 'дата_события');
  const currentBudgetSlotForDiff = effectiveSlots.find(
    (s) => s.name === 'бюджет' || s.name === 'цена_до'
  );
  const previousBudgetSlotForDiff = previousSlotsSnapshot.find(
    (s) => s && (s.name === 'бюджет' || s.name === 'цена_до')
  );
  const currentTimeSlotForDiff = effectiveSlots.find((s) => s.name === 'время');
  const previousTimeSlotForDiff = previousSlotsSnapshot.find((s) => s && s.name === 'время');
  const dateSlotChanged =
    slotsChanged &&
    (!!currentDateSlotForDiff !== !!previousDateSlotForDiff ||
      (currentDateSlotForDiff &&
        previousDateSlotForDiff &&
        String(currentDateSlotForDiff.value) !== String(previousDateSlotForDiff.value)));
  const budgetSlotChanged =
    slotsChanged &&
    (!!currentBudgetSlotForDiff !== !!previousBudgetSlotForDiff ||
      (currentBudgetSlotForDiff &&
        previousBudgetSlotForDiff &&
        String(currentBudgetSlotForDiff.value) !== String(previousBudgetSlotForDiff.value)));
  const timeSlotChanged =
    slotsChanged &&
    (!!currentTimeSlotForDiff !== !!previousTimeSlotForDiff ||
      (currentTimeSlotForDiff &&
        previousTimeSlotForDiff &&
        String(currentTimeSlotForDiff.value) !== String(previousTimeSlotForDiff.value)));

  if ((dateSlotChanged || budgetSlotChanged || timeSlotChanged) && shownEventsHistory.length > 0) {
    const changedParts = [];
    if (dateSlotChanged) changedParts.push('дата');
    if (budgetSlotChanged) changedParts.push('бюджет');
    if (timeSlotChanged) changedParts.push('время');
    console.log(
      `🔁 [${userId}][${sessionId}] Изменены параметры (${changedParts.join(', ')}). ` +
        `Исключаю ранее показанные события из нового поиска, чтобы найти новые варианты.`
    );
    eventsToExclude = shownEventsHistory;
  }

  // Определяем тип запроса до обновления снимка (чтобы сравнить с предыдущим)
  const requestType = detectRequestType(effectiveSlots);

  // Проверяем, изменился ли тип события (категория) - если да, сбрасываем флаги
  if ((slotsChanged || categoryChanged) && session) {
    const previousRequestType = detectRequestType(session.slotsSnapshot || []);
    if (
      previousRequestType !== 'default' &&
      requestType !== 'default' &&
      previousRequestType !== requestType
    ) {
      console.log(
        `🔄 [${userId}][${sessionId}] Тип события изменился: ${previousRequestType} -> ${requestType}. Сбрасываю флаги предложений.`
      );
      await resetOfferFlags(userId, sessionId);
      session.quickOfferSent = false;
      session.finalOfferSent = false;
    } else if (categoryChanged) {
      // Если категория изменилась, но тип запроса не определился, все равно сбрасываем флаги
      console.log(
        `🔄 [${userId}][${sessionId}] Категория изменилась (обнаружена в fallbackQuery). Сбрасываю флаги предложений.`
      );
      await resetOfferFlags(userId, sessionId);
      session.quickOfferSent = false;
      session.finalOfferSent = false;
    }
  }

  // Обновляем снимок слотов
  await updateSessionSlotsSnapshot(userId, sessionId, effectiveSlots);

  console.log(`📋 [${userId}][${sessionId}] Тип запроса: ${requestType}`);

  return {
    kind: 'continue',
    context: {
      fallbackQuery,
      categoryChanged,
      effectiveSlots,
      slotsChanged,
      dateSlotChanged,
      requestType,
      eventsToExclude,
      userPreferences,
      keywordOverride,
    },
  };
}
