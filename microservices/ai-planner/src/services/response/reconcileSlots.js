import { respondToHealthComplaint } from './replies/respondToHealthComplaint.js';
import { resetOfferFlags, updateSessionSelectedEvent } from '../sessionService.js';
import { getShownEventsFromHistory } from './conversationHistory.js';
import { getUserPreferences, formatPreferencesDescription } from '../userPreferencesService.js';
import {
  hasStoredPreferenceMemory,
  buildPreferenceSlotsFromPreferences,
} from '../preferenceMemoryService.js';
import { updateStatus } from '../statusService.js';
import { buildEmptyPreferencesResponseViaLlm } from './dialogReplies.js';
import {
  getCurrentSessionSlots,
  normalizeSlotName,
  removeSlotsFromDatabase,
  saveSlotToDatabase,
} from '../slotsService.js';
import {
  mergeSlots,
  isNegativeDateSlot,
  isAnyDateSelectionSlot,
  normalizeComparableSlotValue,
  SHOW_ALL_KEYWORDS,
} from './slotUtils.js';
import {
  shouldProbeOffTopicEventSearch,
  findAmbiguousNamedEventSlots,
  probeKassirEventsForOffTopicCandidate,
  replaceAmbiguousSlotsWithNamedEventSlots,
  summarizeOffTopicProbeEvent,
} from './eventProbe.js';
import { enrichSlotWithDate, coalesceDateSlotsIntoRange } from '../dateParsingUtils.js';
import {
  extractSlotLikeIntents,
  buildSeniorCompanionSlots,
  buildFreshSearchResetPlan,
  sanitizeFreshSearchExtractedSlots,
  hasSeniorCompanionMarker,
  buildSeniorCompanionSlotsFromConversation,
  enforceSeniorCompanionContext,
} from './searchReset.js';
import {
  inferDirectPreferenceChange,
  reconcileDirectSearchTargetWithDislikes,
  persistDirectPreferenceChange,
  buildImmediateSearchSlotsFromPreferenceChange,
  applyImmediateSearchSlotsFromPreferenceChange,
} from './categoryRouting.js';
import {
  normalizeCategory,
  resolveTaxonomyGenreEntryByValue,
  detectCategoryFromText,
  resolveTaxonomyGenreEntryFromText,
} from './categoryDefinitions.js';
import {
  shouldTreatAsClarificationFollowUpSelection,
  wantsCheaperBudget,
  computeRelativeCheaperBudgetCap,
} from './responseQuality.js';
import { extractPriceCapFromText, extractBudgetCapFromSlots } from './preferenceFeedback.js';
import {
  extractExplicitRussianCityFromMessage,
  areSameRussianCity,
} from '../cityMentionService.js';
import { isRussianCity, normalizeCityButton } from '../offerService.js';
import { getMessageHistory } from '../messagesStorage.js';
import {
  hasUsableDateSlot,
  inferDateSlotFromConversation,
  isMetaPreferenceReferenceSlot,
} from './clarification.js';

