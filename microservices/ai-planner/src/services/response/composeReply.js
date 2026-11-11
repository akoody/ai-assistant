import { buildSystemPrompt } from '../llm/promptBuilder.js';
import { buildMessages } from '../llm/messageBuilder.js';
import {
  estimateOfferDeliveryMaxTokens,
  OFFER_DELIVERY_AI_GATEWAY_TIMEOUT_MS,
  requestAssistantMessage,
} from './gatewayClient.js';
import {
  isAiGatewayTimeoutError,
  buildOfferDeliveryTimeoutFallbackResponse,
  canUseOfferTextWithoutJsonRetry,
  collectAllowedNonCyrillicPhrases,
  containsUnsafeNonCyrillicOutsideAllowedPhrases,
  shouldRetryLanguageRepair,
  claimsNoResults,
  buildNoSearchClarificationResponse,
} from './responseQuality.js';
import { updateStatus } from '../statusService.js';
import { titleMatchesResponseText, selectEventsDescribedInResponse } from './offerText.js';
import {
  stripJsonArtifacts,
  containsChineseCharacters,
  removeChineseCharacters,
  removeGarbageText,
  containsNonCyrillic,
} from '../llm/assistantResponseUtils.js';
import { repairAssistantOffer } from './repairAssistantOffer.js';
import { asksForCityClarification, normalizeClarificationTextForMatch } from './textUtils.js';
import {
  buildKnownCityClarificationResponseViaLlm,
  shouldReplaceClarificationWithFallback,
  shouldGuardUngroundedClarificationResponse,
  buildClarificationActionResponse,
  MOOD_TYPE_CLARIFICATION_BUTTONS,
} from './clarification.js';
import { getKnownDateValue, getKnownEventTypeValue } from './slotUtils.js';

