import {
  areRequiredSlotsCollected,
  getAllSlots,
  getRequiredSlots,
  isVagueRequest,
} from '../slotsRequirementsService.js';
import {
  hasDislikedGenrePreferences,
  shouldUsePopularSelectionCategoryClarification,
} from './clarification.js';
import {
  canUsePopularCitySelection,
  filterEventsByDislikedPreferences,
  generateQuickOffer,
  generateFinalOffer,
} from '../offerService.js';
import { getKnownEventTypeValue } from './slotUtils.js';
import {
  shouldBypassVagueClarificationForShowMore,
  shouldRepeatOfferForSameRecommendationRequest,
} from './redirects.js';
import {
  markClarificationAsked,
  markQuickOfferSent,
  markFinalOfferSent,
  updateSessionSelectedEvent,
} from '../sessionService.js';
import { getLastEventsFromHistory } from './conversationHistory.js';
import { getRemainingEventsFromPool } from '../offerHistoryPool.js';
import { updateStatus } from '../statusService.js';
import { pickEventFromReference } from './offerText.js';
import { parseBudgetSlotAmount } from './preferenceFeedback.js';
import { recoverPreviousOffer } from './recoverPreviousOffer.js';

export async function generateOffers({
  request: { userId, sessionId, userMessage, requestId },
  routing: {
    isEventDetailsRequest,
    session,
    wantsPreferredEventsRequest,
    allowPreferenceKeywordExpansion,
    isShowMoreRequest,
    normalizedUserMessage,
    isChangeCityRequest,
    isChangeDateRequest,
    isChangePreferencesRequest,
    isHealthComplaintRequest,
    isExplicitAnyBudget,
    lastEventsFromHistory,
    eventDetailsIntent,
  },
  slots: {
    allRequiredCollected,
    allSlotsCollected,
    vagueCheck,
    hasPreviouslyShownEvents,
    needsClarification,
    shouldSkipOfferGeneration,
    canApplyChangePreferencesDirectly,
    shouldSkipCache,
    isExplicitAnyDate,
    shownEventsHistory,
    offerEvents,
    offerOriginalEvents,
    usedPreferencesForSearch,
    popularSelectionUsedForSearch,
    noResultsDetected,
    history,
    eventDetailsContext,
    freshSearchDetected,
  },
  searchSlots: {
    effectiveSlots,
    requestType,
    slotsChanged,
    categoryChanged,
    userPreferences,
    fallbackQuery,
    keywordOverride,
    eventsToExclude,
    dateSlotChanged,
  },
  searchContext: {
    showAllRequested,
    wantsRecommendations,
    hasValidCity,
    citySlot,
    skipVagueClarificationForMoodPlan,
    isInvalidRequestForOffer,
    isNonRussianCity,
    nonRussianCityName,
    hasSpecificEventType,
  },
}) {
  const budgetSlot = effectiveSlots.find((s) => s.name === 'бюджет');
  const priceToSlot = effectiveSlots.find((s) => s.name === 'цена_до');
  let shouldAskPopularCategoryClarification = false;
  if (budgetSlot || priceToSlot) {
    console.log(`💰 [${userId}][${sessionId}] Слоты бюджета/цены:`, {
      budgetSlot: budgetSlot ? { name: budgetSlot.name, value: budgetSlot.value } : null,
      priceToSlot: priceToSlot ? { name: priceToSlot.name, value: priceToSlot.value } : null,
      allSlots: effectiveSlots.map((s) => ({ name: s.name, value: s.value })),
    });
  }

  if (!isEventDetailsRequest) {
    // Проверяем, все ли обязательные слоты собраны
    allRequiredCollected = await areRequiredSlotsCollected(effectiveSlots, requestType, {
      allowEmptyQuery: showAllRequested,
    });
    const allSlots = await getAllSlots(requestType);
    allSlotsCollected =
      allSlots.length > 0 &&
      allSlots.every((slotName) => effectiveSlots.some((slot) => slot.name === slotName));

    console.log(`🔍 [${userId}][${sessionId}] Проверка предложений:`);
    console.log(`   - Обязательные слоты собраны: ${allRequiredCollected}`);
    console.log(`   - Все слоты собраны: ${allSlotsCollected}`);
    console.log(`   - Быстрое предложение отправлено: ${session.quickOfferSent}`);
    console.log(`   - Финальное предложение отправлено: ${session.finalOfferSent}`);
    console.log(`   - Слоты изменились: ${slotsChanged}`);
    console.log(`   - Категория изменилась: ${categoryChanged}`);
    console.log(`   - Show-all requested: ${showAllRequested}`);
    console.log(`   - Обязательные слоты для ${requestType}:`, await getRequiredSlots(requestType));

    // если пользователь хочет изменить город или дату, не генерируем предложение - должно запросить новый параметр
    // также не генерируем, если запрос невалиден для генерации предложений (только город без поискового запроса)
    // или если это жалоба на здоровье/эмоциональное состояние
    // или если указан не-российский город
    // КРИТИЧЕСКИ ВАЖНО: не генерируем предложения если нет валидного города

    // Проверяем, является ли запрос расплывчатым (город + тип события, но без жанра/бюджета/даты)
    // Не задаём уточняющие вопросы если пользователь явно хочет "показать всё"
    // ВАЖНО: В новом диалоге старые вкусовые предпочтения не должны автоматически отключать уточнения.
    // Используем их только если пользователь явно попросил подбор по своим предпочтениям.
    const hasGenrePreferences =
      userPreferences &&
      Array.isArray(userPreferences.genres) &&
      userPreferences.genres.some((g) => {
        const v = String(g || '')
          .toLowerCase()
          .trim()
          .replace(/ё/g, 'е');
        return (
          v.length > 0 &&
          v !== 'концерт' &&
          v !== 'концерты' &&
          v !== 'театр' &&
          v !== 'театры' &&
          v !== 'выставка' &&
          v !== 'выставки'
        );
      });
    const hasDislikedGenres = hasDislikedGenrePreferences(userPreferences);
    const hasArtistPreferences =
      userPreferences && userPreferences.artists && userPreferences.artists.length > 0;
    const userHasRelevantPreferences = hasGenrePreferences || hasArtistPreferences;

    // Определяем, является ли текущий запрос музыкальным событием
    const isMusicEventRequest = effectiveSlots.some((slot) => {
      const value = (slot.value || '').toLowerCase();
      return (
        (slot.name === 'тип_мероприятия' || slot.name === 'категория') &&
        (value.includes('концерт') || value.includes('фестиваль'))
      );
    });

    vagueCheck = isVagueRequest(effectiveSlots);
    const canUsePopularSelectionFallback =
      wantsRecommendations &&
      canUsePopularCitySelection({
        slots: effectiveSlots,
        fallbackQuery,
        keywordOverride,
      });
    shouldAskPopularCategoryClarification =
      vagueCheck.isVague &&
      hasValidCity &&
      !showAllRequested &&
      !wantsPreferredEventsRequest &&
      !getKnownEventTypeValue(effectiveSlots) &&
      shouldUsePopularSelectionCategoryClarification({
        userMessage,
        slots: effectiveSlots,
        knownCity: citySlot?.value || '',
        fallbackQuery,
      });

    // По явному preference-driven запросу можно не уточнять жанр отдельно.
    if (
      allowPreferenceKeywordExpansion &&
      userHasRelevantPreferences &&
      vagueCheck.isVague &&
      vagueCheck.missingDetails.includes('жанр') &&
      isMusicEventRequest
    ) {
      console.log(
        `🧠 [${userId}][${sessionId}] У пользователя есть предпочтения (жанры: ${userPreferences.genres?.join(', ') || 'нет'}, артисты: ${userPreferences.artists?.join(', ') || 'нет'}), не спрашиваем про жанр для музыкального события`
      );
      vagueCheck.missingDetails = vagueCheck.missingDetails.filter((detail) => detail !== 'жанр');
    }

    if (
      hasDislikedGenres &&
      vagueCheck.isVague &&
      vagueCheck.missingDetails.includes('жанр') &&
      isMusicEventRequest
    ) {
      console.log(
        `🧠 [${userId}][${sessionId}] У пользователя есть исключённые жанры (${userPreferences.dislikedGenres?.join(', ') || 'нет'}), ` +
          'не задаю противоречивый вопрос о любимом жанре для музыкального события'
      );
      vagueCheck.missingDetails = vagueCheck.missingDetails.filter((detail) => detail !== 'жанр');
      if (vagueCheck.missingDetails.length === 0) {
        vagueCheck.isVague = false;
      }
    }

    // Полностью убираем расплывчатость только если пользователь сам попросил учитывать свои вкусы.
    if (
      allowPreferenceKeywordExpansion &&
      userHasRelevantPreferences &&
      vagueCheck.isVague &&
      isMusicEventRequest
    ) {
      console.log(
        `✅ [${userId}][${sessionId}] У пользователя есть музыкальные предпочтения и это музыкальное событие, игнорируем расплывчатость запроса (недостающие детали: ${vagueCheck.missingDetails.join(', ')}) и генерируем предложение`
      );
      vagueCheck.isVague = false;
      vagueCheck.missingDetails = [];
    }

    // Если пользователь упоминает «настроение» / «настрой», но конкретный тип не указан
    // и mood-слот не пришёл из ai-slots → форсируем уточнение.
    const hasMoodSlotInEffectiveSlots = effectiveSlots.some(
      (s) => s && s.name === 'настроение' && String(s.value || '').trim().length > 0
    );
    if (!hasMoodSlotInEffectiveSlots) {
      const normalizedMsgForMood = userMessage.toLowerCase().replace(/ё/g, 'е');
      const mentionsMood = /настроени|настрой(?!к)/u.test(normalizedMsgForMood);
      if (mentionsMood) {
        const hasSpecificMoodMarker =
          /(хорош|отличн|прекрасн|замечат|чудесн|позитив|весел|велик|романтич|спокойн|энергичн|грустн|плох|ужасн|тоскл|печальн|бодр)\S*\s+настроени/u.test(
            normalizedMsgForMood
          ) ||
          /настроени\S*\s+\S*\s{0,5}(хорош|отличн|прекрасн|замечат|чудесн|позитив|весел|велик|романтич|спокойн|энергичн|грустн|плох|ужасн|тоскл|печальн|бодр)/u.test(
            normalizedMsgForMood
          ) ||
          /(поднят|улучш|поддерж|сохран|продолж|испорт|потеря)\S*\s+(?:\S+\s+){0,3}настроени/u.test(
            normalizedMsgForMood
          ) ||
          /настроени\S*\s+(?:\S+\s+){0,3}(поднят|улучш|поддерж|сохран|продолж|не\s+потеря)/u.test(
            normalizedMsgForMood
          ) ||
          /(скучн|тоск|хандр|грустн|устал|выгорел|развея|отвлеч|взбодр|повесел|посмея|рассмеш|развлеч|расслаб|романт|свидан|влюблен|энерг|драйв|актив|интеллект|вдохнов|необыч|эксперимент)/u.test(
            normalizedMsgForMood
          );
        if (!hasSpecificMoodMarker) {
          console.log(
            `🎭 [${userId}][${sessionId}] Настроение упомянуто но тип не указан — ` +
              `форсирую уточнение о настроении.`
          );
          vagueCheck.isVague = true;
          vagueCheck.missingDetails = ['настроение'];
        }
      }
    }

    const isForcedMoodClarificationEarly =
      Array.isArray(vagueCheck.missingDetails) && vagueCheck.missingDetails.includes('настроение');
    if (
      skipVagueClarificationForMoodPlan &&
      vagueCheck.isVague &&
      !isForcedMoodClarificationEarly
    ) {
      console.log(
        `🎭 [${userId}][${sessionId}] Активен mood-план для текущих слотов, ` +
          `не задаю уточнение по категории/бюджету (недостающие детали: ${vagueCheck.missingDetails.join(', ') || 'нет'})`
      );
      vagueCheck.isVague = false;
      vagueCheck.missingDetails = [];
    }

    const shouldBypassVagueClarification = shouldBypassVagueClarificationForShowMore({
      isShowMoreRequest,
      hasPreviouslyShownEvents,
      hasValidCity,
    });

    if (shouldBypassVagueClarification && vagueCheck.isVague) {
      console.log(
        `🔁 [${userId}][${sessionId}] follow-up "показать другие варианты" при уже показанных событиях ` +
          `не должен сбрасывать контекст в уточнение (${vagueCheck.missingDetails.join(', ') || 'нет'}).`
      );
    }

    // Категория выбрана, но деталей мало — сначала уточняем, потом показываем.
    const normalizedCategoryOnly = normalizedUserMessage.trim();
    const isCategoryOnlySelection = ['концерты', 'театры', 'выставки', 'музеи'].includes(
      normalizedCategoryOnly
    );

    // Если форсировано уточнение настроения — popular selection fallback не должен его подавлять
    const isForcedMoodClarification =
      vagueCheck.isVague &&
      Array.isArray(vagueCheck.missingDetails) &&
      vagueCheck.missingDetails.includes('настроение');

    needsClarification =
      vagueCheck.isVague &&
      !shouldBypassVagueClarification &&
      (isForcedMoodClarification ||
        !canUsePopularSelectionFallback ||
        shouldAskPopularCategoryClarification) &&
      !showAllRequested &&
      !wantsPreferredEventsRequest &&
      (isForcedMoodClarification ||
        isCategoryOnlySelection ||
        (!session.clarificationAsked && !session.quickOfferSent));

    if (needsClarification) {
      console.log(
        `🤔 [${userId}][${sessionId}] Обнаружен расплывчатый запрос. Недостающие детали: ${vagueCheck.missingDetails.join(', ')}`
      );
      if (shouldAskPopularCategoryClarification) {
        console.log(
          `🔥 [${userId}][${sessionId}] Вместо мгновенной popular-selection выдачи сначала уточняю категорию популярных событий`
        );
      }
    } else if (canUsePopularSelectionFallback) {
      console.log(
        `🔥 [${userId}][${sessionId}] Расплывчатый запрос закрываю через городскую подборку популярных событий без дополнительного уточнения`
      );
    }

    if (needsClarification) {
      // Отмечаем, что уточняющие вопросы будут заданы
      await markClarificationAsked(userId, sessionId);
      session.clarificationAsked = true;
    }

    const missingCityAfterChange = isChangeCityRequest && !hasValidCity;
    const hasDateSlot = effectiveSlots.some(
      (slot) => slot && slot.name === 'дата_события' && slot.value
    );
    const missingDateAfterChange = isChangeDateRequest && !hasDateSlot;

    shouldSkipOfferGeneration =
      missingCityAfterChange ||
      missingDateAfterChange ||
      (isChangePreferencesRequest && !canApplyChangePreferencesDirectly) ||
      isInvalidRequestForOffer ||
      isHealthComplaintRequest ||
      isNonRussianCity ||
      !hasValidCity ||
      needsClarification;
    shouldSkipCache =
      isShowMoreRequest ||
      isChangeCityRequest ||
      isChangeDateRequest ||
      isExplicitAnyDate ||
      isChangePreferencesRequest ||
      isHealthComplaintRequest;

    const canReuseStoredOfferPool =
      isShowMoreRequest &&
      !slotsChanged &&
      !categoryChanged &&
      !isExplicitAnyBudget &&
      !isExplicitAnyDate &&
      !isChangeCityRequest &&
      !isChangeDateRequest &&
      !isChangePreferencesRequest &&
      !isHealthComplaintRequest &&
      !shouldSkipOfferGeneration &&
      hasValidCity &&
      allRequiredCollected;

    if (canReuseStoredOfferPool) {
      const latestOfferFromHistory =
        lastEventsFromHistory || (await getLastEventsFromHistory(userId, sessionId));
      lastEventsFromHistory = latestOfferFromHistory || lastEventsFromHistory;

      const latestOfferPoolRaw = Array.isArray(latestOfferFromHistory?.original)
        ? latestOfferFromHistory.original
        : [];
      // Пул в метаданных мог быть сохранён до появления негативных предпочтений — снова отсекаем дизлайки.
      const latestOfferPool = filterEventsByDislikedPreferences(
        latestOfferPoolRaw,
        userPreferences
      );
      const remainingStoredEvents = getRemainingEventsFromPool(
        latestOfferPool,
        shownEventsHistory,
        5
      );

      if (remainingStoredEvents.length > 0) {
        offerEvents = remainingStoredEvents;
        offerOriginalEvents = latestOfferPool;
        usedPreferencesForSearch = latestOfferFromHistory?.usedPreferences || false;
        popularSelectionUsedForSearch = latestOfferFromHistory?.popularSelectionUsed || false;
        await markQuickOfferSent(userId, sessionId);
        session.quickOfferSent = true;

        console.log(
          `🔁 [${userId}][${sessionId}] "Показать ещё": использую ${remainingStoredEvents.length} ` +
            `оставшихся событий из сохранённого пула (${latestOfferPool.length} всего), без повторного поиска`
        );
      } else if (latestOfferPool.length > 0) {
        console.log(
          `ℹ️ [${userId}][${sessionId}] В сохранённом пуле больше нет непоказанных событий. Перехожу к новому поиску.`
        );
      }
    }

    // Авто-уточнение: если пользователь после уже показанного предложения просит "романтическое",
    // форсируем новый поиск с keywordOverride="романтика", даже если значимые слоты не изменились.
    const romanticKeywords = ['романтич', 'романтика', 'для двоих', 'вдвоем', 'вдвоём', 'свидан'];
    const isRomanticRefineRequest =
      session?.quickOfferSent &&
      !isShowMoreRequest &&
      !isChangeCityRequest &&
      !isChangeDateRequest &&
      !isChangePreferencesRequest &&
      !isHealthComplaintRequest &&
      !needsClarification &&
      allRequiredCollected &&
      romanticKeywords.some((k) => normalizedUserMessage.includes(k));

    if (isRomanticRefineRequest) {
      keywordOverride = 'романтика';
    }

    if (shouldSkipOfferGeneration) {
      if (needsClarification) {
        console.log(
          `⏸️ [${userId}][${sessionId}] Пропускаю генерацию предложения - задаю уточняющие вопросы для расплывчатого запроса`
        );
      } else if (isHealthComplaintRequest) {
        console.log(
          `⏸️ [${userId}][${sessionId}] Пропускаю генерацию предложения - обнаружена жалоба на здоровье/эмоциональное состояние`
        );
      } else if (isChangePreferencesRequest) {
        console.log(
          `⏸️ [${userId}][${sessionId}] Пропускаю генерацию предложения - пользователь хочет изменить предпочтения`
        );
      } else if (isNonRussianCity) {
        console.log(
          `⏸️ [${userId}][${sessionId}] Пропускаю генерацию предложения - город не найден в базе: "${nonRussianCityName}"`
        );
      } else if (!hasValidCity) {
        console.log(
          `⏸️ [${userId}][${sessionId}] Пропускаю генерацию предложения - нет валидного города (пользователь выбрал "Другой город" или город не указан)`
        );
      } else if (isInvalidRequestForOffer) {
        console.log(
          `⏸️ [${userId}][${sessionId}] Пропускаю генерацию предложения - запрос невалиден (только город без поискового запроса)`
        );
      } else {
        console.log(
          `⏸️ [${userId}][${sessionId}] Пропускаю генерацию предложения - пользователь хочет изменить ${isChangeCityRequest ? 'город' : 'дату'}`
        );
      }
      offerEvents = null;
      noResultsDetected = false;
    } else if (Array.isArray(offerEvents) && offerEvents.length > 0) {
      console.log(
        `✅ [${userId}][${sessionId}] Использую ${offerEvents.length} оставшихся событий из предыдущего пула, новый поиск не нужен`
      );
    } else if (!shouldSkipOfferGeneration && keywordOverride && allRequiredCollected) {
      console.log(
        `💞 [${userId}][${sessionId}] Обнаружено уточнение "романтическое". Форсирую поиск с keywordOverride="${keywordOverride}"`
      );
      if (requestId) updateStatus(requestId, 'Ищем мероприятия...');

      if (!session.finalOfferSent) {
        const quickOffer = await generateQuickOffer({
          slots: effectiveSlots,
          fallbackQuery,
          history,
          userMessage,
          alreadyShownEvents: eventsToExclude,
          skipCache: shouldSkipCache,
          requestId,
          userPreferences,
          keywordOverride,
          allowPreferenceKeywordExpansion,
        });
        offerEvents = Array.isArray(quickOffer.events) ? quickOffer.events : [];
        offerOriginalEvents = Array.isArray(quickOffer.originalEvents)
          ? quickOffer.originalEvents
          : null;
        usedPreferencesForSearch = quickOffer.usedPreferences || false;
        popularSelectionUsedForSearch = quickOffer.popularSelectionUsed || false;
        if (!offerEvents || offerEvents.length === 0) {
          noResultsDetected = true;
        }
        console.log(
          `🎯 [${userId}][${sessionId}] Быстрое предложение с keywordOverride сгенерировано (${offerEvents?.length || 0} событий, usedPreferences: ${usedPreferencesForSearch})`
        );
      } else {
        const finalOffer = await generateFinalOffer({
          slots: effectiveSlots,
          fallbackQuery,
          history,
          userMessage,
          alreadyShownEvents: eventsToExclude,
          skipCache: shouldSkipCache,
          requestId,
          userPreferences,
          keywordOverride,
          allowPreferenceKeywordExpansion,
        });
        offerEvents = Array.isArray(finalOffer.events) ? finalOffer.events : [];
        offerOriginalEvents = Array.isArray(finalOffer.originalEvents)
          ? finalOffer.originalEvents
          : null;
        usedPreferencesForSearch = finalOffer.usedPreferences || false;
        popularSelectionUsedForSearch = finalOffer.popularSelectionUsed || false;
        if (!offerEvents || offerEvents.length === 0) {
          noResultsDetected = true;
        }
        console.log(
          `🎯 [${userId}][${sessionId}] Финальное предложение с keywordOverride сгенерировано (${offerEvents?.length || 0} событий, usedPreferences: ${usedPreferencesForSearch})`
        );
      }
    } else if (
      (!session.finalOfferSent &&
        allRequiredCollected &&
        !session.quickOfferSent &&
        !needsClarification) ||
      ((categoryChanged || isExplicitAnyBudget || isExplicitAnyDate) &&
        allRequiredCollected &&
        !needsClarification)
    ) {
      console.log(
        `✅ [${userId}][${sessionId}] Условие для быстрого предложения выполнено, генерирую...`
      );
      if (requestId) updateStatus(requestId, 'Ищем мероприятия...');
      const quickOffer = await generateQuickOffer({
        slots: effectiveSlots,
        fallbackQuery,
        history,
        userMessage,
        alreadyShownEvents: eventsToExclude,
        skipCache: shouldSkipCache,
        requestId,
        userPreferences,
        keywordOverride,
        allowPreferenceKeywordExpansion,
      });
      // Статус "Анализируем афиши..." теперь обновляется внутри generateQuickOffer
      offerEvents = Array.isArray(quickOffer.events) ? quickOffer.events : [];
      offerOriginalEvents = Array.isArray(quickOffer.originalEvents)
        ? quickOffer.originalEvents
        : null;
      usedPreferencesForSearch = quickOffer.usedPreferences || false;
      popularSelectionUsedForSearch = quickOffer.popularSelectionUsed || false;
      if (!offerEvents || offerEvents.length === 0) {
        noResultsDetected = true;
      }
      await markQuickOfferSent(userId, sessionId);
      console.log(
        `🎯 [${userId}][${sessionId}] Быстрое предложение сгенерировано (${offerEvents?.length || 0} событий, usedPreferences: ${usedPreferencesForSearch})`
      );
    } else if (
      !shouldSkipOfferGeneration &&
      (slotsChanged || categoryChanged || isExplicitAnyBudget || isExplicitAnyDate) &&
      session.quickOfferSent &&
      !session.finalOfferSent &&
      allRequiredCollected
    ) {
      console.log(
        `🔄 [${userId}][${sessionId}] Слоты изменились или категория изменилась, перегенерирую быстрое предложение...`
      );
      if (requestId) updateStatus(requestId, 'Ищем мероприятия...');
      const quickOffer = await generateQuickOffer({
        slots: effectiveSlots,
        fallbackQuery,
        history,
        userMessage,
        alreadyShownEvents: eventsToExclude,
        skipCache: shouldSkipCache,
        requestId,
        userPreferences,
        keywordOverride,
        allowPreferenceKeywordExpansion,
      });
      // Статус "Анализируем афиши..." теперь обновляется внутри generateQuickOffer
      offerEvents = Array.isArray(quickOffer.events) ? quickOffer.events : [];
      offerOriginalEvents = Array.isArray(quickOffer.originalEvents)
        ? quickOffer.originalEvents
        : null;
      usedPreferencesForSearch = quickOffer.usedPreferences || false;
      popularSelectionUsedForSearch = quickOffer.popularSelectionUsed || false;
      if (!offerEvents || offerEvents.length === 0) {
        noResultsDetected = true;
      }
      console.log(
        `🎯 [${userId}][${sessionId}] Быстрое предложение перегенерировано (${offerEvents?.length || 0} событий, usedPreferences: ${usedPreferencesForSearch})`
      );
    } else if (
      !shouldSkipOfferGeneration &&
      (slotsChanged || categoryChanged || isExplicitAnyBudget || isExplicitAnyDate) &&
      allRequiredCollected &&
      !offerEvents &&
      (!session.quickOfferSent || !session.finalOfferSent)
    ) {
      console.log(
        `🔄 [${userId}][${sessionId}] Слоты изменились или категория изменилась, все обязательные слоты собраны. Генерирую финальное предложение...`
      );
      if (requestId) updateStatus(requestId, 'Ищем мероприятия...');
      const finalOffer = await generateFinalOffer({
        slots: effectiveSlots,
        fallbackQuery,
        history,
        userMessage,
        alreadyShownEvents: eventsToExclude,
        skipCache: shouldSkipCache,
        requestId,
        userPreferences,
        keywordOverride,
        allowPreferenceKeywordExpansion,
      });
      // Статус "Анализируем афиши..." теперь обновляется внутри generateFinalOffer
      offerEvents = Array.isArray(finalOffer.events) ? finalOffer.events : [];
      offerOriginalEvents = Array.isArray(finalOffer.originalEvents)
        ? finalOffer.originalEvents
        : null;
      usedPreferencesForSearch = finalOffer.usedPreferences || false;
      popularSelectionUsedForSearch = finalOffer.popularSelectionUsed || false;
      if (!offerEvents || offerEvents.length === 0) {
        noResultsDetected = true;
      }
      await markFinalOfferSent(userId, sessionId);
      console.log(
        `🎯 [${userId}][${sessionId}] Финальное предложение сгенерировано после изменения слотов (${offerEvents?.length || 0} событий, usedPreferences: ${usedPreferencesForSearch})`
      );
    } else if (!shouldSkipOfferGeneration && !session.finalOfferSent && allSlotsCollected) {
      console.log(
        `✅ [${userId}][${sessionId}] Условие для финального предложения выполнено, генерирую...`
      );
      const finalOffer = await generateFinalOffer({
        slots: effectiveSlots,
        fallbackQuery,
        history,
        userMessage,
        alreadyShownEvents: eventsToExclude,
        skipCache: shouldSkipCache,
        userPreferences,
        keywordOverride,
        allowPreferenceKeywordExpansion,
      });
      offerEvents = Array.isArray(finalOffer.events) ? finalOffer.events : [];
      offerOriginalEvents = Array.isArray(finalOffer.originalEvents)
        ? finalOffer.originalEvents
        : null;
      usedPreferencesForSearch = finalOffer.usedPreferences || false;
      popularSelectionUsedForSearch = finalOffer.popularSelectionUsed || false;
      if (!offerEvents || offerEvents.length === 0) {
        noResultsDetected = true;
      }
      await markFinalOfferSent(userId, sessionId);
      console.log(
        `🎯 [${userId}][${sessionId}] Финальное предложение сгенерировано (${offerEvents?.length || 0} событий, usedPreferences: ${usedPreferencesForSearch})`
      );
    } else if (!shouldSkipOfferGeneration && allSlotsCollected && !offerEvents) {
      console.log(
        `🔄 [${userId}][${sessionId}] Все слоты собраны, но предложение не было сгенерировано. Генерирую финальное предложение...`
      );
      const finalOffer = await generateFinalOffer({
        slots: effectiveSlots,
        fallbackQuery,
        history,
        userMessage,
        alreadyShownEvents: eventsToExclude,
        skipCache: shouldSkipCache,
        userPreferences,
        keywordOverride,
        allowPreferenceKeywordExpansion,
      });
      offerEvents = Array.isArray(finalOffer.events) ? finalOffer.events : [];
      offerOriginalEvents = Array.isArray(finalOffer.originalEvents)
        ? finalOffer.originalEvents
        : null;
      usedPreferencesForSearch = finalOffer.usedPreferences || false;
      popularSelectionUsedForSearch = finalOffer.popularSelectionUsed || false;
      if (!offerEvents || offerEvents.length === 0) {
        noResultsDetected = true;
      }
      await markFinalOfferSent(userId, sessionId);
      console.log(
        `🎯 [${userId}][${sessionId}] Финальное предложение сгенерировано (${offerEvents?.length || 0} событий, usedPreferences: ${usedPreferencesForSearch})`
      );
    } else if (
      shouldRepeatOfferForSameRecommendationRequest({
        shouldSkipOfferGeneration,
        offerEvents,
        session,
        allRequiredCollected,
        wantsRecommendations,
        hasSpecificEventType,
        showAllRequested,
        isShowMoreRequest,
        isChangeCityRequest,
        isChangeDateRequest,
        isChangePreferencesRequest,
        isHealthComplaintRequest,
        isEventDetailsRequest,
        slotsChanged,
        categoryChanged,
        isExplicitAnyBudget,
        isExplicitAnyDate,
      })
    ) {
      console.log(
        `🔁 [${userId}][${sessionId}] Повторный явный запрос той же категории без новых фильтров. ` +
          `Не ухожу в generalDialogPrompt: повторяю актуальную подборку.`
      );

      const latestOfferFromHistory =
        lastEventsFromHistory || (await getLastEventsFromHistory(userId, sessionId));
      lastEventsFromHistory = latestOfferFromHistory || lastEventsFromHistory;

      if (
        latestOfferFromHistory &&
        Array.isArray(latestOfferFromHistory.normalized) &&
        latestOfferFromHistory.normalized.length > 0
      ) {
        offerEvents = latestOfferFromHistory.normalized.slice(0, 5);
        offerOriginalEvents = Array.isArray(latestOfferFromHistory.original)
          ? latestOfferFromHistory.original
          : null;
        usedPreferencesForSearch = latestOfferFromHistory.usedPreferences || false;
        popularSelectionUsedForSearch = latestOfferFromHistory.popularSelectionUsed || false;

        console.log(
          `✅ [${userId}][${sessionId}] Повторно использую ${offerEvents.length} событий из последней релевантной подборки`
        );
      } else {
        if (requestId) updateStatus(requestId, 'Ищем мероприятия...');
        const quickOffer = await generateQuickOffer({
          slots: effectiveSlots,
          fallbackQuery,
          history,
          userMessage,
          alreadyShownEvents: eventsToExclude,
          skipCache: shouldSkipCache,
          requestId,
          userPreferences,
          keywordOverride,
          allowPreferenceKeywordExpansion,
        });
        offerEvents = Array.isArray(quickOffer.events) ? quickOffer.events : [];
        offerOriginalEvents = Array.isArray(quickOffer.originalEvents)
          ? quickOffer.originalEvents
          : null;
        usedPreferencesForSearch = quickOffer.usedPreferences || false;
        popularSelectionUsedForSearch = quickOffer.popularSelectionUsed || false;
        if (!offerEvents || offerEvents.length === 0) {
          noResultsDetected = true;
        }

        console.log(
          `🎯 [${userId}][${sessionId}] История не помогла, поэтому заново сгенерировал подборку ` +
            `(${offerEvents?.length || 0} событий, usedPreferences: ${usedPreferencesForSearch})`
        );
      }
    } else {
      console.log(
        `❌ [${userId}][${sessionId}] Предложение НЕ будет сгенерировано (условия не выполнены)`
      );
    }

    // КРИТИЧЕСКИ ВАЖНО:
    // Если обязательные слоты собраны, но событий нет (предложение не было сгенерировано или пустое),
    // то promptBuilder может выбрать noResultsPrompt, но флаг noResultsDetected останется false.
    // Это приводит к противоречию: текст "ничего не найдено", но карточки подмешиваются из истории.
    // Поэтому синхронизируем флаг здесь.
    const hasNoEvents = Array.isArray(offerEvents) && offerEvents.length === 0;
    if (
      !noResultsDetected &&
      allRequiredCollected &&
      hasNoEvents &&
      !needsClarification &&
      !shouldSkipOfferGeneration
    ) {
      noResultsDetected = true;
    }
  } else {
    const historyEvents = await getLastEventsFromHistory(userId, sessionId);
    if (historyEvents?.normalized?.length) {
      const reference = eventDetailsIntent.eventReference || userMessage || null;
      const selectedEvent = pickEventFromReference(historyEvents.normalized, reference);
      if (selectedEvent) {
        try {
          await updateSessionSelectedEvent(userId, sessionId, selectedEvent);
        } catch (error) {
          console.warn(
            `⚠️ [${userId}][${sessionId}] Не удалось сохранить выбранное событие в сессию:`,
            error
          );
        }
      }

      eventDetailsContext = {
        events: historyEvents.normalized,
        originalEvents: historyEvents.original || null,
        reference: eventDetailsIntent.eventReference || null,
        selectedEvent: selectedEvent || null,
      };
    } else {
      console.warn(
        `⚠️ [${userId}][${sessionId}] Намерение детализации выявлено, но события в истории не найдены. Возвращаюсь к общему сценарию.`
      );
    }
  }

  // КРИТИЧЕСКИ ВАЖНО: Фильтруем события по бюджету ДО генерации ответа LLM,
  // чтобы noResultsDetected был установлен правильно, если после фильтрации все события удалены
  if (offerEvents && offerEvents.length > 0 && !isEventDetailsRequest) {
    const budgetSlot = effectiveSlots.find((s) => s.name === 'бюджет');
    const priceToSlot = effectiveSlots.find((s) => s.name === 'цена_до');
    const budget = parseBudgetSlotAmount(budgetSlot) ?? parseBudgetSlotAmount(priceToSlot);

    if (budget && budget > 0) {
      const beforeFilter = offerEvents.length;
      offerEvents = offerEvents.filter((event) => {
        // Если у события нет цены, оставляем его
        const toNum = (v) => {
          const digits = String(v ?? '').replace(/[^0-9]/g, '');
          const n = Number.parseInt(digits, 10);
          return Number.isFinite(n) && n > 0 ? n : null;
        };
        const rawMax = toNum(event?.priceMax);
        const eventPriceMin = toNum(event?.priceMin) ?? rawMax ?? 0;
        const eventPriceMax = rawMax ?? eventPriceMin;
        if (!eventPriceMin && !eventPriceMax) {
          return true;
        }

        if (eventPriceMin > budget) {
          console.log(
            `🚫 [${userId}][${sessionId}] ПРЕДВАРИТЕЛЬНАЯ ФИЛЬТРАЦИЯ: Исключаю событие "${event.title}" (цена от ${eventPriceMin} руб.) - превышает бюджет ${budget} руб.`
          );
          return false;
        }

        return true;
      });

      if (beforeFilter > offerEvents.length) {
        console.log(
          `✅ [${userId}][${sessionId}] ПРЕДВАРИТЕЛЬНАЯ ФИЛЬТРАЦИЯ: Отфильтровано ${beforeFilter - offerEvents.length} событий, превышающих бюджет ${budget} руб.`
        );
      }

      if (offerEvents.length === 0 && beforeFilter > 0) {
        console.log(
          `⚠️ [${userId}][${sessionId}] После предварительной фильтрации по бюджету все события удалены (было ${beforeFilter}, стало 0). Устанавливаю noResultsDetected = true.`
        );
        noResultsDetected = true;
      }
    }
  }

  // КРИТИЧЕСКИ ВАЖНО: Если пользователь уточнил бюджет, включаем ранее показанные события,
  // которые подходят под новый бюджет
  // Также обрабатываем явный выбор "Любой" бюджет, даже если слоты технически не изменились
  // const isExplicitAnyBudget уже определен выше

  // ВАЖНО: При выборе "Любой" бюджет (isExplicitAnyBudget) мы ВСЕГДА пытаемся найти НОВЫЕ события
  // и НЕ добавляем старые события, пока не убедимся, что новые не найдены.
  // Если новых событий нет (offerEvents пустой), только тогда используем старые (fallback).

  // ПРОВЕРКА: Если offerEvents пустой или null, это не значит, что поиск не выполнялся.
  // Но если мы здесь, значит offerEvents уже сформирован (или пуст).
  const canCheckPrevious =
    (offerEvents && offerEvents.length >= 0) ||
    (isExplicitAnyBudget && (!offerEvents || offerEvents.length === 0));

  ({ offerEvents, noResultsDetected } = await recoverPreviousOffer({
    canCheckPrevious,
    isEventDetailsRequest,
    slotsChanged,
    isExplicitAnyBudget,
    isExplicitAnyDate,
    effectiveSlots,
    session,
    dateSlotChanged,
    shownEventsHistory,
    userId,
    sessionId,
    offerEvents,
    userMessage,
    freshSearchDetected,
    noResultsDetected,
  }));

  return {
    kind: 'continue',
    context: {
      allRequiredCollected,
      allSlotsCollected,
      vagueCheck,
      needsClarification,
      shouldSkipOfferGeneration,
      offerEvents,
      offerOriginalEvents,
      usedPreferencesForSearch,
      popularSelectionUsedForSearch,
      noResultsDetected,
      eventDetailsContext,
    },
  };
}
