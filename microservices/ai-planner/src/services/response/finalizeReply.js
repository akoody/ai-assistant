import {
  shouldRecoverFullOfferAfterPartialLlmList,
  titleMatchesResponseText,
  pickEventFromReference,
  rebuildOfferTextWithRecovery,
  getOfferFallbackIntro,
  buildStrictOfferTextFromEvents,
  isEventDurationQuestionText,
  hasFreePriceMismatch,
  buildSafeEventDetailsText,
  getEventDurationMinutes,
  dedupeLoopedOfferText,
} from './offerText.js';
import {
  hasCategoryButtons,
  ensureCompleteCategoryButtons,
  ensureShowAllButton,
  dedupeQuickReplyButtons,
  ensureCategoryButtonsCta,
} from '../quickButtonsService.js';
import {
  looksLikeFollowUpClarificationResponse,
  canOfferMoodGenreClarification,
  filterButtonsForSeniorFriendlyContext,
  buildOfferClarificationButtons,
  buildOfferClarificationText,
  looksLikeOfferTextWithoutCards,
  buildCardlessOfferFallbackResponse,
} from './clarification.js';
import { getLastEventsFromHistory } from './conversationHistory.js';
import {
  buildDeterministicNoResultsResponse,
  claimsNoResults,
  hasBinaryYesNoButtons,
  hasLowQualityRussianPhrasing,
  buildLanguageQualityFallbackResponse,
} from './responseQuality.js';
import { getKnownCityValue, getKnownEventTypeValue } from './slotUtils.js';
import { isRussianCity, normalizeCityButton } from '../offerService.js';
import { buildOffTopicRedirectResponseViaLlm, buildOffTopicRedirectResponse } from './redirects.js';
import { synchronizeOfferCards } from './synchronizeOfferCards.js';
import {
  improveTextFormatting,
  stripDuplicatedButtonLabels,
} from '../llm/assistantResponseUtils.js';
import { normalizeAssistantButtonLabel } from './buttonLabels.js';
import {
  sanitizeHealthComplaintButtons,
  looksLikeAngryMoodOutletRequest,
  buildAngryMoodCategoryClarificationResponse,
} from './moodHealth.js';
import { getCurrentSessionSlots } from '../slotsService.js';