export async function composeReply({
  request: { userId, sessionId, userMessage, requestId },
  routing: {
    eventDetailsIntent,
    effectiveShowMoreIntent,
    healthComplaintIntent,
    recommendationsIntent,
    changeDateIntent,
    changePreferencesIntent,
    allowPreferenceKeywordExpansion,
    isEventDetailsRequest,
    session,
    isChangeCityRequest,
  },
  slots: {
    canApplyChangePreferencesDirectly,
    history,
    hasPreviouslyShownEvents,
    shownEventsHistory,
  },
  searchSlots: { effectiveSlots, requestType, userPreferences },
  searchContext: {
    isFirstMessage,
    isNonRussianCity,
    nonRussianCityName,
    hasSelectedOtherCity,
    hasValidCity,
    citySlot,
  },
  offers: {
    offerEvents,
    noResultsDetected,
    eventDetailsContext,
    needsClarification,
    vagueCheck,
    usedPreferencesForSearch,
    shouldSkipOfferGeneration,
  },
}) {
  const systemPrompt = await buildSystemPrompt({
    slots: effectiveSlots,
    requestType,
    offerEvents,
    userId,
    sessionId,
    noResultsDetected,
    userIntent: {
      eventDetailsRequest: eventDetailsIntent || null,
      showMoreResults: effectiveShowMoreIntent || null,
      healthComplaint: healthComplaintIntent || null,
      recommendationsRequest: recommendationsIntent || null,
      changeDateRequest: changeDateIntent || null,
      changePreferencesRequest: canApplyChangePreferencesDirectly
        ? null
        : changePreferencesIntent || null,
    },
    userMessage,
    eventDetailsContext,
    isFirstMessage,
    isNonRussianCity,
    nonRussianCityName,
    hasSelectedOtherCity,
    vagueRequestInfo: needsClarification ? vagueCheck : null,
    usedPreferencesForSearch,
    userPreferences,
    allowPreferenceMemoryHint: allowPreferenceKeywordExpansion || usedPreferencesForSearch,
  });

  if (eventDetailsContext?.events?.length) {
    console.log(
      `🧾 [${userId}][${sessionId}] Детальный контекст событий для LLM:`,
      JSON.stringify(eventDetailsContext.events.slice(0, 3), null, 2)
    );
  }

  // Формируем сообщения для LLM (с автоматическим сжатием истории при превышении лимита)
  const messages = buildMessages(systemPrompt, history, userMessage, userId, sessionId);

  // Если ожидаем строгое описание нескольких событий, повышаем лимит генерации,
  // иначе провайдер может обрезать ответ и мы будем чаще падать на fallback.
  const offerDeliveryMaxTokens =
    offerEvents && offerEvents.length > 0 && !eventDetailsIntent
      ? estimateOfferDeliveryMaxTokens(offerEvents.length)
      : null;
  const offerDeliveryTemperature =
    offerEvents && offerEvents.length > 0 && !eventDetailsIntent ? 0.8 : null;
  const offerDeliveryRequestOptions =
    offerEvents && offerEvents.length > 0 && !eventDetailsIntent
      ? {
          timeoutMs: OFFER_DELIVERY_AI_GATEWAY_TIMEOUT_MS,
          maxAttempts: 1,
        }
      : null;
  const clarificationTemperature = needsClarification ? 0.75 : null;
  const assistantTemperature = offerDeliveryTemperature ?? clarificationTemperature;
  const requestPlannerAssistantMessage = async (
    requestMessages,
    attemptLabel = 'основной',
    attemptNumber = 1,
    temperature = null,
    maxTokens = null
  ) => {
    try {
      return await requestAssistantMessage(
        requestMessages,
        userId,
        sessionId,
        attemptLabel,
        attemptNumber,
        temperature,
        requestId,
        maxTokens,
        offerDeliveryRequestOptions
      );
    } catch (error) {
      if (
        isAiGatewayTimeoutError(error) &&
        offerEvents &&
        offerEvents.length > 0 &&
        !eventDetailsIntent
      ) {
        return buildOfferDeliveryTimeoutFallbackResponse({
          offerEvents,
          hasPreviouslyShownEvents,
          timeoutMs: offerDeliveryRequestOptions?.timeoutMs,
          userId,
          sessionId,
        });
      }
      throw error;
    }
  };
  const isMoodClarificationTarget =
    needsClarification &&
    Array.isArray(vagueCheck?.missingDetails) &&
    vagueCheck.missingDetails.includes('настроение');
  if (requestId) updateStatus(requestId, 'Формируем ответ...');
  let assistantResponse = await requestPlannerAssistantMessage(
    messages,
    'основной',
    1,
    assistantTemperature,
    offerDeliveryMaxTokens
  );

  // КРИТИЧЕСКИ ВАЖНО: Если есть события, проверяем качество первого ответа ПЕРЕД запросом перегенерации
  // Если первый ответ описывает все события, используем его даже если не в JSON
  let shouldUseFirstResponse = false;
  if (
    offerEvents &&
    offerEvents.length > 0 &&
    assistantResponse.text &&
    !assistantResponse.parsedFromJson
  ) {
    const eventTitles = offerEvents.map((e) => (e.title || '').trim());
    const responseText = assistantResponse.text;

    // Подсчитываем количество описаний событий
    const numberedEventsPattern = /^\s*\d{1,2}[.)]\s+/gm;
    const numberedMatches = responseText.match(numberedEventsPattern);
    const numberedEventsCount = numberedMatches ? numberedMatches.length : 0;

    // Проверяем, какие события упоминаются
    const describedEvents = eventTitles.map((title) => {
      if (!title) return { title, found: false };
      return { title, found: titleMatchesResponseText(title, responseText) };
    });

    const foundEventsCount = describedEvents.filter((e) => e.found).length;
    const isAllDescribed =
      numberedEventsCount >= offerEvents.length && foundEventsCount >= offerEvents.length;

    if (isAllDescribed) {
      console.log(
        `✅ [${userId}][${sessionId}] Первый ответ описывает все ${offerEvents.length} событий. Использую его, даже если не в JSON формате.`
      );
      shouldUseFirstResponse = true;
      // Извлекаем текст из первого ответа, если он не в JSON
      assistantResponse.text = stripJsonArtifacts(assistantResponse.text) || assistantResponse.text;
    }
  }

  const canSkipJsonRetryForOffer = canUseOfferTextWithoutJsonRetry({
    offerEvents,
    assistantText: assistantResponse.text,
    isEventDetailsRequest,
  });

  if (!assistantResponse.parsedFromJson && !shouldUseFirstResponse) {
    if (canSkipJsonRetryForOffer) {
      console.warn(
        `⚠️ [${userId}][${sessionId}] Ответ не в JSON, но подборка уже готова. ` +
          `Использую первый текст, а карточки и кнопки дострою детерминированно без дорогой перегенерации.`
      );
    } else {
      console.warn(
        `⚠️ [${userId}][${sessionId}] Ответ не соответствует JSON-формату. Запрашиваю перегенерацию строго в JSON.`
      );

      if (requestId) updateStatus(requestId, 'Улучшаем ответ...');

      const retryMessages = messages.map((msg, index) => {
        if (index === 0 && msg.role === 'system') {
          return {
            ...msg,
            content: `‼️ Ответ должен быть строго JSON без текста вне объекта!

${msg.content}`,
          };
        }
        return msg;
      });

      assistantResponse = await requestPlannerAssistantMessage(
        retryMessages,
        'повторный (JSON)',
        1,
        assistantTemperature,
        offerDeliveryMaxTokens
      );

      if (!assistantResponse.parsedFromJson) {
        console.warn(
          `⚠️ [${userId}][${sessionId}] Повторный ответ всё ещё не является чистым JSON. JSON-блок будет удален.`
        );
        assistantResponse.text =
          stripJsonArtifacts(assistantResponse.text) || 'Извините, не удалось сформировать ответ.';
        assistantResponse.buttons = [];
      }
    }
  }

  const allowedNonCyrillicPhrases = collectAllowedNonCyrillicPhrases([
    ...(Array.isArray(offerEvents) ? offerEvents : []),
    ...(Array.isArray(shownEventsHistory) ? shownEventsHistory : []),
    ...(eventDetailsContext?.selectedEvent ? [eventDetailsContext.selectedEvent] : []),
    ...(session?.selectedEvent ? [session.selectedEvent] : []),
  ]);
  const responseHasNonCyrillic = containsUnsafeNonCyrillicOutsideAllowedPhrases(
    assistantResponse.text,
    allowedNonCyrillicPhrases
  );

  if (responseHasNonCyrillic) {
    const shouldRepairLanguage = shouldRetryLanguageRepair({
      responseHasNonCyrillic,
      offerEvents,
      assistantText: assistantResponse.text,
      isEventDetailsRequest,
    });

    if (!shouldRepairLanguage) {
      console.warn(
        `⚠️ [${userId}][${sessionId}] В тексте подборки есть некириллические фрагменты, ` +
          `но карточки уже собраны. Пропускаю дорогую языковую перегенерацию и применяю только защитную очистку.`
      );
      if (containsChineseCharacters(assistantResponse.text)) {
        assistantResponse.text = removeChineseCharacters(assistantResponse.text);
      }
    } else {
      console.warn(
        `⚠️ [${userId}][${sessionId}] Ответ содержит недопустимые символы (не кириллицу). Запрашиваю перегенерацию строго на русском.`
      );

      if (requestId) updateStatus(requestId, 'Улучшаем ответ...');

      const retryMessages = messages.map((msg, index) => {
        if (index === 0 && msg.role === 'system') {
          return {
            ...msg,
            content: `‼️ Ответ строго на русском языке! Без китайских, английских и других символов.
Каждое предложение должно быть законченным. Не возвращай обрывки вроде "Точную продолжительность мероприятия".
Если вопрос про длительность и точной длительности нет в данных, коротко скажи, что точная длительность не указана, и добавь примерный ориентир по типу события.\n\n${msg.content}`,
          };
        }
        return msg;
      });

      assistantResponse = await requestPlannerAssistantMessage(
        retryMessages,
        'повторный (строго русский)',
        1,
        assistantTemperature,
        offerDeliveryMaxTokens
      );

      if (!assistantResponse.parsedFromJson) {
        assistantResponse.text =
          stripJsonArtifacts(assistantResponse.text) || 'Извините, не удалось сформировать ответ.';
        assistantResponse.buttons = [];
      }

      const retryStillHasUnsafeNonCyrillic = containsUnsafeNonCyrillicOutsideAllowedPhrases(
        assistantResponse.text,
        allowedNonCyrillicPhrases
      );

      if (retryStillHasUnsafeNonCyrillic && containsChineseCharacters(assistantResponse.text)) {
        console.warn(
          `⚠️ [${userId}][${sessionId}] Повторный ответ всё ещё содержит недопустимые символы. Удаляю китайские символы и продолжаю защитную нормализацию.`
        );
        assistantResponse.text = removeChineseCharacters(assistantResponse.text);
      }
    }
  }

  // Удаляем мусорный текст (немецкий текст, случайные фразы и т.д.)
  if (assistantResponse.text) {
    const beforeClean = assistantResponse.text;
    assistantResponse.text = removeGarbageText(assistantResponse.text);
    if (beforeClean !== assistantResponse.text) {
      console.log(`🧹 [${userId}][${sessionId}] Удален мусорный текст из ответа`);
    }
  }

  // Удаляем "🎯 Предложение: undefined" из ответа, если LLM случайно добавила это
  assistantResponse.text = (assistantResponse.text || '')
    .replace(/🎯\s*Предложение:\s*undefined/gi, '')
    .replace(/🎯\s*Предложение:\s*$/gm, '')
    .trim();

  // Если мы на этапе уточнений (поиск ещё не запускался), но LLM заявила "ничего не найдено",
  // делаем один авто-retry с явным запретом на no-results и требованием задать вопрос с кнопками.
  if (needsClarification && assistantResponse.text && claimsNoResults(assistantResponse.text)) {
    console.warn(
      `⚠️ [${userId}][${sessionId}] LLM заявила "ничего не найдено" на этапе уточнений. Делаю авто-повтор с запретом на no-results.`
    );
    if (requestId) updateStatus(requestId, 'Уточняем детали...');

    const retryMessages = messages.map((msg, index) => {
      if (index === 0 && msg.role === 'system') {
        const prefix =
          `⚠️ В КОНТЕКСТЕ НЕТ РЕЗУЛЬТАТОВ ПОИСКА.\n` +
          `ЗАПРЕЩЕНО писать, что "ничего не найдено" или "не найдено".\n` +
          `Твоя задача: задать 1-2 уточняющих вопроса и вернуть кнопки.\n\n`;
        return { ...msg, content: prefix + msg.content };
      }
      return msg;
    });

    assistantResponse = await requestPlannerAssistantMessage(
      retryMessages,
      'повторный (уточнение вместо no-results)',
      1,
      assistantTemperature,
      null
    );

    if (containsNonCyrillic(assistantResponse.text)) {
      assistantResponse.text = removeChineseCharacters(assistantResponse.text);
    }

    if (assistantResponse.text) {
      assistantResponse.text = removeGarbageText(assistantResponse.text);
    }

    assistantResponse.text = (assistantResponse.text || '')
      .replace(/🎯\s*Предложение:\s*undefined/gi, '')
      .replace(/🎯\s*Предложение:\s*$/gm, '')
      .trim();
  }

  // Если город уже валиден, но LLM всё равно спрашивает "в каком городе",
  // делаем один авто-retry с жёстким запретом задавать вопрос про город.
  ({ assistantResponse } = await repairAssistantOffer({
    needsClarification,
    hasValidCity,
    assistantResponse,
    citySlot,
    userId,
    sessionId,
    requestId,
    messages,
    requestPlannerAssistantMessage,
    assistantTemperature,
    userMessage,
    effectiveSlots,
    vagueCheck,
    history,
    userPreferences,
    offerEvents,
    offerDeliveryTemperature,
    offerDeliveryMaxTokens,
    hasPreviouslyShownEvents,
  }));

  // Если город уже известен, но после всех ретраев ассистент все равно повторно спрашивает город,
  // принудительно заменяем ответ на безопасное уточнение по категории (без вопроса о городе).
  if (
    needsClarification &&
    hasValidCity &&
    !isChangeCityRequest &&
    assistantResponse.text &&
    asksForCityClarification(assistantResponse.text)
  ) {
    const knownCity = citySlot?.value ? String(citySlot.value).trim() : '';
    console.warn(
      `⚠️ [${userId}][${sessionId}] После ретраев ассистент снова спросил город при уже известном городе "${knownCity}". Формирую уточнение через LLM-guard.`
    );
    const safeClarification = await buildKnownCityClarificationResponseViaLlm({
      userId,
      sessionId,
      userMessage,
      requestId,
      knownCity,
      slots: effectiveSlots,
      vagueRequestInfo: vagueCheck,
      originalText: assistantResponse.text,
      originalButtons: assistantResponse.buttons,
      history,
      userPreferences,
    });
    assistantResponse.text = safeClarification.message;
    assistantResponse.buttons = safeClarification.buttons;
  }

  if (
    needsClarification &&
    hasValidCity &&
    !isChangeCityRequest &&
    assistantResponse.text &&
    shouldReplaceClarificationWithFallback(assistantResponse.text, history, {
      knownCity: citySlot?.value,
      knownDate: getKnownDateValue(effectiveSlots),
    })
  ) {
    const knownCity = citySlot?.value ? String(citySlot.value).trim() : '';
    console.log(
      `🔁 [${userId}][${sessionId}] Перегенерирую шаблонное уточнение через LLM-guard: "${assistantResponse.text}"`
    );
    const safeClarification = await buildKnownCityClarificationResponseViaLlm({
      userId,
      sessionId,
      userMessage,
      requestId,
      knownCity,
      slots: effectiveSlots,
      vagueRequestInfo: vagueCheck,
      originalText: assistantResponse.text,
      originalButtons: assistantResponse.buttons,
      history,
      userPreferences,
    });
    assistantResponse.text = safeClarification.message;
    assistantResponse.buttons = safeClarification.buttons;
  }

  const clarificationGuard = shouldGuardUngroundedClarificationResponse({
    needsClarification,
    offerEvents,
    text: assistantResponse.text,
    buttons: assistantResponse.buttons,
    slots: effectiveSlots,
    vagueRequestInfo: vagueCheck,
    userPreferences,
    seed: `${userId}|${sessionId}|${userMessage}|clarification_guard`,
  });

  if (clarificationGuard.shouldGuard) {
    console.warn(
      `⚠️ [${userId}][${sessionId}] Уточняющий ответ LLM не прошёл grounding-check (${clarificationGuard.reason}). ` +
        `Заменяю его на безопасное уточнение.`
    );

    if (hasValidCity && !isChangeCityRequest) {
      const knownCity = citySlot?.value ? String(citySlot.value).trim() : '';
      const safeClarification = await buildKnownCityClarificationResponseViaLlm({
        userId,
        sessionId,
        userMessage,
        requestId,
        knownCity,
        slots: effectiveSlots,
        vagueRequestInfo: vagueCheck,
        targetHint: clarificationGuard.plan?.target || '',
        originalText: assistantResponse.text,
        originalButtons: assistantResponse.buttons,
        history,
        userPreferences,
      });
      assistantResponse.text = safeClarification.message;
      assistantResponse.buttons = safeClarification.buttons;
    } else {
      const safeClarification = buildClarificationActionResponse({
        target: clarificationGuard.plan?.target || '',
        knownEventType:
          clarificationGuard.plan?.knownEventType || getKnownEventTypeValue(effectiveSlots),
        userPreferences,
        slots: effectiveSlots,
      });
      assistantResponse.text = safeClarification.message;
      assistantResponse.buttons = safeClarification.buttons;
    }
  }

  // Если это уточнение настроения — гарантируем mood-кнопки независимо от того что вернул LLM
  if (isMoodClarificationTarget && needsClarification) {
    const currentButtons = Array.isArray(assistantResponse.buttons)
      ? assistantResponse.buttons
      : [];
    const hasMoodButtons = currentButtons.some((btn) =>
      MOOD_TYPE_CLARIFICATION_BUTTONS.some(
        (mb) => normalizeClarificationTextForMatch(btn) === normalizeClarificationTextForMatch(mb)
      )
    );
    if (!hasMoodButtons) {
      assistantResponse.buttons = [...MOOD_TYPE_CLARIFICATION_BUTTONS];
      console.log(
        `🎭 [${userId}][${sessionId}] Подставляю кнопки настроения к LLM-ответу: ${assistantResponse.buttons.join(', ')}`
      );
    }
  }

  const searchWasNotRun = shouldSkipOfferGeneration || offerEvents == null;
  if (
    !noResultsDetected &&
    searchWasNotRun &&
    assistantResponse.text &&
    claimsNoResults(assistantResponse.text)
  ) {
    const safeClarification = await buildNoSearchClarificationResponse({
      slots: effectiveSlots,
      hasValidCity,
      userPreferences,
      vagueRequestInfo: vagueCheck,
      userId,
      sessionId,
      userMessage,
    });

    console.warn(
      `⚠️ [${userId}][${sessionId}] LLM заявила "ничего не найдено", хотя поиск не запускался. ` +
        `Заменяю ответ на безопасное уточнение.`
    );

    assistantResponse.text = safeClarification.message;
    assistantResponse.buttons = safeClarification.buttons;
  }

  // КРИТИЧЕСКИ ВАЖНО: Определяем, какие события описаны в тексте, чтобы отправить только их
  // Это гарантирует, что количество событий в карточках совпадает с количеством описанных событий
  let describedEventsList = null;
  if (offerEvents && offerEvents.length > 0 && assistantResponse.text && !isEventDetailsRequest) {
    describedEventsList = selectEventsDescribedInResponse(assistantResponse.text, offerEvents, {
      userId,
      sessionId,
    });
  }

  if (!assistantResponse.parsedFromJson) {
    console.warn(
      `⚠️ [${userId}][${sessionId}] Ответ так и не удалось получить в формате JSON. Возвращаю текст без кнопок.`
    );
    const rawFallback =
      typeof assistantResponse.raw === 'string' ? assistantResponse.raw.trim() : '';
    const cleanedFallback = stripJsonArtifacts(rawFallback) || rawFallback;
    const cleanedText = stripJsonArtifacts(assistantResponse.text) || assistantResponse.text || '';
    assistantResponse.text = (
      cleanedText ||
      cleanedFallback ||
      'Извините, не удалось сформировать ответ.'
    ).trim();
    assistantResponse.buttons = [];
  }

  return { kind: 'continue', context: { assistantResponse, describedEventsList } };
}
