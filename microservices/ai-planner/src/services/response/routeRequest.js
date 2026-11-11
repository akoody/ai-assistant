import {
  isMaybeLaterReplyText,
  buildMaybeLaterResponse,
  shouldPreferRecommendationsOverHealthComplaint,
} from './moodHealth.js';
import { updateStatus } from '../statusService.js';
import {
  pickShowMoreIntent,
  pickBuyTicketIntent,
  pickEventDetailsIntent,
  pickChangeCityIntent,
  pickChangeDateIntent,
  pickChangePreferencesIntent,
  pickPreferenceMemoryReferenceIntent,
  pickHealthComplaintIntent,
  pickPositiveFeedbackIntent,
  pickNegativeEventFeedbackIntent,
  pickRecommendationComplaintIntent,
  pickAssistantCriticismIntent,
  pickRecommendationsIntent,
  pickSmalltalkIntent,
} from '../llm/intentUtils.js';
import {
  isAssistantDirectedCriticism,
  resolveAssistantCriticismProfile,
} from '../provocationService.js';
import { hasNegativeFeedback, hasPositiveFeedback } from '../feedbackService.js';
import {
  pickOffTopicIntent,
  TECHNICAL_META_INTENT_NAME,
  TECHNICAL_META_CONFIDENCE_THRESHOLD,
  extractSlashCommand,
  buildAssistantIdentityResponseViaLlm,
  buildTechnicalRedirectResponseViaLlm,
  shouldIgnoreOffTopicForTrustedUiAction,
} from './redirects.js';
import { getLastEventsFromHistory, getLastAssistantButtons } from './conversationHistory.js';
import { getCurrentSessionSlots } from '../slotsService.js';
import {
  shouldTreatAsContextualPositiveFeedback,
  extractNegativeEventFeedbackDetails,
  dedupeEventTitlesPreservingCase,
  isPreferenceMemoryConfirmationQuestion,
  shouldPreferPreferenceMemoryMetaRouting,
  isRememberedBudgetQuestion,
  buildRememberedBudgetReply,
  buildPreferenceMemoryConfirmationResponseViaLlm,
} from './preferenceFeedback.js';
import { findMentionedEvent, findMentionedEvents } from '../eventMentionMatching.js';
import {
  looksLikeAssistantCatalogNavigationMessage,
  buildSoftClosureReplyResponse,
} from './responseQuality.js';
import { detectPreferenceMemoryRequest } from '../preferenceMemoryService.js';
import { getOrCreateSession, updateOffTopicContextResetPending } from '../sessionService.js';
import { getUserPreferences } from '../userPreferencesService.js';
import { respondToEventDislike } from './replies/respondToEventDislike.js';
import {
  isQuickCategoryButtonText,
  matchesAnyButtonText,
  inferClarificationActionFromText,
  inferClarificationActionFromButtons,
  inferUiSlotFromButtons,
} from '../quickButtonsService.js';
import { isStandaloneCityReply } from './dialogReplies.js';
import { normalizeText } from './textUtils.js';
import { OFF_TOPIC_INTENT_NAME, isAuthoritativeOffTopicIntent } from './intentPolicy.js';
import { looksLikeUnknownArtistDiscoveryText } from '../../../../../shared/vagueArtistUtils.js';
import { looksLikeShowMoreRequestText } from '../llm/showMoreHeuristics.js';
import { isAssistantIdentityQuestion } from '../assistantIdentityService.js';
import { isTechnicalMetaQuestion } from '../technicalQuestionService.js';
import { isBuyTicketsCommand } from './offerText.js';
import {
  resolveExplicitAnySelection,
  resolveLocalCategoryForRouting,
  resolveAmbiguousGenreCategoryChoice,
} from './categoryRouting.js';
import { inferClarificationTarget } from './clarificationTarget.js';
import {
  resolveClarificationTargetFromSessionContext,
  extractHeuristicDateHintFromText,
  shouldIgnoreRecoveredUiSlotForOffTopic,
} from './clarification.js';
import { enrichSlotWithDate } from '../dateParsingUtils.js';
import { respondToClarificationAction } from './replies/respondToClarificationAction.js';
import { detectCategoryFromText } from './categoryDefinitions.js';
import { hasExplicitSeniorCompanionInText } from './searchReset.js';
import { getKnownCityValue } from './slotUtils.js';
import { respondToAmbiguousGenre } from './replies/respondToAmbiguousGenre.js';
import { respondToMoodWithoutCity } from './replies/respondToMoodWithoutCity.js';
import { respondToBuyTicketsCommand } from './replies/respondToBuyTicketsCommand.js';
import { respondToOffTopicGate } from './replies/respondToOffTopicGate.js';
import { respondToAssistantCriticism } from './replies/respondToAssistantCriticism.js';
import { respondToActiveComplaintFlow } from './replies/respondToActiveComplaintFlow.js';
import { respondToPositiveFeedback } from './replies/respondToPositiveFeedback.js';
import { respondToOffTopicCandidate } from './replies/respondToOffTopicCandidate.js';
import { respondToSmalltalk } from './replies/respondToSmalltalk.js';