export async function finalizeReply({
  request: { userId, sessionId, userMessage, requestId },
  routing: {
    isEventDetailsRequest,
    isEventDislikeRequest,
    session,
    isShowMoreRequest,
    isChangePreferencesRequest,
    isChangeDateRequest,
    isChangeCityRequest,
    isClarificationRequest,
    isHealthComplaintRequest,
    offTopicIntent,
    healthComplaintIntent,
  },
  slots: { hasPreviouslyShownEvents },
  searchSlots: { slotsChanged, categoryChanged, effectiveSlots, userPreferences },
  searchContext: { hasValidCity, isInvalidRequestForOffer, citySlot },
  offers: {
    offerEvents,
    noResultsDetected,
    allRequiredCollected,
    eventDetailsContext,
    allSlotsCollected,
    popularSelectionUsedForSearch,
    needsClarification,
    vagueCheck,
    usedPreferencesForSearch,
    offerOriginalEvents,
  },
  reply: { describedEventsList, assistantResponse },
}) {
  let eventsToUse = describedEventsList !== null ? describedEventsList : offerEvents;
  let eventsForResponse = null;
  let offerType = 'quick';

  // Проверяем, не отказался ли LLM помочь в тексте ответа
  // Это важно, чтобы не было противоречия между текстом "не могу помочь" и карточками событий
  // УЛУЧШЕНО: проверяем не только фразы отказа, но и позитивные индикаторы наличия событий
  const responseText = (assistantResponse.text || '').toLowerCase().trim();
  const refusalPhrases = [
    'не могу помочь',
    'не могу помочь с этим',
    'не могу помочь с этим запросом',
    'не могу помочь с запросом',
    'не могу помочь вам',
    'не могу помочь с вашим запросом',
    'не могу помочь с подобным',
    'не могу помочь с такими',
    'не могу помочь в этом',
    'не могу помочь в данном',
    'не могу помочь в подобном',
    'не могу предоставить',
    'не могу предоставить информацию',
    'не могу предоставить помощь',
    'не могу найти информацию',
    'не могу найти данные',
    'не могу найти события',
    'не могу найти мероприятия',
    'не могу найти информацию о мероприятиях',
    'нет информации о мероприятиях',
    'нет информации в базе данных',
    'нет информации в наших базах данных',
    'в наших базах данных нет информации',
    'в базе данных нет информации',
    'простите, но не могу помочь',
    'извините, но не могу помочь',
    'к сожалению, не могу помочь',
    'это не совсем моя тема',
    'это не по моей части',
    'это не совсем по моей части',
    'с таким вопросом я не подскажу',
    'тут я не подскажу',
    'я не лучший помощник',
    'я специализируюсь на мероприятиях',
    'могу помочь только с мероприятиями',
    'могу помочь только с билетами',
    'по таким вопросам я не консультирую',
    'по таким вопросам не консультирую',
  ];

  // Позитивные индикаторы того, что LLM все-таки предоставляет события
  // Если они есть, то даже при наличии фраз отказа, события должны быть отправлены
  const positiveIndicators = [
    /^\d+\.\s+["«]/, // Начинается с нумерации и кавычек (1. "Событие")
    /^\d+\.\s+[а-яё]/, // Начинается с нумерации и русской буквы (1. Событие)
    /\d+\.\s+["«][^"»]+["»]/, // Нумерация с кавычками в тексте
    'вот несколько',
    'вот что я нашел',
    'вот подходящие',
    'нашел для вас',
    'подобрал для вас',
    'предлагаю следующие',
    'рекомендую следующие',
    'дата и время:', // Признак описания события
    'место проведения:', // Признак описания события
    'цена: от', // Признак описания события
  ];

  // Проверяем наличие фраз отказа
  const hasRefusal = refusalPhrases.some((phrase) => {
    const phraseLower = phrase.toLowerCase();
    return responseText.includes(phraseLower);
  });

  // Проверяем наличие позитивных индикаторов
  const hasPositiveIndicators = positiveIndicators.some((indicator) => {
    if (typeof indicator === 'string') {
      return responseText.includes(indicator.toLowerCase());
    } else if (indicator instanceof RegExp) {
      return indicator.test(assistantResponse.text || ''); // Используем оригинальный текст для regex
    }
    return false;
  });

  // Также проверяем, есть ли в тексте нумерация событий (1., 2., 3. и т.д.)
  const hasNumberedEvents = /\d+\.\s+["«]?[^"»\n]+["»]?/.test(assistantResponse.text || '');

  if (
    shouldRecoverFullOfferAfterPartialLlmList({
      offerEvents,
      describedEventsList,
      assistantButtons: assistantResponse.buttons,
      assistantText: assistantResponse.text,
    }) &&
    !noResultsDetected
  ) {
    console.warn(
      `⚠️ [${userId}][${sessionId}] LLM описала только ${describedEventsList.length} из ${offerEvents.length} ` +
        `событий и не вернула кнопки. Считаю ответ оборванным и восстанавливаю полную подборку из найденных событий.`
    );
    describedEventsList = offerEvents;
    eventsToUse = offerEvents;
  }

  // КРИТИЧЕСКИ ВАЖНО: Проверяем, описывает ли LLM реальные события из eventsToUse
  // Это самая надежная проверка - если LLM описывает реальные события, их нужно отправить
  let hasRealEventsDescribed = false;
  if (eventsToUse && eventsToUse.length > 0 && assistantResponse.text) {
    const eventTitles = eventsToUse.map((e) => (e.title || '').trim()).filter((t) => t.length > 0);

    // Проверяем, упоминаются ли реальные названия событий в тексте
    const foundRealEvents = eventTitles.filter((title) => {
      return titleMatchesResponseText(title, assistantResponse.text || '');
    });

    // Если найдено хотя бы одно реальное событие, считаем что LLM описывает реальные события
    hasRealEventsDescribed = foundRealEvents.length > 0;

    if (hasRealEventsDescribed) {
      console.log(
        `✅ [${userId}][${sessionId}] Обнаружены реальные события в тексте ответа: ${foundRealEvents.length} из ${eventTitles.length}`
      );
    }
  }

  const hasCategoryRestartButtons = hasCategoryButtons(
    Array.isArray(assistantResponse.buttons) ? assistantResponse.buttons : []
  );
  const isFollowUpClarificationResponse = looksLikeFollowUpClarificationResponse(
    assistantResponse.text,
    assistantResponse.buttons
  );
  const looksLikeCategoryRestartText =
    /что\s+вам\s+интересно\s+в\s+городе/u.test(responseText) ||
    /в\s+каком\s+городе\s+будем\s+искать/u.test(responseText) ||
    /могу\s+помочь\s+с\s+подбором\s+мероприятий\s+и\s+билетов/u.test(responseText);
  const shouldRecoverOfferAfterLlmDrift =
    Array.isArray(offerEvents) &&
    offerEvents.length > 0 &&
    !noResultsDetected &&
    !isEventDetailsRequest &&
    hasRefusal &&
    hasCategoryRestartButtons &&
    looksLikeCategoryRestartText &&
    !hasPositiveIndicators &&
    !hasNumberedEvents &&
    !hasRealEventsDescribed;

  if (shouldRecoverOfferAfterLlmDrift) {
    console.warn(
      `⚠️ [${userId}][${sessionId}] LLM вернул рестарт диалога вместо описания уже найденных событий. ` +
        `Перехватываю ответ и восстанавливаю подборку из offerEvents.`
    );
    assistantResponse.buttons = [];
  }

  // Если есть позитивные индикаторы, нумерация событий ИЛИ реальные события описаны,
  // то даже при наличии фраз отказа, события должны быть отправлены (LLM все-таки предоставил события)
  // ВАЖНО: Блокируем события только если есть события для блокировки (eventsToUse не пустой)
  const shouldBlockEvents =
    hasRefusal &&
    !shouldRecoverOfferAfterLlmDrift &&
    !hasPositiveIndicators &&
    !hasNumberedEvents &&
    !hasRealEventsDescribed &&
    eventsToUse &&
    eventsToUse.length > 0;

  // 🔁 Если предложение уже отправлялось ранее, слоты не изменились, но новые события не сгенерированы
  // (например, повторный вопрос без намерения "показать больше"), пытаемся переиспользовать последние карточки из истории,
  // чтобы не возвращать пустой результат.
  // Исключение: пользователь выразил нелюбовь к конкретному событию — в этом случае
  // НЕ повторяем старые карточки, т.к. LLM уже дал правильный текст-подтверждение.
  if (
    (!eventsForResponse || eventsForResponse.length === 0) &&
    !isEventDislikeRequest &&
    session?.quickOfferSent &&
    !session?.finalOfferSent &&
    !slotsChanged &&
    !categoryChanged &&
    !isShowMoreRequest &&
    !isEventDetailsRequest &&
    !isChangePreferencesRequest &&
    !isChangeDateRequest &&
    !isChangeCityRequest &&
    !isClarificationRequest &&
    !isFollowUpClarificationResponse &&
    hasValidCity &&
    allRequiredCollected &&
    !hasRefusal &&
    !noResultsDetected
  ) {
    const lastEvents = await getLastEventsFromHistory(userId, sessionId);
    if (lastEvents && Array.isArray(lastEvents.normalized) && lastEvents.normalized.length > 0) {
      console.log(
        `🔁 [${userId}][${sessionId}] Повторяю ранее показанные ${lastEvents.normalized.length} событий из истории, т.к. новые не сгенерированы`
      );
      eventsForResponse = lastEvents.normalized.slice(0, 5);
      // Если текста нет или он не описывает события, строим простой повторный текст
      if (!assistantResponse.text || assistantResponse.text.trim().length === 0) {
        const titles = eventsForResponse
          .map((e, i) => `${i + 1}. ${e.title || 'Событие'}`)
          .join('\n');
        assistantResponse.text = [
          'Повторяю ранее подобранные варианты:',
          '',
          titles,
          '',
          'Если нужны другие варианты, уточните бюджет или время.',
        ].join('\n');
      }
    }
  }

  if (noResultsDetected) {
    const deterministicNoResults = buildDeterministicNoResultsResponse({
      slots: effectiveSlots,
      hasValidCity,
      userPreferences,
    });
    const shouldOverrideNoResultsResponse =
      !claimsNoResults(assistantResponse.text) || hasBinaryYesNoButtons(assistantResponse.buttons);

    if (shouldOverrideNoResultsResponse) {
      assistantResponse.text = deterministicNoResults.message;

      console.warn(
        `⚠️ [${userId}][${sessionId}] LLM вернул противоречивый no-results ответ. ` +
          `Заменяю его детерминированным fallback без ложных "Да/Нет".`
      );
    }

    assistantResponse.buttons = deterministicNoResults.buttons;
  }

  // Если использовался промпт noResultsPrompt, события НЕ отправляем
  if (noResultsDetected) {
    console.log(
      `⚠️ [${userId}][${sessionId}] Использован промпт noResultsPrompt - события НЕ будут отправлены, чтобы избежать противоречия`
    );
    eventsForResponse = null;
  } else if (shouldBlockEvents) {
    // Если LLM явно отказался помочь И нет позитивных индикаторов наличия событий, события НЕ отправляем
    console.log(
      `⚠️ [${userId}][${sessionId}] LLM отказался помочь в тексте ответа (нет позитивных индикаторов, нумерации и реальных событий) - события НЕ будут отправлены, чтобы избежать противоречия`
    );
    eventsForResponse = null;

    // Чтобы ответ не звучал шаблонно ("Это не совсем моя тема"), перегенерируем
    // короткий живой редирект к афише через специализированный off-topic prompt.
    const canRewriteRefusalToRedirect =
      hasRefusal && !noResultsDetected && !isEventDetailsRequest && !isHealthComplaintRequest;

    if (canRewriteRefusalToRedirect) {
      try {
        const knownCity = getKnownCityValue(effectiveSlots);
        const normalizedCityForRedirect =
          typeof knownCity === 'string' && knownCity.trim().length > 0 ? knownCity.trim() : null;
        const hasValidCityForRedirect = Boolean(
          normalizedCityForRedirect && isRussianCity(normalizedCityForRedirect)
        );

        const redirectResponse = await buildOffTopicRedirectResponseViaLlm({
          userId,
          sessionId,
          userMessage,
          requestId,
          normalizedCity: normalizedCityForRedirect,
          hasValidCity: hasValidCityForRedirect,
        });

        if (redirectResponse?.message) {
          assistantResponse.text = String(redirectResponse.message).trim();
          if (Array.isArray(redirectResponse.buttons) && redirectResponse.buttons.length > 0) {
            assistantResponse.buttons = redirectResponse.buttons;
          }
          console.log(
            `✅ [${userId}][${sessionId}] Refusal-текст переписан через offTopicRedirect для более живого ответа`
          );
        }
      } catch (redirectError) {
        console.warn(
          `⚠️ [${userId}][${sessionId}] Не удалось перегенерировать refusal-текст через offTopicRedirect`,
          redirectError
        );
      }
    }
  } else if (hasRefusal && (hasPositiveIndicators || hasNumberedEvents || hasRealEventsDescribed)) {
    // Если есть фразы отказа, но также есть позитивные индикаторы или реальные события описаны,
    // логируем предупреждение, но события отправляем
    const indicators = [];
    if (hasPositiveIndicators) indicators.push('позитивные индикаторы');
    if (hasNumberedEvents) indicators.push('нумерация событий');
    if (hasRealEventsDescribed) indicators.push('реальные события описаны');
    console.log(
      `⚠️ [${userId}][${sessionId}] Обнаружены фразы отказа, но также есть: ${indicators.join(', ')} - события БУДУТ отправлены`
    );
  } else if (isInvalidRequestForOffer && eventsToUse && eventsToUse.length > 0) {
    // Если запрос был невалиден для генерации предложений (только город без поискового запроса),
    // но события все равно были сгенерированы (например, из кеша или предыдущих слотов),
    // не отправляем их, чтобы избежать противоречия
    console.log(
      `⚠️ [${userId}][${sessionId}] Запрос невалиден для генерации предложений - события НЕ будут отправлены, чтобы избежать противоречия`
    );
    eventsForResponse = null;
  } else if (
    isEventDetailsRequest &&
    eventDetailsContext &&
    Array.isArray(eventDetailsContext.events) &&
    eventDetailsContext.events.length > 0
  ) {
    // При запросе деталей конкретного события отправляем ОДНУ карточку выбранного события.
    // Это нужно для сценария покупки: карточка кликабельна и ведёт на страницу Kassir.
    const selectedEvent =
      eventDetailsContext?.selectedEvent ||
      pickEventFromReference(
        eventDetailsContext.events,
        eventDetailsContext.reference || userMessage
      );

    eventsForResponse = selectedEvent ? [selectedEvent] : null;
    offerType = 'details';
    console.log(
      `📋 [${userId}][${sessionId}] Детальный запрос о событии - ${selectedEvent ? 'отправляю карточку выбранного события' : 'не удалось определить выбранное событие, карточка не будет отправлена'}`
    );
  } else if (!isEventDetailsRequest && Array.isArray(eventsToUse) && eventsToUse.length > 0) {
    // Обычный сценарий: используем сгенерированные события
    // КРИТИЧЕСКИ ВАЖНО: Проверяем, описал ли LLM события в тексте
    // Если события не описаны (нет нумерации и нет реальных событий), не отправляем их,
    // чтобы избежать противоречия между текстом "не понял" и карточками событий
    // КРИТИЧЕСКИ ВАЖНО: Используем только те события, которые описаны в тексте (describedEventsList),
    // чтобы количество карточек совпадало с количеством описанных событий
    if (!hasRealEventsDescribed) {
      // LLM не описал реальные события в тексте - не отправляем карточки, чтобы избежать противоречия
      console.log(
        `⚠️ [${userId}][${sessionId}] LLM не описал реальные события в тексте ответа - события НЕ будут отправлены, чтобы избежать противоречия`
      );
      eventsForResponse = null;
    } else {
      // LLM описал события - отправляем только те, которые описаны в тексте
      // КРИТИЧЕСКИ ВАЖНО: Ограничиваем максимум 5 событиями, даже если describedEventsList содержит больше
      const MAX_EVENTS_TO_SEND = 5;
      eventsForResponse = eventsToUse.slice(0, MAX_EVENTS_TO_SEND);
      offerType = session.finalOfferSent || allSlotsCollected ? 'final' : 'quick';
      if (eventsToUse.length > MAX_EVENTS_TO_SEND) {
        console.log(
          `✅ [${userId}][${sessionId}] Ограничил количество событий до ${MAX_EVENTS_TO_SEND} (из ${eventsToUse.length} описанных)`
        );
      }
      if (describedEventsList !== null && describedEventsList.length < (offerEvents?.length || 0)) {
        console.log(
          `✅ [${userId}][${sessionId}] Отправляю только ${eventsForResponse.length} описанных событий (из ${offerEvents?.length || 0} сгенерированных), чтобы избежать несоответствия с текстом`
        );
      }
    }
  }

  // ПРИМЕЧАНИЕ: Фильтрация по бюджету уже выполнена в предварительной фильтрации (строки 1281-1318)
  // и в offerService.js (filterEventsByBudget). Дополнительная финальная фильтрация не нужна,
  // т.к. она может удалить события после того, как LLM уже сгенерировала ответ с событиями,
  // что приведет к противоречию между текстом и карточками.

  // 🔧 Fallback: если события найдены, но из-за качества ответа LLM карточки не собираются,
  // используем безопасный текст и отправляем карточки, чтобы пользователь не оставался без результатов.
  const canUseEventsFallback =
    shouldRecoverOfferAfterLlmDrift ||
    (!hasRefusal && !offTopicIntent && !isHealthComplaintRequest && !isChangePreferencesRequest);

  if (
    (!eventsForResponse || eventsForResponse.length === 0) &&
    Array.isArray(offerEvents) &&
    offerEvents.length > 0 &&
    !noResultsDetected &&
    !isEventDetailsRequest &&
    canUseEventsFallback
  ) {
    console.warn(
      `⚠️ [${userId}][${sessionId}] События получены (${offerEvents.length}), но не попали в ответ из-за формата LLM. Использую fallback и всё равно отправляю карточки.`
    );

    // Берем описанные события, если они есть, иначе используем полное предложение
    // КРИТИЧЕСКИ ВАЖНО: Всегда ограничиваем максимум 5 событиями
    const MAX_EVENTS_TO_SEND = 5;
    const fallbackEvents =
      describedEventsList && describedEventsList.length > 0
        ? describedEventsList.slice(0, MAX_EVENTS_TO_SEND)
        : offerEvents.slice(0, MAX_EVENTS_TO_SEND);

    eventsForResponse = fallbackEvents;
    offerType = session.finalOfferSent || allSlotsCollected ? 'final' : 'quick';
    assistantResponse.text = rebuildOfferTextWithRecovery({
      primaryText: shouldRecoverOfferAfterLlmDrift ? '' : assistantResponse.text,
      retryText: '',
      events: fallbackEvents,
      fallbackIntro: getOfferFallbackIntro(fallbackEvents, { hasPreviouslyShownEvents }),
      ensureOutro: true,
    });
    console.log(
      `✅ [${userId}][${sessionId}] Fallback: отправляю ${fallbackEvents.length} событий (ограничено до ${MAX_EVENTS_TO_SEND})`
    );
  }

  if (
    (!eventsForResponse || eventsForResponse.length === 0) &&
    Array.isArray(offerEvents) &&
    offerEvents.length > 0 &&
    !noResultsDetected &&
    !isEventDetailsRequest &&
    !canUseEventsFallback
  ) {
    console.log(
      `ℹ️ [${userId}][${sessionId}] Fallback карточек отключен (refusal/off_topic/special-flow) — события не отправляю, чтобы избежать противоречия`
    );
  }

  if (eventsForResponse && eventsForResponse.length > 0) {
    console.log(
      `📋 [${userId}][${sessionId}] События для отправки клиенту (первые 3):`,
      eventsForResponse.slice(0, 3).map((e) => ({
        id: e.id,
        title: e.title,
        date: e.date,
        venue: e.venue,
        priceMin: e.priceMin,
        priceMax: e.priceMax,
      }))
    );
  }

  ({ assistantResponse, eventsForResponse } = await synchronizeOfferCards({
    assistantResponse,
    eventsForResponse,
    isEventDetailsRequest,
    userId,
    sessionId,
    hasPreviouslyShownEvents,
    popularSelectionUsedForSearch,
    effectiveSlots,
  }));

  if (
    assistantResponse.text &&
    Array.isArray(eventsForResponse) &&
    eventsForResponse.length > 0 &&
    offerType !== 'details'
  ) {
    assistantResponse.text = buildStrictOfferTextFromEvents(
      assistantResponse.text,
      eventsForResponse,
      {
        fallbackIntro: getOfferFallbackIntro(eventsForResponse, {
          hasPreviouslyShownEvents,
          popularSelectionUsed: popularSelectionUsedForSearch,
          cityName: getKnownCityValue(effectiveSlots),
        }),
        hasKnownEventType: Boolean(getKnownEventTypeValue(effectiveSlots)),
      }
    );
  }

  if (
    offerType === 'details' &&
    Array.isArray(eventsForResponse) &&
    eventsForResponse.length === 1
  ) {
    const selectedEvent = eventsForResponse[0];
    const selectedTitle = String(selectedEvent?.title || '').trim();
    const isDurationDetailsQuestion = isEventDurationQuestionText(userMessage);
    const hasConsistentDetailsText =
      assistantResponse.text &&
      (isDurationDetailsQuestion ||
        !selectedTitle ||
        titleMatchesResponseText(selectedTitle, assistantResponse.text));
    const hasPriceMismatch = hasFreePriceMismatch(assistantResponse.text, selectedEvent);

    if (!hasConsistentDetailsText || hasPriceMismatch) {
      console.warn(
        `⚠️ [${userId}][${sessionId}] Текст деталей не совпал с карточкой события по содержанию` +
          `${hasPriceMismatch ? ' (цена)' : ''}. ` +
          `Пересобираю ответ из данных события.`
      );
      assistantResponse.text = buildSafeEventDetailsText(selectedEvent, userMessage);
    }
  }

  // КРИТИЧЕСКИ ВАЖНО: Улучшаем форматирование финального текста ответа
  // Это должно быть последним шагом перед формированием результата
  // чтобы гарантировать правильные переносы строк между событиями
  let finalText = assistantResponse.text || '';
  if (finalText) {
    finalText = improveTextFormatting(finalText);
  }

  if (hasLowQualityRussianPhrasing(finalText)) {
    console.warn(
      `⚠️ [${userId}][${sessionId}] Финальный текст не прошёл общий language-quality guard. ` +
        `Заменяю его безопасным fallback по сценарию.`
    );

    const normalizedCityForLanguageFallback = (() => {
      const cityValue = getKnownCityValue(effectiveSlots);
      const normalizedValue = String(cityValue || '').trim();
      return normalizedValue || null;
    })();
    const hasValidCityForLanguageFallback = Boolean(
      normalizedCityForLanguageFallback && isRussianCity(normalizedCityForLanguageFallback)
    );

    const languageFallback = await buildLanguageQualityFallbackResponse({
      userId,
      sessionId,
      userMessage,
      normalizedCity: normalizedCityForLanguageFallback,
      hasValidCity: hasValidCityForLanguageFallback,
      noResultsDetected,
      slots: effectiveSlots,
      userPreferences,
      needsClarification,
      vagueRequestInfo: vagueCheck,
      eventsForResponse,
      offerType,
      hasPreviouslyShownEvents,
      offTopicIntent,
    });

    finalText = improveTextFormatting(languageFallback.message || finalText);
    if (Array.isArray(languageFallback.buttons)) {
      assistantResponse.buttons = languageFallback.buttons;
    }
  }

  // Нормализуем кнопки: переводим английские названия городов в русские
  let normalizedButtons = Array.isArray(assistantResponse.buttons) ? assistantResponse.buttons : [];

  // Если категория не задана, не позволяем LLM выводить кнопки уточнения жанра
  if (!getKnownEventTypeValue(effectiveSlots) && !canOfferMoodGenreClarification(effectiveSlots)) {
    normalizedButtons = normalizedButtons.filter(
      (button) => !String(button).toLowerCase().includes('жанр')
    );
  }
  normalizedButtons = normalizedButtons.map((button) => {
    if (typeof button === 'string') {
      return normalizeCityButton(normalizeAssistantButtonLabel(button));
    }
    return button;
  });
  normalizedButtons = filterButtonsForSeniorFriendlyContext(normalizedButtons, effectiveSlots);

  if (healthComplaintIntent && (!eventsForResponse || eventsForResponse.length === 0)) {
    normalizedButtons = sanitizeHealthComplaintButtons(normalizedButtons, userMessage);
  } else {
    normalizedButtons = ensureCompleteCategoryButtons(normalizedButtons);
    normalizedButtons = ensureShowAllButton(normalizedButtons);
  }

  const isUnknownDurationDetailsResponse =
    offerType === 'details' &&
    Array.isArray(eventsForResponse) &&
    eventsForResponse.length === 1 &&
    isEventDurationQuestionText(userMessage) &&
    !getEventDurationMinutes(eventsForResponse[0]);

  if (isUnknownDurationDetailsResponse) {
    normalizedButtons = ['Уточнить бюджет', 'Уточнить время'];
  }

  // Фильтруем кнопки: убираем те, что содержат китайские или другие иероглифы (галлюцинации ллм)
  normalizedButtons = normalizedButtons.filter((button) => {
    if (typeof button !== 'string') return false;
    // Китайские, японские, корейские символы и прочие нелатинские иероглифы
    if (/[\u3400-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF\u4E00-\u9FFF]/u.test(button)) {
      console.warn(`⚠️ [${userId}][${sessionId}] Отфильтрована кнопка с иероглифами: "${button}"`);
      return false;
    }
    return true;
  });

  if (
    needsClarification &&
    (!eventsForResponse || eventsForResponse.length === 0) &&
    !getKnownEventTypeValue(effectiveSlots) &&
    looksLikeAngryMoodOutletRequest(userMessage)
  ) {
    const angryClarification = buildAngryMoodCategoryClarificationResponse();
    finalText = angryClarification.message;
    normalizedButtons = angryClarification.buttons;
  }

  // ВАЖНО: Если есть события, но нет кнопок, добавляем кнопки для уточнения
  // Это помогает пользователю уточнить параметры для получения большего количества вариантов
  if (
    eventsForResponse &&
    eventsForResponse.length > 0 &&
    (!normalizedButtons || normalizedButtons.length === 0)
  ) {
    console.log(
      `🔘 [${userId}][${sessionId}] События есть, но кнопок нет. Добавляю кнопки для уточнения.`
    );

    // Получаем текущие слоты, чтобы понять, что нужно уточнить
    const currentSlotsForButtons = await getCurrentSessionSlots(userId, sessionId);

    const clarificationButtons = buildOfferClarificationButtons(currentSlotsForButtons);

    // Если есть хотя бы одна кнопка для уточнения, добавляем их
    if (clarificationButtons.length > 0) {
      normalizedButtons = clarificationButtons;
      console.log(
        `✅ [${userId}][${sessionId}] Добавлены кнопки для уточнения: ${clarificationButtons.join(', ')}`
      );

      // Добавляем текст с уточнением в конец сообщения, если его еще нет
      const clarificationText = buildOfferClarificationText(clarificationButtons);
      if (
        !finalText.toLowerCase().includes('уточните') &&
        !finalText.toLowerCase().includes('уточнить')
      ) {
        // Добавляем текст уточнения в конец сообщения
        finalText = finalText.trim();
        if (!finalText.endsWith('.') && !finalText.endsWith('!') && !finalText.endsWith('?')) {
          finalText += '.';
        }
        // Важно: отделяем уточнение от последнего события пустой строкой,
        // иначе оно склеивается с последней строкой "Цена:" и выглядит как ошибка форматирования.
        finalText += '\n\n' + clarificationText;
        console.log(`📝 [${userId}][${sessionId}] Добавлен текст уточнения в сообщение.`);
      }
    }
  }

  if (usedPreferencesForSearch && eventsForResponse && eventsForResponse.length > 0) {
    console.log(
      `🧠 [${userId}][${sessionId}] Были использованы предпочтения при поиске, добавляю информацию об этом`
    );

    const preferencesText = 'На основе ваших предпочтений:\n\n';
    finalText = preferencesText + finalText;

    const changeGenreButton = 'Выбрать другой жанр';
    if (!normalizedButtons.includes(changeGenreButton)) {
      normalizedButtons.push(changeGenreButton);
      console.log(`✅ [${userId}][${sessionId}] Добавлена кнопка "${changeGenreButton}"`);
    }
  }

  if (eventsForResponse && eventsForResponse.length > 0 && offerType !== 'details') {
    const showMoreButton = 'Показать другие варианты';
    if (!normalizedButtons.includes(showMoreButton)) {
      normalizedButtons.unshift(showMoreButton);
      console.log(`✅ [${userId}][${sessionId}] Добавлена кнопка "${showMoreButton}"`);
    }
  }

  if (
    (!eventsForResponse || eventsForResponse.length === 0) &&
    looksLikeOfferTextWithoutCards(finalText)
  ) {
    console.warn(
      `⚠️ [${userId}][${sessionId}] Обнаружен текст подборки без карточек. ` +
        `Блокирую такой ответ и заменяю его на безопасное уточнение.`
    );
    const knownCityForGuard = getKnownCityValue(effectiveSlots);
    const guardedFallback = offTopicIntent
      ? buildOffTopicRedirectResponse({
          normalizedCity: knownCityForGuard,
          hasValidCity: Boolean(knownCityForGuard && isRussianCity(knownCityForGuard)),
          seed: `${userId}|${sessionId}|${userMessage}|cardless-offer-guard`,
          userMessage,
        })
      : buildCardlessOfferFallbackResponse({
          slots: effectiveSlots,
          hasValidCity,
          cityName: citySlot?.value ? String(citySlot.value).trim() : '',
        });
    finalText = guardedFallback.message;
    normalizedButtons = guardedFallback.buttons;
  }

  normalizedButtons = dedupeQuickReplyButtons(normalizedButtons);
  finalText = stripDuplicatedButtonLabels(finalText, normalizedButtons);
  finalText = ensureCategoryButtonsCta(finalText, normalizedButtons);
  finalText = dedupeLoopedOfferText(finalText);

  const result = {
    message: finalText,
    buttons: normalizedButtons,
    offer:
      eventsForResponse && eventsForResponse.length > 0
        ? {
            events: eventsForResponse,
            type: offerType,
            originalEvents:
              Array.isArray(offerOriginalEvents) && offerOriginalEvents.length > 0
                ? offerOriginalEvents
                : eventsForResponse,
            usedPreferences: usedPreferencesForSearch,
            popularSelectionUsed: popularSelectionUsedForSearch,
          }
        : null,
  };

  console.log(`💬 [${userId}][${sessionId}] Финальный результат:`);
  console.log(
    `   - Предложение сгенерировано: ${!!eventsForResponse && eventsForResponse.length > 0}`
  );
  console.log(`   - Количество событий: ${eventsForResponse?.length || 0}`);
  console.log(`   - Offer в результате: ${result.offer ? 'да' : 'нет'}`);
  if (result.offer && result.offer.events) {
    console.log(`   - События будут отправлены клиенту: ${result.offer.events.length} шт.`);
  }

  return { kind: 'reply', response: result };
}
