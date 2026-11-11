import { isRussianCity } from '../offerService.js';
import { resetOfferFlags } from '../sessionService.js';
import { QUERY_SLOT_NAMES } from './slotUtils.js';
import { TRIVIAL_WORDS, STOP_WORDS, NON_SPECIFIC_QUERY_WORDS } from './searchVocabulary.js';
import { normalizeText } from './textUtils.js';
import { hasPersistedShowAllQuery, shouldSkipVagueClarificationForMoodPlan } from './moodHealth.js';
import { updateStatus } from '../statusService.js';
import { buildCityChangeCategoryResponseViaLlm } from './dialogReplies.js';

export async function prepareSearchContext({
  request: { userId, sessionId, userMessage, requestId },
  routing: { isChangeCityRequest, session, isShowMoreRequest, recommendationsIntent },
  slots: { history, showAllIntent },
  searchSlots: { effectiveSlots, slotsChanged, fallbackQuery, keywordOverride },
}) {
  const isFirstMessage = !history.some((msg) => msg.role === 'assistant');

  // Проверяем, выбирал ли пользователь "Другой город" ранее в истории
  // Ищем в сообщениях пользователя упоминания "Другой город" или его вариантов
  // Важно: проверяем только точные совпадения или когда это единственное/основное содержимое сообщения
  // Это предотвращает ложные срабатывания при упоминании "другой город" в контексте (например, "хочу в другой город поехать")
  const otherCityVariants = [
    'другой город',
    'другом городе',
    'другого города',
    'другому городу',
    'другим городом',
    'иной город',
    'прочий город',
  ];
  const hasSelectedOtherCity = history.some((msg) => {
    if (msg.role !== 'user') {
      return false;
    }
    const content = String(msg.content || '')
      .toLowerCase()
      .trim();

    if (otherCityVariants.some((variant) => content === variant)) {
      return true;
    }

    const normalizedContent = content.replace(/[.,!?;:]/g, '').trim();
    if (otherCityVariants.some((variant) => normalizedContent === variant)) {
      return true;
    }

    return false;
  });

  if (hasSelectedOtherCity) {
    console.log(
      `🔍 [${userId}][${sessionId}] Пользователь ранее выбирал "Другой город" - не показываем эту кнопку повторно`
    );
  }

  // Проверяем, есть ли информация по указанному городу в базе
  const citySlot = effectiveSlots.find((slot) => slot && slot.name === 'город');
  let isNonRussianCity = false;
  let nonRussianCityName = null;
  let hasValidCity = false;

  if (citySlot && citySlot.value) {
    const cityName = String(citySlot.value).trim();
    if (isRussianCity(cityName)) {
      hasValidCity = true;
    } else {
      isNonRussianCity = true;
      nonRussianCityName = cityName;
      console.log(`⚠️ [${userId}][${sessionId}] Город не найден в базе: "${cityName}"`);
    }
  }

  if (isChangeCityRequest && slotsChanged && session) {
    const hadFlags = Boolean(
      session.quickOfferSent || session.finalOfferSent || session.clarificationAsked
    );
    if (hadFlags) {
      console.log(
        `🔄 [${userId}][${sessionId}] Смена города: сбрасываю флаги предложений/уточнений`
      );
      await resetOfferFlags(userId, sessionId);
      session.quickOfferSent = false;
      session.finalOfferSent = false;
      session.clarificationAsked = false;
    }
  }

  // Проверяем валидность запроса на основе слотов:
  // Для генерации предложений требуется валидный поисковый запрос (query slot) или явное намерение показать все
  // ИЛИ только валидный город для generic запросов (например, "куда-нибудь сходить")
  const hasQuerySlotValue = effectiveSlots.some(
    (slot) => slot && slot.name && QUERY_SLOT_NAMES.has(slot.name)
  );
  // КРИТИЧЕСКИ ВАЖНО: Проверяем не только наличие слота города, но и его валидность
  // Если пользователь выбрал "Другой город", слот должен быть отфильтрован, но на всякий случай проверяем валидность
  const hasCitySlot = hasValidCity;

  // Проверяем, есть ли только тривиальный поисковый_запрос (который не считается валидным)
  const searchQuerySlot = effectiveSlots.find((slot) => slot && slot.name === 'поисковый_запрос');
  const hasTrivialSearchQuery =
    searchQuerySlot &&
    searchQuerySlot.value &&
    (searchQuerySlot.value.toLowerCase().trim().length <= 3 ||
      TRIVIAL_WORDS.has(searchQuerySlot.value.toLowerCase().trim()) ||
      STOP_WORDS.has(searchQuerySlot.value.toLowerCase().trim()));
  const normalizedFallbackQuery = normalizeText(fallbackQuery);
  const hasMeaningfulFallbackQuery = normalizedFallbackQuery
    .split(/\s+/)
    .filter(Boolean)
    .some(
      (token) =>
        token.length > 2 &&
        !TRIVIAL_WORDS.has(token) &&
        !STOP_WORDS.has(token) &&
        !NON_SPECIFIC_QUERY_WORDS.has(token)
    );
  const hasQuerySignal = hasQuerySlotValue || hasMeaningfulFallbackQuery;
  const persistedShowAllRequest = hasPersistedShowAllQuery(effectiveSlots);
  const showAllRequested = showAllIntent || persistedShowAllRequest;
  const skipVagueClarificationForMoodPlan = shouldSkipVagueClarificationForMoodPlan({
    slots: effectiveSlots,
    fallbackQuery,
    keywordOverride,
    hasValidCity,
    userMessage,
  });

  // Generic-запрос: есть город, но нет конкретного типа мероприятия.
  // Фильтры (бюджет, возраст, цена, дата, настроение) конкретным критерием не считаются.
  const hasSpecificEventType = effectiveSlots.some(
    (slot) =>
      slot &&
      slot.name &&
      QUERY_SLOT_NAMES.has(slot.name) &&
      slot.name !== 'поисковый_запрос' && // поисковый_запрос не считается конкретным критерием
      slot.name !== 'настроение' // настроение - это фильтр, а не тип мероприятия
  );

  if (
    isChangeCityRequest &&
    hasValidCity &&
    !hasSpecificEventType &&
    !hasQuerySignal &&
    !showAllRequested &&
    !isShowMoreRequest &&
    !skipVagueClarificationForMoodPlan
  ) {
    const cityName = String(citySlot?.value || '').trim();
    console.log(
      `🏙️ [${userId}][${sessionId}] Смена города на "${cityName}", нет критериев — предлагаю выбрать категорию`
    );
    if (requestId) updateStatus(requestId, 'Формируем ответ...');
    return {
      kind: 'reply',
      response: await buildCityChangeCategoryResponseViaLlm({
        userId,
        sessionId,
        userMessage,
        requestId,
        cityName,
      }),
    };
  }
  // Generic запрос: есть город, но нет конкретного типа мероприятия (могут быть фильтры).
  // ВАЖНО: допускаем генерацию "популярных событий" только если пользователь реально просит варианты,
  // иначе (например, "пока"/"ок") это приведёт к неожиданной выдаче.
  const wantsRecommendations = Boolean(
    recommendationsIntent || showAllRequested || isShowMoreRequest || hasQuerySignal
  );
  const isGenericRequest =
    wantsRecommendations &&
    hasCitySlot &&
    !hasSpecificEventType &&
    (!searchQuerySlot || hasTrivialSearchQuery) &&
    !hasMeaningfulFallbackQuery;

  const hasValidSearchRequest =
    hasQuerySignal || showAllRequested || isShowMoreRequest || isGenericRequest;

  // Если есть только город, но нет валидного поискового запроса - это невалидный запрос для генерации предложений
  // ИСКЛЮЧЕНИЕ: если это generic запрос (только город без конкретных критериев), разрешаем поиск
  const isInvalidRequestForOffer = hasCitySlot && !hasValidSearchRequest && !isGenericRequest;

  if (isInvalidRequestForOffer) {
    console.log(
      `⚠️ [${userId}][${sessionId}] Запрос невалиден для генерации предложений: есть только город без поискового запроса`
    );
    console.log(`   - Есть город: ${hasCitySlot}`);
    console.log(`   - Есть валидный поисковый запрос: ${hasValidSearchRequest}`);
    console.log(`   - Show-all requested: ${showAllRequested}`);
    console.log(`   - Show-more intent: ${isShowMoreRequest}`);
  }

  return {
    kind: 'continue',
    context: {
      hasSelectedOtherCity,
      citySlot,
      hasValidCity,
      isNonRussianCity,
      nonRussianCityName,
      hasSpecificEventType,
      showAllRequested,
      skipVagueClarificationForMoodPlan,
      wantsRecommendations,
      isInvalidRequestForOffer,
      isFirstMessage,
    },
  };
}