export async function routeRequest({
  request: { userMessage, requestId, slotExtractionResult, userId, sessionId },
}) {
  if (isMaybeLaterReplyText(userMessage)) {
    if (requestId) updateStatus(requestId, 'Формируем ответ...');
    return { kind: 'reply', response: await buildMaybeLaterResponse() };
  }

  const detectedIntents = Array.isArray(slotExtractionResult?.intents)
    ? slotExtractionResult.intents
    : [];
  const showMoreIntent = pickShowMoreIntent(detectedIntents);
  const buyTicketIntent = pickBuyTicketIntent(detectedIntents);
  let lastEventsFromHistory = null;
  if (showMoreIntent) {
    console.log(
      `🔁 [${userId}][${sessionId}] Обнаружено намерение показать больше вариантов`,
      showMoreIntent
    );
  }
  if (buyTicketIntent) {
    console.log(
      `🎫 [${userId}][${sessionId}] Обнаружено намерение покупки билета`,
      buyTicketIntent
    );
  }

  const eventDetailsIntentCandidate =
    showMoreIntent || buyTicketIntent ? null : pickEventDetailsIntent(detectedIntents);
  let eventDetailsIntent = eventDetailsIntentCandidate || null;

  const changeCityIntent = pickChangeCityIntent(detectedIntents);
  const changeDateIntent = pickChangeDateIntent(detectedIntents);
  const changePreferencesIntent = pickChangePreferencesIntent(detectedIntents);
  const preferenceMemoryReferenceIntent = pickPreferenceMemoryReferenceIntent(detectedIntents);
  const rawHealthComplaintIntent = pickHealthComplaintIntent(detectedIntents);
  const positiveFeedbackIntent = pickPositiveFeedbackIntent(detectedIntents);
  const negativeEventFeedbackIntent = pickNegativeEventFeedbackIntent(detectedIntents);
  let recommendationComplaintIntent = pickRecommendationComplaintIntent(detectedIntents);
  let assistantCriticismIntent = pickAssistantCriticismIntent(detectedIntents);
  const extractedSlotsForIntentRouting = Array.isArray(slotExtractionResult?.slots)
    ? slotExtractionResult.slots
    : [];
  const hasAuthoritativeIntentAgainstHeuristicAssistantCriticism = detectedIntents.some(
    (intent) => {
      if (!intent || typeof intent !== 'object') {
        return false;
      }

      const source = String(intent.source || '')
        .trim()
        .toLowerCase();
      const intentName = String(intent.name || '').trim();
      if (!source || !intentName) {
        return false;
      }

      if (source !== 'llm' && source !== 'model') {
        return false;
      }

      if (
        intentName === 'off_topic' ||
        intentName === 'smalltalk' ||
        intentName === 'assistant_criticism'
      ) {
        return false;
      }

      return typeof intent.confidence !== 'number' || intent.confidence >= 0.7;
    }
  );
  const hasMeaningfulExtractedSlotsForIntentRouting = extractedSlotsForIntentRouting.some(
    (slot) =>
      slot &&
      typeof slot === 'object' &&
      String(slot.name || '').trim() !== '' &&
      slot.name !== 'город' &&
      String(slot.value || '').trim() !== ''
  );
  const assistantDirectedCriticism = isAssistantDirectedCriticism(userMessage);

  if (
    assistantCriticismIntent &&
    String(assistantCriticismIntent.source || '')
      .trim()
      .toLowerCase() === 'heuristic' &&
    (hasAuthoritativeIntentAgainstHeuristicAssistantCriticism ||
      hasMeaningfulExtractedSlotsForIntentRouting)
  ) {
    console.log(
      `🧭 [${userId}][${sessionId}] Игнорирую heuristic assistant_criticism: LLM уже распознала осмысленный запрос`,
      {
        assistantCriticismIntent,
        hasAuthoritativeIntentAgainstHeuristicAssistantCriticism,
        hasMeaningfulExtractedSlotsForIntentRouting,
      }
    );
    assistantCriticismIntent = null;
  }

  if (
    !assistantCriticismIntent &&
    assistantDirectedCriticism &&
    !hasAuthoritativeIntentAgainstHeuristicAssistantCriticism &&
    !hasMeaningfulExtractedSlotsForIntentRouting
  ) {
    assistantCriticismIntent = {
      name: 'assistant_criticism',
      confidence: 1,
      trigger: userMessage,
      source: 'heuristic',
    };
  }

  if (assistantCriticismIntent && recommendationComplaintIntent) {
    console.log(
      `🧭 [${userId}][${sessionId}] Критика ассистента имеет приоритет над жалобой на подбор, игнорирую recommendation_complaint`,
      {
        assistantCriticismIntent,
        recommendationComplaintIntent,
      }
    );
    recommendationComplaintIntent = null;
  }
  let recommendationsIntent = pickRecommendationsIntent(detectedIntents);
  const messageHasNegativeFeedback =
    Boolean(negativeEventFeedbackIntent) || hasNegativeFeedback(userMessage);
  const healthComplaintIntent = shouldPreferRecommendationsOverHealthComplaint({
    userMessage,
    healthComplaintIntent: rawHealthComplaintIntent,
    recommendationsIntent,
  })
    ? null
    : rawHealthComplaintIntent;
  const smalltalkIntent = pickSmalltalkIntent(detectedIntents);
  const rawOffTopicIntent =
    !healthComplaintIntent &&
    !negativeEventFeedbackIntent &&
    !recommendationComplaintIntent &&
    !assistantCriticismIntent
      ? pickOffTopicIntent(detectedIntents)
      : null;
  const positiveFeedbackSlot = Array.isArray(slotExtractionResult?.slots)
    ? slotExtractionResult.slots.find((s) => s && s.name === 'positive_feedback')
    : null;
  const hasStructuredPositiveFeedbackSignal =
    !messageHasNegativeFeedback && Boolean(positiveFeedbackIntent || positiveFeedbackSlot);
  let hasPositiveFeedbackSignal = hasStructuredPositiveFeedbackSignal;
  const hasRecognizedIntent = detectedIntents.some(
    (intent) => intent && typeof intent.name === 'string'
  );

  if (
    !hasPositiveFeedbackSignal &&
    !messageHasNegativeFeedback &&
    hasPositiveFeedback(userMessage)
  ) {
    if (!lastEventsFromHistory) {
      lastEventsFromHistory = await getLastEventsFromHistory(userId, sessionId);
    }

    const currentSessionSlotsForFeedback = await getCurrentSessionSlots(userId, sessionId);
    const hasRecentOfferContext = Boolean(lastEventsFromHistory?.normalized?.length);

    hasPositiveFeedbackSignal = shouldTreatAsContextualPositiveFeedback({
      userMessage,
      hasPositiveFeedbackIntent: Boolean(positiveFeedbackIntent),
      hasPositiveFeedbackSlot: Boolean(positiveFeedbackSlot),
      hasRecognizedIntent,
      hasRecentOfferContext,
      sessionSlots: currentSessionSlotsForFeedback,
    });

    if (hasPositiveFeedbackSignal) {
      console.log(
        `💚 [${userId}][${sessionId}] FALLBACK: общий positive feedback привязан к текущему контексту`,
        {
          hasRecentOfferContext,
          sessionContextSlots: currentSessionSlotsForFeedback
            .filter((slot) => slot && slot.name !== 'город')
            .map((slot) => `${slot.name}="${slot.value}"`),
        }
      );
    }
  }

  let offTopicIntent = hasPositiveFeedbackSignal ? null : rawOffTopicIntent;

  // BUY_TICKET: Обрабатываем запрос на покупку билета, если интент был извлечён AI Slots эвристикой
  if (buyTicketIntent && userMessage) {
    const historyEvents = await getLastEventsFromHistory(userId, sessionId);
    lastEventsFromHistory = historyEvents;
    if (historyEvents && historyEvents.normalized && historyEvents.normalized.length > 0) {
      const mentionedEvent = findMentionedEvent(
        historyEvents.normalized,
        userMessage,
        slotExtractionResult
      );
      const singleEventFallback =
        !looksLikeAssistantCatalogNavigationMessage(userMessage) &&
        historyEvents.normalized.length === 1
          ? historyEvents.normalized[0]
          : null;
      const targetEvent = mentionedEvent || singleEventFallback;

      if (targetEvent) {
        eventDetailsIntent = {
          name: 'event_details_request',
          confidence: 1.0,
          eventReference: targetEvent.title,
          evidence: userMessage,
          source: 'buy_ticket_flow',
          isBuyTicketAction: true,
        };
      }
    }
  }

  // FALLBACK: Если AI не распознал event_details_request, но пользователь упоминает название события из истории,
  // принудительно активируем этот интент.
  // НО: если в сообщении есть явный негативный сентимент ("не нравится", "не хочу" и т.п.) —
  // пользователь отказывается от события, а не просит детали. В этом случае fallback НЕ активируем.
  let isEventDislikeRequest = Boolean(negativeEventFeedbackIntent);
  const negativeFeedbackDetails = extractNegativeEventFeedbackDetails(negativeEventFeedbackIntent);
  let dislikedEventTitles = dedupeEventTitlesPreservingCase([
    ...(Array.isArray(negativeFeedbackDetails?.eventNames)
      ? negativeFeedbackDetails.eventNames
      : []),
    negativeFeedbackDetails?.eventName || '',
  ]);
  const fallbackMessageHasNegativeSentiment = messageHasNegativeFeedback;

  if (
    !eventDetailsIntent &&
    !showMoreIntent &&
    !healthComplaintIntent &&
    !buyTicketIntent &&
    userMessage
  ) {
    if (!lastEventsFromHistory) {
      lastEventsFromHistory = await getLastEventsFromHistory(userId, sessionId);
    }
    if (
      lastEventsFromHistory &&
      lastEventsFromHistory.normalized &&
      lastEventsFromHistory.normalized.length > 0
    ) {
      // Проверяем, упоминает ли пользователь название какого-либо события
      const mentionedEvents = looksLikeAssistantCatalogNavigationMessage(userMessage)
        ? []
        : findMentionedEvents(lastEventsFromHistory.normalized, userMessage, slotExtractionResult);
      const mentionedEvent = mentionedEvents[0] || null;

      if (mentionedEvent) {
        if (fallbackMessageHasNegativeSentiment) {
          console.log(
            `🚫 [${userId}][${sessionId}] FALLBACK: Обнаружены упоминания событий "${mentionedEvents.map((event) => event.title).join(', ')}", ` +
              `но сообщение содержит негативный сентимент — НЕ активирую event_details_request`
          );
          isEventDislikeRequest = true;
          dislikedEventTitles = dedupeEventTitlesPreservingCase([
            ...dislikedEventTitles,
            ...mentionedEvents.map((event) => event.title).filter(Boolean),
          ]);
        } else {
          console.log(
            `🎯 [${userId}][${sessionId}] FALLBACK: Обнаружено упоминание события "${mentionedEvent.title}" - активирую event_details_request`
          );
          eventDetailsIntent = {
            name: 'event_details_request',
            confidence: 0.85,
            eventReference: mentionedEvent.title,
            evidence: userMessage,
            source: 'fallback',
          };
        }
      }
    }
  }

  if (eventDetailsIntent && !eventDetailsIntent.eventReference) {
    if (!lastEventsFromHistory) {
      lastEventsFromHistory = await getLastEventsFromHistory(userId, sessionId);
    }
    if (
      lastEventsFromHistory &&
      lastEventsFromHistory.normalized &&
      lastEventsFromHistory.normalized.length > 0
    ) {
      const mentionedEvent = findMentionedEvent(
        lastEventsFromHistory.normalized,
        userMessage,
        slotExtractionResult
      );
      const lastShownEvent =
        !looksLikeAssistantCatalogNavigationMessage(userMessage) &&
        lastEventsFromHistory.normalized.length === 1
          ? lastEventsFromHistory.normalized[0]
          : null;
      const targetEvent = mentionedEvent || lastShownEvent;

      if (targetEvent) {
        eventDetailsIntent.eventReference = targetEvent.title;
        eventDetailsIntent.evidence = eventDetailsIntent.evidence || userMessage;
        console.log(
          `🎯 [${userId}][${sessionId}] Follow-up вопрос привязан к событию "${targetEvent.title}" (source: ${eventDetailsIntent.source || 'unknown'})`
        );
      } else {
        console.log(
          `ℹ️ [${userId}][${sessionId}] Follow-up вопрос без привязки к конкретному событию, ` +
            `в истории ${lastEventsFromHistory.normalized.length} событий — используем общий контекст`
        );
      }
    }
  }

  if (eventDetailsIntent) {
    console.log(
      `🧭 [${userId}][${sessionId}] Обнаружено намерение детальной информации об событии`,
      eventDetailsIntent
    );
  } else if (eventDetailsIntentCandidate) {
    console.log(
      `ℹ️ [${userId}][${sessionId}] Намерение детальной информации отклонено из-за низкой уверенности`,
      eventDetailsIntentCandidate
    );
  }

  if (changeCityIntent) {
    console.log(
      `🏙️ [${userId}][${sessionId}] Обнаружено намерение изменить город`,
      changeCityIntent
    );
  }

  if (changeDateIntent) {
    console.log(
      `📅 [${userId}][${sessionId}] Обнаружено намерение изменить дату`,
      changeDateIntent
    );
  }

  if (changePreferencesIntent) {
    console.log(
      `⚙️ [${userId}][${sessionId}] Обнаружено намерение изменить предпочтения`,
      changePreferencesIntent
    );
  }

  if (healthComplaintIntent) {
    console.log(
      `🏥 [${userId}][${sessionId}] Обнаружена жалоба на здоровье/эмоциональное состояние`,
      healthComplaintIntent
    );
  }

  if (recommendationComplaintIntent) {
    console.log(
      `🧾 [${userId}][${sessionId}] Обнаружена жалоба на прошлую выдачу/подбор`,
      recommendationComplaintIntent
    );
  }

  if (assistantCriticismIntent) {
    console.log(
      `🛡️ [${userId}][${sessionId}] Обнаружена критика/атака в адрес ассистента`,
      assistantCriticismIntent
    );
  }

  const assistantCriticismProfile = assistantCriticismIntent
    ? resolveAssistantCriticismProfile(assistantCriticismIntent, userMessage)
    : null;
  const heuristicPreferenceMemoryRequest = detectPreferenceMemoryRequest(userMessage);
  const preferenceMemoryRequest = preferenceMemoryReferenceIntent
    ? {
        wantsAnyPreferenceMemory: true,
        wantsGeneralPreferenceMemory:
          preferenceMemoryReferenceIntent.memoryType === 'general' ||
          preferenceMemoryReferenceIntent.memoryType === 'taste' ||
          preferenceMemoryReferenceIntent.memoryType === 'genre' ||
          !preferenceMemoryReferenceIntent.memoryType,
        wantsTasteMemory:
          preferenceMemoryReferenceIntent.memoryType === 'general' ||
          preferenceMemoryReferenceIntent.memoryType === 'taste' ||
          preferenceMemoryReferenceIntent.memoryType === 'genre' ||
          !preferenceMemoryReferenceIntent.memoryType,
        wantsGenreMemory:
          preferenceMemoryReferenceIntent.memoryType === 'genre' ||
          preferenceMemoryReferenceIntent.memoryType === 'taste' ||
          !preferenceMemoryReferenceIntent.memoryType,
        wantsBudgetMemory: preferenceMemoryReferenceIntent.memoryType === 'budget',
      }
    : heuristicPreferenceMemoryRequest;
  const isPreferenceMemoryConfirmation = isPreferenceMemoryConfirmationQuestion(
    userMessage,
    preferenceMemoryReferenceIntent
  );
  const shouldPreferMemoryMetaRouting = shouldPreferPreferenceMemoryMetaRouting(
    userMessage,
    preferenceMemoryReferenceIntent,
    recommendationsIntent
  );
  let userPreferences = null;

  // Обрабатываем позитивный фидбек асинхронно (не блокируем основной поток)
  // Важно: сигнал может прийти как intent ИЛИ как slot (в слотах часто есть eventDetails).
  const positiveFeedbackOutcome = await respondToPositiveFeedback({
    hasPositiveFeedbackSignal,
    positiveFeedbackIntent,
    positiveFeedbackSlot,
    requestId,
    sessionId,
    slotExtractionResult,
    userId,
    userMessage,
  });
  if (positiveFeedbackOutcome) return positiveFeedbackOutcome;

  // Получаем сессию заранее: она нужна для complaint-flow, коротких подтверждений
  // и дальнейших сценариев внутри текущего ответа.
  const session = await getOrCreateSession(userId, sessionId);
  let shouldSkipHistoricalDateRecovery = Boolean(session?.offTopicContextResetPending);
  const activeComplaintFlow = session?.complaintFlow || null;
  const complaintSlots = Array.isArray(slotExtractionResult?.slots)
    ? slotExtractionResult.slots.filter((slot) => slot && slot.name)
    : [];

  if (isRememberedBudgetQuestion(userMessage)) {
    try {
      userPreferences = await getUserPreferences(userId);
    } catch (error) {
      console.warn(
        `⚠️ [${userId}][${sessionId}] Не удалось загрузить предпочтения для ответа о бюджете:`,
        error
      );
    }

    if (requestId) updateStatus(requestId, 'Формируем ответ...');
    return { kind: 'reply', response: await buildRememberedBudgetReply(userPreferences) };
  }

  if (isPreferenceMemoryConfirmation || shouldPreferMemoryMetaRouting) {
    try {
      userPreferences = await getUserPreferences(userId);
    } catch (error) {
      console.warn(
        `⚠️ [${userId}][${sessionId}] Не удалось загрузить предпочтения для ответа о памяти:`,
        error
      );
    }

    console.log(
      `🧠 [${userId}][${sessionId}] Meta-вопрос о памяти предпочтений имеет приоритет над complaint/search routing`
    );
    if (requestId) updateStatus(requestId, 'Формируем ответ...');
    return {
      kind: 'reply',
      response: await buildPreferenceMemoryConfirmationResponseViaLlm({
        userId,
        sessionId,
        userMessage,
        requestId,
        userPreferences,
        memoryType: preferenceMemoryReferenceIntent?.memoryType || '',
      }),
    };
  }

  if (isEventDislikeRequest && !activeComplaintFlow) {
    return {
      kind: 'reply',
      response: await respondToEventDislike({
        requestId,
        dislikedEventTitles,
        userId,
        sessionId,
        session,
        userMessage,
      }),
    };
  }

  const activeComplaintFlowOutcome = await respondToActiveComplaintFlow({
    activeComplaintFlow,
    complaintSlots,
    recommendationComplaintIntent,
    recommendationsIntent,
    requestId,
    session,
    sessionId,
    userId,
    userMessage,
  });
  if (activeComplaintFlowOutcome) return activeComplaintFlowOutcome;

  let isShowMoreRequest = !!showMoreIntent;
  let effectiveShowMoreIntent = showMoreIntent || null;
  let isEventDetailsRequest = !!eventDetailsIntent;
  const isChangeCityRequest = !!changeCityIntent;
  const isChangeDateRequest = !!changeDateIntent;
  const isChangePreferencesRequest = !!changePreferencesIntent;
  let canApplyChangePreferencesDirectly = false;
  let directPreferenceChange = null;
  const isHealthComplaintRequest = !!healthComplaintIntent;
  const technicalMetaIntent = detectedIntents.find(
    (intent) =>
      intent &&
      intent.name === TECHNICAL_META_INTENT_NAME &&
      (typeof intent.confidence !== 'number' ||
        intent.confidence >= TECHNICAL_META_CONFIDENCE_THRESHOLD)
  );
  const hasTechnicalMetaIntent = Boolean(technicalMetaIntent);

  const normalizedUserMessageLower =
    typeof userMessage === 'string' ? userMessage.trim().toLowerCase() : '';
  const normalizedUserMessage = normalizeText(userMessage);
  const slashCommand = extractSlashCommand(userMessage);

  if (preferenceMemoryReferenceIntent) {
    console.log(
      `🧠 [${userId}][${sessionId}] LLM распознала обращение к памяти предпочтений`,
      preferenceMemoryReferenceIntent
    );
  }

  if (
    shouldPreferMemoryMetaRouting &&
    recommendationsIntent &&
    String(recommendationsIntent.source || '')
      .trim()
      .toLowerCase() === 'heuristic'
  ) {
    console.log(
      `🧭 [${userId}][${sessionId}] Игнорирую heuristic recommendations_request: LLM распознала meta-вопрос о памяти`,
      {
        recommendationsIntent,
        preferenceMemoryReferenceIntent,
      }
    );
    recommendationsIntent = null;
  }

  if (slashCommand) {
    console.log(
      `⌨️ [${userId}][${sessionId}] Обнаружена slash-команда "${slashCommand}" — трактую как off_topic и отправляю в живой LLM-редирект`
    );
    offTopicIntent = {
      name: OFF_TOPIC_INTENT_NAME,
      confidence: 1,
      trigger: slashCommand,
      source: 'slash_command',
    };
  }

  if (offTopicIntent && preferenceMemoryRequest.wantsAnyPreferenceMemory) {
    console.log(
      `🧭 [${userId}][${sessionId}] Игнорирую off_topic: planner распознал запрос к памяти предпочтений`,
      { trigger: userMessage }
    );
    offTopicIntent = null;
  }

  if (offTopicIntent && looksLikeUnknownArtistDiscoveryText(userMessage)) {
    console.log(
      `🧭 [${userId}][${sessionId}] Игнорирую off_topic: запрос похож на поиск популярного артиста по афише`,
      { trigger: userMessage }
    );
    offTopicIntent = null;
  }

  const hasOtherNonOffTopicIntent = detectedIntents.some(
    (intent) => intent && intent.name && intent.name !== OFF_TOPIC_INTENT_NAME
  );
  if (
    !isShowMoreRequest &&
    !isEventDetailsRequest &&
    offTopicIntent &&
    !hasOtherNonOffTopicIntent &&
    looksLikeShowMoreRequestText(userMessage)
  ) {
    const historyEvents =
      lastEventsFromHistory || (await getLastEventsFromHistory(userId, sessionId));
    lastEventsFromHistory = lastEventsFromHistory || historyEvents;

    if (historyEvents?.normalized?.length) {
      isShowMoreRequest = true;
      effectiveShowMoreIntent = {
        name: 'show_more_results',
        confidence: 0.9,
        trigger: userMessage,
        source: 'heuristic',
      };
      console.log(
        `🔁 [${userId}][${sessionId}] FALLBACK: трактую короткий запрос как "показать больше вариантов" (игнорирую off_topic, если он есть)`,
        { trigger: userMessage }
      );
    }
  }

  if (!isHealthComplaintRequest && isAssistantIdentityQuestion(userMessage)) {
    console.log(
      `🧩 [${userId}][${sessionId}] Вопрос "человек или бот" — отвечаю и возвращаю к подбору`
    );
    if (requestId) updateStatus(requestId, 'Формируем ответ...');
    return {
      kind: 'reply',
      response: await buildAssistantIdentityResponseViaLlm({
        userId,
        sessionId,
        userMessage,
        requestId,
      }),
    };
  }

  const assistantCriticismOutcome = await respondToAssistantCriticism({
    assistantCriticismIntent,
    assistantCriticismProfile,
    requestId,
    sessionId,
    userId,
    userMessage,
  });
  if (assistantCriticismOutcome) return assistantCriticismOutcome;

  if (
    !slashCommand &&
    !isHealthComplaintRequest &&
    !isAssistantIdentityQuestion(userMessage) &&
    (hasTechnicalMetaIntent || isTechnicalMetaQuestion(userMessage))
  ) {
    console.log(
      `🛡️ [${userId}][${sessionId}] Технический вопрос — возвращаю мягкий редирект к подбору мероприятий`
    );
    if (requestId) updateStatus(requestId, 'Формируем ответ...');
    return {
      kind: 'reply',
      response: await buildTechnicalRedirectResponseViaLlm({
        userId,
        sessionId,
        userMessage,
        requestId,
      }),
    };
  }

  const extractedSlots = Array.isArray(slotExtractionResult?.slots)
    ? slotExtractionResult.slots
    : [];
  const hasNonCityExtractedSlots = extractedSlots.some(
    (slot) =>
      slot &&
      String(slot.name || '').trim() !== '' &&
      slot.name !== 'город' &&
      String(slot.value || '').trim() !== ''
  );
  const recommendationsFromHeuristicOnly =
    Boolean(recommendationsIntent) &&
    String(recommendationsIntent?.source || '') === 'heuristic' &&
    !offTopicIntent &&
    !showMoreIntent &&
    !buyTicketIntent &&
    !eventDetailsIntent &&
    !changeCityIntent &&
    !changeDateIntent &&
    !changePreferencesIntent &&
    !hasNonCityExtractedSlots;

  const offTopicGateOutcome = await respondToOffTopicGate({
    recommendationsFromHeuristicOnly,
    requestId,
    sessionId,
    userId,
    userMessage,
  });
  if (offTopicGateOutcome) return offTopicGateOutcome;

  const isQuickCategorySelection = isQuickCategoryButtonText(userMessage);
  const isBuyTicketsUiCommand = isBuyTicketsCommand(userMessage);
  const lastAssistantButtons = await getLastAssistantButtons(userId, sessionId);
  const isButtonEcho = matchesAnyButtonText(userMessage, lastAssistantButtons);
  if (
    shouldIgnoreOffTopicForTrustedUiAction({
      offTopicIntent,
      isQuickCategorySelection,
      isButtonEcho,
      isBuyTicketsUiCommand,
    })
  ) {
    console.log(
      `🧭 [${userId}][${sessionId}] Игнорирую off_topic: сообщение совпало с доверенным UI-действием`,
      {
        trigger: userMessage,
        isQuickCategorySelection,
        isButtonEcho,
        isBuyTicketsUiCommand,
        offTopicIntent,
      }
    );
    offTopicIntent = null;
  }
  let { isExplicitAnyBudget, isExplicitAnyGenre, isExplicitAnyDate } = resolveExplicitAnySelection({
    normalizedUserMessage: normalizedUserMessageLower,
    lastAssistantButtons,
  });
  const explicitClarificationTarget = inferClarificationActionFromText(userMessage);
  const clarificationActionTarget =
    inferClarificationActionFromButtons(userMessage, lastAssistantButtons) ||
    explicitClarificationTarget;
  const rawClarificationTarget = inferClarificationTarget({ buttons: lastAssistantButtons });
  const clarificationTarget = resolveClarificationTargetFromSessionContext({
    clarificationTarget: rawClarificationTarget,
    lastAssistantButtons,
    slotsSnapshot: Array.isArray(session?.slotsSnapshot) ? session.slotsSnapshot : [],
  });
  const inferredUiSlot = isButtonEcho
    ? inferUiSlotFromButtons(userMessage, lastAssistantButtons)
    : null;
  const heuristicDateReply = !inferredUiSlot ? extractHeuristicDateHintFromText(userMessage) : '';
  const inferredDateReplySlot = heuristicDateReply
    ? enrichSlotWithDate({
        name: 'дата_события',
        value: heuristicDateReply,
        confidence: 0.92,
        source: 'heuristic_date_reply',
      })
    : null;
  let recoveredUiSlot = inferredUiSlot || inferredDateReplySlot;
  if (!recoveredUiSlot && isExplicitAnyBudget) {
    recoveredUiSlot = {
      name: 'бюджет',
      value: 'любой',
      confidence: 1.0,
      source: 'explicit_any_budget',
    };
  }
  if (
    shouldIgnoreRecoveredUiSlotForOffTopic({
      offTopicIntent,
      inferredUiSlot,
      inferredDateReplySlot,
      isButtonEcho,
      isQuickCategorySelection,
    })
  ) {
    console.log(
      `🧭 [${userId}][${sessionId}] Игнорирую эвристическое восстановление даты: сообщение уже распознано как off_topic`,
      { trigger: userMessage, recoveredSlot: inferredDateReplySlot?.value || null }
    );
    recoveredUiSlot = null;
  }
  const softClosureReply = buildSoftClosureReplyResponse(userMessage);

  if (
    softClosureReply &&
    !isHealthComplaintRequest &&
    !isChangeCityRequest &&
    !isChangeDateRequest &&
    !isChangePreferencesRequest &&
    !isEventDetailsRequest &&
    !isBuyTicketsUiCommand &&
    !clarificationActionTarget &&
    !recoveredUiSlot &&
    !isQuickCategorySelection
  ) {
    console.log(`🤝 [${userId}][${sessionId}] Мягко завершаю диалог без новой выдачи событий`, {
      trigger: userMessage,
    });
    if (requestId) updateStatus(requestId, 'Формируем ответ...');
    return { kind: 'reply', response: await softClosureReply };
  }

  if (clarificationActionTarget) {
    return {
      kind: 'reply',
      response: await respondToClarificationAction({
        userId,
        sessionId,
        clarificationActionTarget,
        requestId,
        session,
        userMessage,
      }),
    };
  }

  const extractedSlotsForOffTopicCheck = Array.isArray(slotExtractionResult?.slots)
    ? slotExtractionResult.slots
    : [];
  const hasNonCityExtractedSlot = extractedSlotsForOffTopicCheck.some(
    (slot) =>
      slot &&
      typeof slot.name === 'string' &&
      slot.name.trim() !== '' &&
      slot.name !== 'город' &&
      slot.value !== undefined &&
      slot.value !== null &&
      String(slot.value).trim() !== ''
  );
  const localCategoryForRouting = resolveLocalCategoryForRouting(userMessage, offTopicIntent);
  const hasExplicitCategoryInUserMessage = Boolean(localCategoryForRouting);
  if (offTopicIntent && !hasExplicitCategoryInUserMessage) {
    const suppressedCategory = detectCategoryFromText(userMessage);
    if (suppressedCategory && isAuthoritativeOffTopicIntent(offTopicIntent)) {
      console.log(
        `🧭 [${userId}][${sessionId}] Игнорирую локальную категорию "${suppressedCategory}": ` +
          'сообщение уже уверенно распознано как off_topic',
        offTopicIntent
      );
    }
  }
  const hasExplicitSeniorCompanion = hasExplicitSeniorCompanionInText(userMessage);
  const isStandaloneCityOnlyReply = isStandaloneCityReply(
    userMessage,
    extractedSlotsForOffTopicCheck
  );

  if (offTopicIntent && isStandaloneCityOnlyReply) {
    console.log(
      `🧭 [${userId}][${sessionId}] Игнорирую off_topic: сообщение распознано как короткий ответ с городом`,
      { trigger: userMessage }
    );
    offTopicIntent = null;
  }

  const currentSlotsBeforeSpecialClarification = await getCurrentSessionSlots(userId, sessionId);
  const knownCityBeforeSpecialClarification = getKnownCityValue(
    currentSlotsBeforeSpecialClarification
  );
  const shouldConsiderAmbiguousGenreClarification =
    !isShowMoreRequest &&
    !isEventDetailsRequest &&
    !isQuickCategorySelection &&
    !isButtonEcho &&
    !isBuyTicketsUiCommand &&
    !recoveredUiSlot &&
    !hasExplicitCategoryInUserMessage;
  const ambiguousGenreChoice = shouldConsiderAmbiguousGenreClarification
    ? resolveAmbiguousGenreCategoryChoice({
        slots: [
          ...(Array.isArray(currentSlotsBeforeSpecialClarification)
            ? currentSlotsBeforeSpecialClarification
            : []),
          ...extractedSlotsForOffTopicCheck,
        ],
        userMessage,
      })
    : null;

  if (ambiguousGenreChoice && knownCityBeforeSpecialClarification) {
    return {
      kind: 'reply',
      response: await respondToAmbiguousGenre({
        currentSlotsBeforeSpecialClarification,
        extractedSlotsForOffTopicCheck,
        ambiguousGenreChoice,
        userId,
        sessionId,
        session,
        knownCityBeforeSpecialClarification,
        requestId,
        userMessage,
      }),
    };
  }

  const offTopicCandidateOutcome = await respondToOffTopicCandidate({
    detectedIntents,
    hasExplicitCategoryInUserMessage,
    hasExplicitSeniorCompanion,
    hasNonCityExtractedSlot,
    isButtonEcho,
    isBuyTicketsUiCommand,
    isEventDetailsRequest,
    isQuickCategorySelection,
    isShowMoreRequest,
    offTopicIntent,
    preferenceMemoryRequest,
    recommendationsIntent,
    recoveredUiSlot,
    requestId,
    session,
    sessionId,
    slashCommand,
    slotExtractionResult,
    userId,
    userMessage,
  });
  if (offTopicCandidateOutcome?.kind === 'reply') return offTopicCandidateOutcome;
  if (offTopicCandidateOutcome?.kind === 'continue') {
    ({ slotExtractionResult, recommendationsIntent } = offTopicCandidateOutcome);
    offTopicIntent = null;
  }

  if (shouldSkipHistoricalDateRecovery) {
    console.log(
      `🧭 [${userId}][${sessionId}] После off_topic не восстанавливаю дату из истории на первом следующем сообщении`
    );
    await updateOffTopicContextResetPending(userId, sessionId, false);
    session.offTopicContextResetPending = false;
  }

  {
    const moodResponse = await respondToMoodWithoutCity({
      recommendationsIntent,
      isShowMoreRequest,
      isEventDetailsRequest,
      isChangeCityRequest,
      isChangeDateRequest,
      isChangePreferencesRequest,
      isHealthComplaintRequest,
      isQuickCategorySelection,
      isButtonEcho,
      recoveredUiSlot,
      isBuyTicketsUiCommand,
      userId,
      sessionId,
      extractedSlotsForOffTopicCheck,
      userMessage,
      requestId,
    });
    if (moodResponse) return { kind: 'reply', response: await moodResponse };
  }

  const buyTicketsCommandOutcome = await respondToBuyTicketsCommand({
    requestId,
    session,
    userMessage,
  });
  if (buyTicketsCommandOutcome) return buyTicketsCommandOutcome;

  // КРИТИЧЕСКИ ВАЖНО: короткие реплики (привет/пока/спасибо/ок и т.п.) не должны запускать выдачу событий,
  // даже если город уже установлен (например, из поддомена).
  const hasRecommendationsIntent = detectedIntents.some(
    (i) => i && i.name === 'recommendations_request'
  );
  const smalltalkOutcome = await respondToSmalltalk({
    hasRecommendationsIntent,
    requestId,
    session,
    sessionId,
    slotExtractionResult,
    smalltalkIntent,
    userId,
    userMessage,
  });
  if (smalltalkOutcome?.kind === 'reply') return smalltalkOutcome;
  if (smalltalkOutcome?.kind === 'continue') ({ slotExtractionResult } = smalltalkOutcome);

  // Проверяем, является ли запрос уточнением параметров (жанр, бюджет, время, дата)
  const isClarificationRequest = Boolean(explicitClarificationTarget);
  const wantsPreferredEventsRequest =
    preferenceMemoryRequest.wantsAnyPreferenceMemory && !isPreferenceMemoryConfirmation;
  const allowPreferenceKeywordExpansion = wantsPreferredEventsRequest;

  if (wantsPreferredEventsRequest && eventDetailsIntent && !eventDetailsIntent.eventReference) {
    console.log(
      `🧭 [${userId}][${sessionId}] Запрос на предпочтения, не считаю это детализацией события`
    );
    eventDetailsIntent = null;
    isEventDetailsRequest = false;
  }

  return {
    kind: 'continue',
    context: {
      detectedIntents,
      buyTicketIntent,
      recommendationsIntent,
      healthComplaintIntent,
      lastEventsFromHistory,
      eventDetailsIntent,
      isEventDislikeRequest,
      changeDateIntent,
      changePreferencesIntent,
      session,
      userPreferences,
      offTopicIntent,
      preferenceMemoryRequest,
      isShowMoreRequest,
      isEventDetailsRequest,
      effectiveShowMoreIntent,
      isHealthComplaintRequest,
      isQuickCategorySelection,
      isButtonEcho,
      isBuyTicketsUiCommand,
      inferredUiSlot,
      recoveredUiSlot,
      isExplicitAnyBudget,
      isChangeCityRequest,
      isChangeDateRequest,
      isChangePreferencesRequest,
      clarificationActionTarget,
      shouldSkipHistoricalDateRecovery,
      wantsPreferredEventsRequest,
      canApplyChangePreferencesDirectly,
      directPreferenceChange,
      normalizedUserMessage,
      isExplicitAnyGenre,
      isExplicitAnyDate,
      clarificationTarget,
      isClarificationRequest,
      allowPreferenceKeywordExpansion,
      slotExtractionResult,
    },
  };
}