export async function reconcileSlots({
  request: { userId, sessionId, userMessage, requestId },
  routing: {
    isHealthComplaintRequest,
    healthComplaintIntent,
    isShowMoreRequest,
    session,
    isExplicitAnyBudget,
    isExplicitAnyDate,
    userPreferences,
    wantsPreferredEventsRequest,
    isClarificationRequest,
    slotExtractionResult,
    recommendationsIntent,
    offTopicIntent,
    isEventDetailsRequest,
    isChangeCityRequest,
    isChangeDateRequest,
    isChangePreferencesRequest,
    isQuickCategorySelection,
    isButtonEcho,
    isBuyTicketsUiCommand,
    shouldSkipHistoricalDateRecovery,
    detectedIntents,
    directPreferenceChange,
    canApplyChangePreferencesDirectly,
    recoveredUiSlot,
    clarificationTarget,
    clarificationActionTarget,
    inferredUiSlot,
    buyTicketIntent,
    normalizedUserMessage,
    preferenceMemoryRequest,
  },
}) {
  let offerEvents = null;
  let noResultsDetected = false;
  let eventDetailsContext = null;
  let allSlotsCollected = false;
  let allRequiredCollected = false;
  let usedPreferencesForSearch = false;
  let popularSelectionUsedForSearch = false;
  let offerOriginalEvents = null;
  let shouldSkipOfferGeneration = false;
  let shouldSkipCache = false;
  let keywordOverride = null;

  let vagueCheck = { isVague: false, missingDetails: [] };
  let needsClarification = false;

  // Если это жалоба на здоровье, используем упрощенную обработку - не обрабатываем слоты
  if (isHealthComplaintRequest) {
    return {
      kind: 'reply',
      response: await respondToHealthComplaint({
        userId,
        sessionId,
        offerEvents,
        noResultsDetected,
        allRequiredCollected,
        needsClarification,
        shouldSkipOfferGeneration,
        healthComplaintIntent,
        userMessage,
        requestId,
      }),
    };
  }

  if (isShowMoreRequest) {
    if (session.quickOfferSent || session.finalOfferSent) {
      console.log(
        `🔁 [${userId}][${sessionId}] Сбрасываю флаги отправленных предложений по запросу "показать больше"`
      );
      await resetOfferFlags(userId, sessionId);
      session.quickOfferSent = false;
      session.finalOfferSent = false;
    }
  }

  // Получаем историю показанных событий (для исключения дублей)
  const shownEventsHistory = await getShownEventsFromHistory(userId, sessionId);
  const hasPreviouslyShownEvents =
    Array.isArray(shownEventsHistory) && shownEventsHistory.length > 0;
  if (shownEventsHistory.length > 0) {
    console.log(
      `🧠 [${userId}][${sessionId}] Ранее показано событий: ${shownEventsHistory.length}`
    );
  }
  // Если пользователь выбрал "Любой бюджет" или "Любая дата", мы также должны исключить ранее показанные события,
  // чтобы попытаться найти новые. Если новых не будет, fallback логика (ниже) решит, что делать.
  let eventsToExclude =
    isShowMoreRequest || isExplicitAnyBudget || isExplicitAnyDate ? shownEventsHistory : [];

  if (userPreferences === null) {
    try {
      userPreferences = await getUserPreferences(userId);
      if (
        userPreferences &&
        (userPreferences.genres?.length > 0 ||
          userPreferences.artists?.length > 0 ||
          userPreferences.eventTypes?.length > 0 ||
          userPreferences.priceRange)
      ) {
        const preferencesDesc = formatPreferencesDescription(userPreferences);
        console.log(
          `🧠 [${userId}][${sessionId}] Предпочтения пользователя загружены: ${preferencesDesc}`
        );
      }
    } catch (error) {
      console.warn(
        `⚠️ [${userId}][${sessionId}] Не удалось загрузить предпочтения пользователя:`,
        error
      );
    }
  }

  if (wantsPreferredEventsRequest) {
    const hasAnyPreferences = hasStoredPreferenceMemory(userPreferences);
    if (!hasAnyPreferences) {
      console.log(`🧭 [${userId}][${sessionId}] Запрос на предпочтения, но их пока нет`);
      if (requestId) updateStatus(requestId, 'Формируем ответ...');
      return {
        kind: 'reply',
        response: await buildEmptyPreferencesResponseViaLlm({
          userId,
          sessionId,
          userMessage,
          requestId,
        }),
      };
    }
  }

  // Получаем текущие слоты сессии и объединяем с новыми извлеченными
  let currentSlots = await getCurrentSessionSlots(userId, sessionId);

  const shouldReuseSessionMemorySlots =
    isShowMoreRequest || isExplicitAnyBudget || isExplicitAnyDate || isClarificationRequest;

  if (shouldReuseSessionMemorySlots) {
    const snapshotSlots = Array.isArray(session?.slotsSnapshot) ? session.slotsSnapshot : [];
    const memorySlotsFromSnapshot = snapshotSlots.filter(
      (slot) => slot && slot.source === 'memory_preference'
    );

    if (memorySlotsFromSnapshot.length > 0) {
      currentSlots = mergeSlots(currentSlots, memorySlotsFromSnapshot);
      console.log(
        `🧠 [${userId}][${sessionId}] Восстанавливаю memory-слоты из snapshots для follow-up запроса: ` +
          memorySlotsFromSnapshot.map((slot) => `${slot.name}="${slot.value}"`).join(', ')
      );
    }
  }

  let newlyExtractedSlots = Array.isArray(slotExtractionResult?.slots)
    ? slotExtractionResult.slots
        .filter((slot) => slot && slot.name)
        .map((slot) => {
          const normalizedName = normalizeSlotName(String(slot.name).trim());
          return normalizedName === slot.name ? slot : { ...slot, name: normalizedName };
        })
    : [];

  if (
    recommendationsIntent &&
    !offTopicIntent &&
    !isShowMoreRequest &&
    !isEventDetailsRequest &&
    !isChangeCityRequest &&
    !isChangeDateRequest &&
    !isChangePreferencesRequest &&
    !isHealthComplaintRequest &&
    !isQuickCategorySelection &&
    !isButtonEcho &&
    !isBuyTicketsUiCommand &&
    shouldProbeOffTopicEventSearch(userMessage)
  ) {
    const ambiguousCurrentSlots = findAmbiguousNamedEventSlots(currentSlots, userMessage);
    const ambiguousNewSlots = findAmbiguousNamedEventSlots(newlyExtractedSlots, userMessage);
    const ambiguousSlots = [...ambiguousCurrentSlots, ...ambiguousNewSlots];

    if (ambiguousSlots.length > 0) {
      const eventProbeResult = await probeKassirEventsForOffTopicCandidate({
        userId,
        sessionId,
        userMessage,
        currentSlots,
        requestId,
      });

      if (eventProbeResult.hasMatchingEvents) {
        currentSlots = replaceAmbiguousSlotsWithNamedEventSlots(
          currentSlots,
          ambiguousCurrentSlots,
          userMessage
        );
        newlyExtractedSlots = replaceAmbiguousSlotsWithNamedEventSlots(
          newlyExtractedSlots,
          ambiguousNewSlots.length > 0 ? ambiguousNewSlots : ambiguousSlots,
          userMessage
        );

        const slotsToPersist = eventProbeResult.slots.filter(
          (slot) => slot && slot.name !== 'город' && String(slot.value || '').trim()
        );
        const slotsToRemoveFromDb = ambiguousSlots
          .map((slot) => ({ name: slot.name, value: slot.value }))
          .filter((slot) => slot.name && String(slot.value || '').trim());

        if (slotsToRemoveFromDb.length > 0) {
          await removeSlotsFromDatabase(userId, slotsToRemoveFromDb);
        }

        for (const slot of slotsToPersist) {
          await saveSlotToDatabase(userId, {
            ...slot,
            source: slot.source || 'event_probe_rewrite',
          });
        }

        console.log(
          `✅ [${userId}][${sessionId}] EVENT_PROBE_REWRITE: "${userMessage}" найдено в афише, ` +
            'перекладываю распознанный жанр в название_мероприятия/поисковый_запрос',
          {
            removedSlots: slotsToRemoveFromDb.map((slot) => `${slot.name}="${slot.value}"`),
            firstEvent: summarizeOffTopicProbeEvent(eventProbeResult.events[0]),
          }
        );
      } else {
        console.log(
          `ℹ️ [${userId}][${sessionId}] EVENT_PROBE_REWRITE: "${userMessage}" не найдено как событие, ` +
            'оставляю слоты от AI Slots без изменений',
          { reason: eventProbeResult.reason }
        );
      }
    }
  }

  const llmNegativeDateSlots = newlyExtractedSlots.filter((slot) => isNegativeDateSlot(slot));
  const llmAnyDateSelection = newlyExtractedSlots.some((slot) => isAnyDateSelectionSlot(slot));
  const hasLlmDateRewriteSignal =
    isChangeDateRequest || llmAnyDateSelection || llmNegativeDateSlots.length > 0;

  if (llmAnyDateSelection) {
    isExplicitAnyDate = true;
  }

  // Если пользователь хочет изменить город, удаляем слот города
  if (isChangeCityRequest) {
    console.log(`🏙️ [${userId}][${sessionId}] Удаляю слот города из текущих слотов`);
    currentSlots = currentSlots.filter((slot) => slot && slot.name !== 'город');
  }

  // Если пользователь хочет изменить дату, удаляем слот даты
  if (isChangeDateRequest || isExplicitAnyDate || hasLlmDateRewriteSignal) {
    console.log(
      `📅 [${userId}][${sessionId}] Удаляю слот даты из текущих слотов (isExplicitAnyDate: ${isExplicitAnyDate})`
    );
    currentSlots = currentSlots.filter((slot) => slot && slot.name !== 'дата_события');
  }

  // ВАЖНО: Обогащаем слоты из БД датами, если они еще не обогащены
  // Это нужно, потому что старые слоты могли быть сохранены без dateRange
  const enrichCurrentSlotsWithDates = (slots = []) =>
    slots.map((slot) => {
      if (slot.parsedDate || slot.dateRange) {
        return slot;
      }
      const enriched = enrichSlotWithDate(slot);
      if (enriched !== slot) {
        console.log(
          `📅 [${userId}][${sessionId}] Обогащен слот из БД ${slot.name}="${slot.value}":`,
          {
            hasParsedDate: !!enriched.parsedDate,
            hasDateRange: !!enriched.dateRange,
            dateRange: enriched.dateRange
              ? {
                  startDate: enriched.dateRange.startDate?.toISOString(),
                  endDate: enriched.dateRange.endDate?.toISOString(),
                }
              : null,
          }
        );
      }
      return enriched;
    });

  let enrichedCurrentSlots = coalesceDateSlotsIntoRange(
    enrichCurrentSlotsWithDates(currentSlots),
    userMessage
  );

  if (hasLlmDateRewriteSignal) {
    const droppedDateSlots = newlyExtractedSlots
      .filter(
        (slot) =>
          slot &&
          slot.name === 'дата_события' &&
          (slot.isNegative === true || isAnyDateSelectionSlot(slot))
      )
      .map((slot) => `${slot.value}${slot.isNegative ? ' (negative)' : ''}`);
    newlyExtractedSlots = newlyExtractedSlots.filter(
      (slot) =>
        !(
          slot &&
          slot.name === 'дата_события' &&
          (slot.isNegative === true || isAnyDateSelectionSlot(slot))
        )
    );
    shouldSkipHistoricalDateRecovery = true;
    console.log(
      `📅 [${userId}][${sessionId}] LLM-сигнал смены даты: ` +
        `change_date=${isChangeDateRequest}, anyDate=${llmAnyDateSelection}, negativeDates=${llmNegativeDateSlots.length}. ` +
        `Служебные date-слоты исключаю из merge` +
        `${droppedDateSlots.length > 0 ? ` [${droppedDateSlots.join(', ')}]` : ''}.`
    );
  }

  const recoveredIntentSlots = extractSlotLikeIntents(detectedIntents);
  recoveredIntentSlots.forEach((slot) => {
    if (
      !newlyExtractedSlots.some((existingSlot) => existingSlot && existingSlot.name === slot.name)
    ) {
      newlyExtractedSlots.push(slot);
    }
  });

  directPreferenceChange = inferDirectPreferenceChange(userMessage, newlyExtractedSlots);
  const shouldApplyDirectPreferenceChange = Boolean(
    directPreferenceChange?.hasAnyUpdates || directPreferenceChange?.canApplyDirectly
  );

  if (shouldApplyDirectPreferenceChange) {
    canApplyChangePreferencesDirectly = Boolean(directPreferenceChange?.canApplyDirectly);
    let preferencesReconciled = false;

    if (directPreferenceChange.canApplyDirectly) {
      preferencesReconciled = await reconcileDirectSearchTargetWithDislikes(
        userId,
        directPreferenceChange
      );
    }

    if (directPreferenceChange.hasAnyUpdates) {
      await persistDirectPreferenceChange(userId, directPreferenceChange);
    }

    if (preferencesReconciled || directPreferenceChange.hasAnyUpdates) {
      try {
        userPreferences = await getUserPreferences(userId);
      } catch (error) {
        console.warn(
          `⚠️ [${userId}][${sessionId}] Не удалось перезагрузить предпочтения после preference-change reconcile:`,
          error
        );
      }
    }

    console.log(
      `🧠 [${userId}][${sessionId}] Применяю изменение предпочтений/поисковой цели из текста`,
      {
        dislikedGenres: directPreferenceChange.dislikedGenres,
        dislikedEventTypes: directPreferenceChange.dislikedEventTypes,
        preferredGenre: directPreferenceChange.preferredGenre,
        preferredEventType: directPreferenceChange.preferredEventType,
        canApplyDirectly: directPreferenceChange.canApplyDirectly,
        shouldPersistPositivePreference: directPreferenceChange.shouldPersistPositivePreference,
        inferredWithoutIntent: !isChangePreferencesRequest,
      }
    );

    const directSearchTargetSlots =
      buildImmediateSearchSlotsFromPreferenceChange(directPreferenceChange);
    if (directSearchTargetSlots.length > 0) {
      newlyExtractedSlots = applyImmediateSearchSlotsFromPreferenceChange(
        newlyExtractedSlots,
        directSearchTargetSlots
      );
      console.log(
        `🎯 [${userId}][${sessionId}] Для текущего поиска применяю явную цель из текста: ` +
          directSearchTargetSlots.map((slot) => `${slot.name}="${slot.value}"`).join(', ')
      );
    }
  }

  const seniorCompanionSlots = buildSeniorCompanionSlots(userMessage);
  for (const seniorSlot of seniorCompanionSlots) {
    const existingSlotIndex = newlyExtractedSlots.findIndex(
      (slot) => slot && slot.name === seniorSlot.name
    );
    if (existingSlotIndex >= 0) {
      newlyExtractedSlots.splice(existingSlotIndex, 1, seniorSlot);
    } else {
      newlyExtractedSlots.push(seniorSlot);
    }
    console.log(
      `👵 [${userId}][${sessionId}] Сохраняю senior слот в БД: ${seniorSlot.name}="${seniorSlot.value}"`
    );
    try {
      await saveSlotToDatabase(userId, seniorSlot);
      console.log(
        `👵 [${userId}][${sessionId}] Senior слот сохранён в БД: ${seniorSlot.name}="${seniorSlot.value}"`
      );
    } catch (err) {
      console.error(
        `👵 [${userId}][${sessionId}] Ошибка сохранения senior слота: ${seniorSlot.name}`,
        err
      );
    }
  }

  if (seniorCompanionSlots.length > 0) {
    console.log(
      `👵 [${userId}][${sessionId}] Восстанавливаю senior-friendly контекст из текста: ` +
        `${seniorCompanionSlots.map((slot) => `${slot.name}="${slot.value}"`).join(', ')}`
    );
  }

  const normalizedRecoveredUiSlot = recoveredUiSlot
    ? { ...recoveredUiSlot, name: normalizeSlotName(String(recoveredUiSlot.name).trim()) }
    : null;

  if (
    normalizedRecoveredUiSlot &&
    !newlyExtractedSlots.some(
      (slot) =>
        slot && normalizeSlotName(String(slot.name).trim()) === normalizedRecoveredUiSlot.name
    )
  ) {
    newlyExtractedSlots.push(normalizedRecoveredUiSlot);
    await saveSlotToDatabase(userId, normalizedRecoveredUiSlot);
    console.log(
      `💾 [${userId}][${sessionId}] UI-выбор восстановлен в слот: ${normalizedRecoveredUiSlot.name}="${normalizedRecoveredUiSlot.value}"`
    );
  } else if (normalizedRecoveredUiSlot) {
    console.log(
      `↪️ [${userId}][${sessionId}] UI-выбор не восстанавливаю: в текущем сообщении уже есть слот ${normalizedRecoveredUiSlot.name}`
    );
  }

  // AI Slots иногда кладёт "концерт/театр/выставки" в жанр. Приводим к тип_мероприятия.
  newlyExtractedSlots.forEach((slot) => {
    if (!slot || !slot.name || slot.value === undefined || slot.value === null) return;
    if (slot.name !== 'жанр_музыки' && slot.name !== 'жанр') return;
    const v = String(slot.value).toLowerCase().trim().replace(/ё/g, 'е');
    if (v === 'концерт' || v === 'концерты') {
      slot.name = 'тип_мероприятия';
      slot.value = 'концерты';
    } else if (v === 'театр' || v === 'театры') {
      slot.name = 'тип_мероприятия';
      slot.value = 'театры';
    } else if (v === 'выставка' || v === 'выставки') {
      slot.name = 'тип_мероприятия';
      slot.value = 'выставки';
    }
  });

  const currentCategoryContext = normalizeCategory(
    currentSlots.find(
      (slot) =>
        slot &&
        (slot.name === 'тип_мероприятия' ||
          slot.name === 'тип_события' ||
          slot.name === 'категория') &&
        slot.value
    )?.value || ''
  );

  for (const slot of newlyExtractedSlots) {
    if (!slot || !slot.value) {
      continue;
    }

    if (!['тип_мероприятия', 'тип_события', 'категория'].includes(slot.name)) {
      continue;
    }

    const taxonomyGenreEntry = resolveTaxonomyGenreEntryByValue(slot.value, {
      preferredCategory: clarificationTarget === 'genre' ? currentCategoryContext : '',
    });

    if (!taxonomyGenreEntry) {
      continue;
    }

    slot.value = taxonomyGenreEntry.category;

    const hasMatchingGenreSlot = newlyExtractedSlots.some(
      (candidate) =>
        candidate &&
        ['жанр', 'жанр_музыки', 'предпочтения_жанры'].includes(candidate.name) &&
        normalizeComparableSlotValue(candidate.value) ===
          normalizeComparableSlotValue(taxonomyGenreEntry.genre)
    );

    if (!hasMatchingGenreSlot) {
      newlyExtractedSlots.push({
        name: taxonomyGenreEntry.slotName,
        value: taxonomyGenreEntry.genre,
        confidence: slot.confidence ?? 0.92,
        source: 'taxonomy_genre_rewrite',
      });
    }
  }

  const hasExplicitGenreSlot = newlyExtractedSlots.some(
    (slot) =>
      slot &&
      ['жанр', 'жанр_музыки', 'предпочтения_жанры'].includes(slot.name) &&
      String(slot.value || '').trim()
  );
  const currentEventTypeBeforeReset = currentSlots.find(
    (slot) =>
      slot &&
      (slot.name === 'тип_мероприятия' ||
        slot.name === 'тип_события' ||
        slot.name === 'категория') &&
      slot.value
  );
  const extractedEventTypeBeforeReset = newlyExtractedSlots.find(
    (slot) =>
      slot &&
      (slot.name === 'тип_мероприятия' ||
        slot.name === 'тип_события' ||
        slot.name === 'категория') &&
      slot.value
  );
  const effectiveCategoryBeforeReset = normalizeCategory(
    extractedEventTypeBeforeReset?.value ||
      currentEventTypeBeforeReset?.value ||
      detectCategoryFromText(userMessage) ||
      ''
  );
  const positiveSearchSourceBeforeReset =
    directPreferenceChange?.canApplyDirectly && directPreferenceChange?.positivePart
      ? directPreferenceChange.positivePart
      : userMessage;

  if (!hasExplicitGenreSlot) {
    const intentTriggers = Array.isArray(detectedIntents)
      ? detectedIntents.map((intent) => String(intent?.trigger || '').trim()).filter(Boolean)
      : [];
    const taxonomyGenreEntry =
      resolveTaxonomyGenreEntryFromText(positiveSearchSourceBeforeReset, {
        preferredCategory: effectiveCategoryBeforeReset,
      }) ||
      resolveTaxonomyGenreEntryFromText(userMessage, {
        preferredCategory: effectiveCategoryBeforeReset,
      }) ||
      intentTriggers
        .map((trigger) =>
          resolveTaxonomyGenreEntryFromText(trigger, {
            preferredCategory: effectiveCategoryBeforeReset,
          })
        )
        .find(Boolean) ||
      null;

    if (taxonomyGenreEntry) {
      const taxonomyGenreSlot = {
        name: taxonomyGenreEntry.slotName,
        value: taxonomyGenreEntry.genre,
        confidence: 0.92,
        source: 'taxonomy_genre_rule',
      };

      newlyExtractedSlots.push(taxonomyGenreSlot);
      await saveSlotToDatabase(userId, taxonomyGenreSlot);
      console.log(
        `🧭 [${userId}][${sessionId}] Жанр из таксономии обнаружен в тексте: "${taxonomyGenreEntry.genre}" ` +
          `→ категория "${taxonomyGenreEntry.category}". Сохраняю слот жанра до сброса контекста для точного поиска.`
      );
    }
  }

  const hasClarificationFollowUpSelection = Boolean(
    isButtonEcho &&
    clarificationTarget &&
    !clarificationActionTarget &&
    !isShowMoreRequest &&
    !isQuickCategorySelection
  );

  const answeredPendingClarification = shouldTreatAsClarificationFollowUpSelection({
    clarificationAsked: Boolean(session?.clarificationAsked),
    clarificationTarget,
    newlyExtractedSlots,
    recoveredUiSlot: normalizedRecoveredUiSlot,
    userMessage,
    isExplicitAnyBudget,
    isExplicitAnyDate,
    isQuickCategorySelection,
  });

  if (
    answeredPendingClarification &&
    session &&
    (session.quickOfferSent || session.finalOfferSent || session.clarificationAsked)
  ) {
    console.log(
      `🔄 [${userId}][${sessionId}] Пользователь ответил на уточнение "${clarificationTarget}". ` +
        `Сбрасываю флаги выдачи, чтобы выполнить новый поиск даже без формального slotsChanged.`
    );
    await resetOfferFlags(userId, sessionId);
    session.quickOfferSent = false;
    session.finalOfferSent = false;
    session.clarificationAsked = false;
  }

  const freshSearchResetPlan = buildFreshSearchResetPlan({
    userMessage,
    currentSlots,
    previousSessionSlots: Array.isArray(session?.slotsSnapshot) ? session.slotsSnapshot : [],
    newlyExtractedSlots,
    hasMatchedUiButtonEcho: Boolean(isButtonEcho && inferredUiSlot),
    hasClarificationFollowUpSelection,
    isShowMoreRequest,
    isChangeCityRequest,
    isChangeDateRequest,
    isClarificationRequest,
    isEventDetailsRequest,
    isBuyTicketRequest: Boolean(buyTicketIntent),
    isExplicitAnyBudget,
    isExplicitAnyDate,
    wantsPreferredEventsRequest,
    directPreferenceChange,
  });
  const freshSearchDetected = Boolean(freshSearchResetPlan);

  if (freshSearchResetPlan) {
    currentSlots = freshSearchResetPlan.carryOverSlots;
    enrichedCurrentSlots = coalesceDateSlotsIntoRange(
      enrichCurrentSlotsWithDates(currentSlots),
      userMessage
    );
    eventsToExclude = [];

    if (session?.selectedEvent) {
      await updateSessionSelectedEvent(userId, sessionId, null);
      session.selectedEvent = null;
    }

    if (session && (session.quickOfferSent || session.finalOfferSent)) {
      await resetOfferFlags(userId, sessionId);
      session.quickOfferSent = false;
      session.finalOfferSent = false;
    }

    console.log(
      `🧼 [${userId}][${sessionId}] Определен новый независимый запрос: ${freshSearchResetPlan.reasons.join('; ')}. ` +
        `Сбрасываю поисковый контекст${freshSearchResetPlan.droppedSlots.length > 0 ? ` [${freshSearchResetPlan.droppedSlots.join(', ')}]` : ''}, ` +
        `сохраняю только переносимые слоты [${freshSearchResetPlan.carryOverSlots.map((slot) => `${slot.name}="${slot.value}"`).join(', ') || '∅'}].`
    );

    const freshSearchCleanup = sanitizeFreshSearchExtractedSlots({
      newlyExtractedSlots,
      userMessage,
      reasons: freshSearchResetPlan.reasons,
    });
    newlyExtractedSlots = freshSearchCleanup.slots;

    if (freshSearchCleanup.droppedSlots.length > 0) {
      console.log(
        `🧹 [${userId}][${sessionId}] После reset убираю не подтвержденные сообщением слоты: ` +
          `${freshSearchCleanup.droppedSlots.join(', ')}`
      );
    }
    if (freshSearchCleanup.enforcedSearchQuery) {
      console.log(
        `🎯 [${userId}][${sessionId}] Фиксирую поисковый_запрос по новому фокусу: "${freshSearchCleanup.enforcedSearchQuery}"`
      );
    }
  }

  const explicitPriceCap = extractPriceCapFromText(userMessage);
  const cheapBudgetRequested = wantsCheaperBudget(userMessage);
  const existingBudgetCap = extractBudgetCapFromSlots([
    ...enrichedCurrentSlots,
    ...newlyExtractedSlots,
  ]);
  const selectedEventForBudget = session?.selectedEvent || null;
  const targetBudgetCap =
    explicitPriceCap ??
    (cheapBudgetRequested
      ? computeRelativeCheaperBudgetCap(selectedEventForBudget, existingBudgetCap)
      : null);
  if (targetBudgetCap) {
    const nextBudgetCap = explicitPriceCap
      ? targetBudgetCap
      : existingBudgetCap
        ? Math.min(existingBudgetCap, targetBudgetCap)
        : targetBudgetCap;

    const newBudgetCap = extractBudgetCapFromSlots(newlyExtractedSlots);
    const shouldUpdateExisting =
      (explicitPriceCap && (!newBudgetCap || newBudgetCap !== nextBudgetCap)) ||
      (cheapBudgetRequested && (!newBudgetCap || newBudgetCap !== nextBudgetCap));

    if (shouldUpdateExisting) {
      const existingNewPriceTo = newlyExtractedSlots.find(
        (s) => s && (s.name === 'цена_до' || s.name === 'бюджет')
      );
      if (existingNewPriceTo) {
        existingNewPriceTo.name = 'цена_до';
        existingNewPriceTo.value = String(nextBudgetCap);
        if (existingNewPriceTo.confidence === undefined || existingNewPriceTo.confidence === null) {
          existingNewPriceTo.confidence = 0.8;
        }
        await saveSlotToDatabase(userId, {
          name: 'цена_до',
          value: String(nextBudgetCap),
          confidence: existingNewPriceTo.confidence,
        });
        console.log(`💾 [${userId}][${sessionId}] Обновлен бюджет: цена_до=${nextBudgetCap}`);
      } else if (!existingBudgetCap || nextBudgetCap !== existingBudgetCap) {
        const priceToSlot = { name: 'цена_до', value: String(nextBudgetCap), confidence: 0.8 };
        newlyExtractedSlots.push(priceToSlot);
        await saveSlotToDatabase(userId, priceToSlot);
        console.log(
          `💾 [${userId}][${sessionId}] Автоматически установлен бюджет: цена_до=${nextBudgetCap}`
        );
      }
    }
  }

  // КРИТИЧЕСКИ ВАЖНО: явный город из текущего сообщения должен иметь приоритет над городом,
  // который ранее пришёл из поддомена/памяти. Иначе текст может говорить про Москву,
  // а поиск продолжит идти по Нижнему Новгороду.
  const explicitCityFromMessage = extractExplicitRussianCityFromMessage(userMessage);
  const existingCitySlot = currentSlots.find((s) => s.name === 'город');
  const extractedCitySlotIndex = newlyExtractedSlots.findIndex((s) => s && s.name === 'город');
  const extractedCitySlot =
    extractedCitySlotIndex >= 0 ? newlyExtractedSlots[extractedCitySlotIndex] : null;

  if (explicitCityFromMessage) {
    const shouldOverrideCurrentCity = !areSameRussianCity(
      existingCitySlot?.value,
      explicitCityFromMessage
    );
    const shouldOverrideExtractedCity = !areSameRussianCity(
      extractedCitySlot?.value,
      explicitCityFromMessage
    );

    if (shouldOverrideExtractedCity) {
      const citySlot = {
        name: 'город',
        value: explicitCityFromMessage,
        confidence: 0.98,
        source: 'message_city_override',
      };

      if (extractedCitySlotIndex >= 0) {
        newlyExtractedSlots.splice(extractedCitySlotIndex, 1, citySlot);
      } else {
        newlyExtractedSlots.push(citySlot);
      }

      console.log(
        `🏙️ [${userId}][${sessionId}] Явный город из сообщения имеет приоритет: "${explicitCityFromMessage}"` +
          `${existingCitySlot?.value ? ` вместо "${existingCitySlot.value}"` : ''}`
      );
    }

    if (shouldOverrideCurrentCity || shouldOverrideExtractedCity) {
      await saveSlotToDatabase(userId, {
        name: 'город',
        value: explicitCityFromMessage,
        confidence: 0.98,
      });
      console.log(
        `💾 [${userId}][${sessionId}] Явный город "${explicitCityFromMessage}" сохранён в БД`
      );
    }
  }

  // КРИТИЧЕСКИ ВАЖНО: Если AI Slots не извлек город, но пользователь написал название города
  // (например, нажал на кнопку "Санкт-Петербург"), пробуем распознать город напрямую
  const hasNewCitySlot = newlyExtractedSlots.some((s) => s.name === 'город');

  if (!hasNewCitySlot && !existingCitySlot) {
    const trimmedMessage = userMessage.trim();
    // Проверяем, является ли сообщение валидным городом
    if (isRussianCity(trimmedMessage)) {
      const normalizedCity = normalizeCityButton(trimmedMessage);
      console.log(
        `🏙️ [${userId}][${sessionId}] Распознан город из сообщения: "${trimmedMessage}" -> "${normalizedCity}"`
      );
      const citySlot = { name: 'город', value: normalizedCity, confidence: 0.95 };
      newlyExtractedSlots.push(citySlot);
      // Сохраняем слот города в БД
      await saveSlotToDatabase(userId, citySlot);
      console.log(`💾 [${userId}][${sessionId}] Слот города "${normalizedCity}" сохранён в БД`);
    }
  }

  // КРИТИЧЕСКИ ВАЖНО: Фильтруем слоты города, чтобы "Другой город" и его варианты не сохранялись как город
  const filteredNewSlots = newlyExtractedSlots.filter((slot) => {
    if (slot.name === 'город' && slot.value) {
      const cityValue = String(slot.value).trim();
      const cityValueLower = cityValue.toLowerCase();

      // Проверяем, не является ли это "Другой город" или его вариантами
      const otherCityVariants = [
        'other city',
        'othercity',
        'другой город',
        'другом городе',
        'иной город',
        'прочий город',
      ];

      if (otherCityVariants.some((variant) => cityValueLower.includes(variant))) {
        console.log(
          `🚫 [${userId}][${sessionId}] Игнорирую слот города "${cityValue}" - это не валидный город`
        );
        return false;
      }

      // Проверяем, является ли это валидным российским городом
      if (!isRussianCity(cityValue)) {
        console.log(
          `🚫 [${userId}][${sessionId}] Игнорирую слот города "${cityValue}" - не является валидным российским городом`
        );
        return false;
      }
    }
    return true;
  });

  // Обогащаем новые слоты датами и при необходимости достраиваем диапазон из текстового значения.
  const enrichedNewSlots = coalesceDateSlotsIntoRange(
    filteredNewSlots.map((slot) => {
      const enriched = enrichSlotWithDate(slot);
      const hasNewStructuredDate =
        enriched !== slot ||
        (!!enriched.parsedDate && !slot.parsedDate) ||
        (!!enriched.dateRange && !slot.dateRange);

      if (hasNewStructuredDate) {
        console.log(
          `📅 [${userId}][${sessionId}] Обогащен новый слот ${slot.name}="${slot.value}":`,
          {
            hasParsedDate: !!enriched.parsedDate,
            hasDateRange: !!enriched.dateRange,
            dateRange: enriched.dateRange
              ? {
                  startDate: enriched.dateRange.startDate?.toISOString(),
                  endDate: enriched.dateRange.endDate?.toISOString(),
                }
              : null,
          }
        );
      } else if (slot.parsedDate || slot.dateRange) {
        console.log(
          `📅 [${userId}][${sessionId}] Слот ${slot.name}="${slot.value}" уже обогащен:`,
          {
            hasParsedDate: !!slot.parsedDate,
            hasDateRange: !!slot.dateRange,
          }
        );
      }
      return enriched;
    }),
    userMessage
  );

  let mergedSlots =
    enrichedNewSlots.length > 0
      ? mergeSlots(enrichedCurrentSlots, enrichedNewSlots)
      : enrichedCurrentSlots;
  mergedSlots = coalesceDateSlotsIntoRange(mergedSlots, userMessage);
  const showAllIntent =
    normalizedUserMessage.length > 0 &&
    SHOW_ALL_KEYWORDS.some((keyword) => normalizedUserMessage.includes(keyword));

  // История нужна и для эвристического восстановления даты, и дальше по пайплайну ответа.
  // Загружаем её один раз заранее, чтобы не попасть в TDZ при раннем использовании.
  const history = await getMessageHistory(userId, sessionId);

  const hasDateSlotAfterMerge = hasUsableDateSlot(mergedSlots);

  if (!hasDateSlotAfterMerge) {
    const heuristicDateSlot = inferDateSlotFromConversation({
      userMessage,
      history,
      includeHistory: !shouldSkipHistoricalDateRecovery && !isButtonEcho && !showAllIntent,
    });
    if (heuristicDateSlot) {
      mergedSlots = mergeSlots(mergedSlots, [heuristicDateSlot]);
      console.log(
        `📅 [${userId}][${sessionId}] Восстановил слот даты из текущего сообщения/истории:`,
        {
          value: heuristicDateSlot.value,
          hasParsedDate: !!heuristicDateSlot.parsedDate,
          hasDateRange: !!heuristicDateSlot.dateRange,
          source: heuristicDateSlot.source,
        }
      );
      try {
        await saveSlotToDatabase(userId, heuristicDateSlot);
        console.log(`💾 [${userId}][${sessionId}] Восстановленный слот даты сохранён в БД`);
      } catch (error) {
        console.warn(
          `⚠️ [${userId}][${sessionId}] Не удалось сохранить восстановленный слот даты в БД:`,
          error
        );
      }
    }
  }

  if (wantsPreferredEventsRequest) {
    const droppedMetaPreferenceSlots = mergedSlots.filter((slot) =>
      isMetaPreferenceReferenceSlot(slot)
    );
    if (droppedMetaPreferenceSlots.length > 0) {
      mergedSlots = mergedSlots.filter((slot) => !isMetaPreferenceReferenceSlot(slot));
      console.log(
        `🧹 [${userId}][${sessionId}] Убираю meta-слоты жанра перед применением памяти: ` +
          droppedMetaPreferenceSlots.map((slot) => `${slot.name}="${slot.value}"`).join(', ')
      );
    }
  }

  if (wantsPreferredEventsRequest && userPreferences) {
    const preferenceSlots = buildPreferenceSlotsFromPreferences({
      userPreferences,
      existingSlots: mergedSlots,
      memoryRequest: preferenceMemoryRequest,
    });
    if (preferenceSlots.length > 0) {
      mergedSlots = mergeSlots(mergedSlots, preferenceSlots);
      console.log(
        `🧠 [${userId}][${sessionId}] Дополняю слоты из предпочтений: ${preferenceSlots.map((s) => `${s.name}="${s.value}"`).join(', ')}`
      );
    }
  }

  if (!hasSeniorCompanionMarker(mergedSlots)) {
    const seniorConversationSlots = buildSeniorCompanionSlotsFromConversation({
      userMessage,
      history,
    });
    if (seniorConversationSlots.length > 0) {
      mergedSlots = mergeSlots(mergedSlots, seniorConversationSlots);
      console.log(
        `👵 [${userId}][${sessionId}] Восстанавливаю senior-friendly контекст из истории диалога: ` +
          `${seniorConversationSlots.map((slot) => `${slot.name}="${slot.value}"`).join(', ')}`
      );
    }
  }

  mergedSlots = enforceSeniorCompanionContext(mergedSlots);

  return {
    kind: 'continue',
    context: {
      offerEvents,
      noResultsDetected,
      allRequiredCollected,
      needsClarification,
      shouldSkipOfferGeneration,
      shownEventsHistory,
      newlyExtractedSlots,
      normalizedRecoveredUiSlot,
      eventsToExclude,
      cheapBudgetRequested,
      mergedSlots,
      history,
      showAllIntent,
      eventDetailsContext,
      allSlotsCollected,
      usedPreferencesForSearch,
      popularSelectionUsedForSearch,
      offerOriginalEvents,
      shouldSkipCache,
      keywordOverride,
      vagueCheck,
      hasPreviouslyShownEvents,
      freshSearchDetected,
      userPreferences,
      isExplicitAnyDate,
      directPreferenceChange,
      canApplyChangePreferencesDirectly,
    },
  };
}
