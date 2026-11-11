import { parseBudgetValue } from '../../../../../shared/moneyUtils.js';
import { normalizeText, pickVariant } from './textUtils.js';

import {
  containsNonCyrillic,
  hasForbiddenAssistantFeminineSelfReference,
} from '../llm/assistantResponseUtils.js';
import { getMessageHistory } from '../messagesStorage.js';
import { requestAssistantMessage } from './gatewayClient.js';
import { hasNegativeFeedback, hasPositiveFeedback } from '../feedbackService.js';
import { savePreference, PREFERENCE_TYPES } from '../userPreferencesService.js';
import { normalizeEventTitleValue } from '../../../../../shared/preferenceRules.js';
import { COMPLAINT_ROOT_BUTTONS } from '../complaintService.js';
import { POSITIVE_FEEDBACK_ACK_BUTTONS } from './replyConstants.js';

function extractPriceCapFromText(text) {
  const normalized = normalizeText(text);
  const priceCapMatch = normalized.match(
    /(?:до|не дороже|не больше|максимум|max)\s*((?:\d{1,3}(?:[ \u00a0.,]\d{3})+)|(?:\d+(?:[.,]\d+)?))\s*(к|k|тыс(?:\.|яч(?:а|и)?)?|тыщ(?:а|и)?|тысяча|тысячи|тысяч)?(?:\s*(?:р|руб(?:\.|ля|лей)?|₽))?(?=$|\s|[.,!?;:])/u
  );
  if (!priceCapMatch) {
    return null;
  }

  return parseBudgetValue(`${priceCapMatch[1] || ''} ${priceCapMatch[2] || ''}`.trim(), {
    sourceText: normalized,
  });
}

function parseBudgetSlotAmount(slot = null, sourceText = '') {
  if (!slot) {
    return null;
  }

  const parsed = parseBudgetValue(slot.value, { sourceText });
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function extractBudgetCapFromSlots(slots = []) {
  if (!Array.isArray(slots) || slots.length === 0) {
    return null;
  }
  const candidates = slots
    .filter((s) => s && (s.name === 'бюджет' || s.name === 'цена_до' || s.name === 'цена'))
    .map((s) => parseBudgetSlotAmount(s))
    .filter((v) => Number.isFinite(v) && v > 0);
  if (candidates.length === 0) {
    return null;
  }
  return Math.min(...candidates);
}

function isRememberedBudgetQuestion(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return false;
  }

  const hasQuestionSignal =
    /[?？]/u.test(String(text || '')) ||
    /(?<![A-Za-zА-Яа-яЁё0-9_])(помнишь|помните|какой|каков|напомни|напомните)(?![A-Za-zА-Яа-яЁё0-9_])/u.test(
      normalized
    );

  if (!hasQuestionSignal) {
    return false;
  }

  return (
    /(?:ты|вы|помнишь|помните)\s+.*(?<![A-Za-zА-Яа-яЁё0-9_])бюджет(?![A-Za-zА-Яа-яЁё0-9_])/u.test(
      normalized
    ) ||
    /(?<![A-Za-zА-Яа-яЁё0-9_])мой\s+бюджет(?![A-Za-zА-Яа-яЁё0-9_])/u.test(normalized) ||
    /(?<![A-Za-zА-Яа-яЁё0-9_])какой\s+у\s+меня\s+бюджет(?![A-Za-zА-Яа-яЁё0-9_])/u.test(normalized)
  );
}

function buildRememberedBudgetReply(preferences = null) {
  const min = Number(preferences?.priceRange?.min);
  const max = Number(preferences?.priceRange?.max);
  const hasMin = Number.isFinite(min) && min > 0;
  const hasMax = Number.isFinite(max) && max > 0;

  if (!hasMin && !hasMax) {
    return {
      message:
        'Пока не вижу у себя сохранённого бюджета. Можете написать желаемую сумму, например: до 2000 ₽.',
      buttons: ['До 1000 ₽', 'До 2000 ₽', 'До 3000 ₽', 'Любой бюджет'],
      offer: null,
    };
  }

  const budgetText =
    hasMin && hasMax ? `от ${min} до ${max} ₽` : hasMax ? `до ${max} ₽` : `от ${min} ₽`;

  return {
    message: `Да, помню ваш бюджет: ${budgetText}. Могу сразу подобрать варианты в этом диапазоне.`,
    buttons: ['Показать варианты', 'Уточнить бюджет'],
    offer: null,
  };
}

function isAuthoritativeIntent(intent = null, minConfidence = 0.8) {
  if (!intent || typeof intent !== 'object') {
    return false;
  }

  const source = String(intent.source || '')
    .trim()
    .toLowerCase();
  const confidence = typeof intent.confidence === 'number' ? intent.confidence : 0;
  return (source === 'llm' || source === 'model') && confidence >= minConfidence;
}

function hasExplicitSearchActionCue(text = '') {
  const normalized = normalizeText(text);
  if (!normalized) {
    return false;
  }

  return /(?:^|[^\p{L}\p{N}_])(?:покажи|показать|найди|найти|подбери|подобрать|посоветуй|предложи|дай)(?=$|[^\p{L}\p{N}_])/u.test(
    normalized
  );
}

function isPreferenceMemoryConfirmationQuestion(text = '', preferenceMemoryReferenceIntent = null) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return false;
  }

  const hasQuestionSignal =
    /[?？]/u.test(String(text || '')) ||
    /(?:^|[^\p{L}\p{N}_])(?:помнишь|помните|запомнил|запомнили|запомнила|запомнить|учел|учёл|учли|учтешь|учтёшь|напомни|напомните)(?=$|[^\p{L}\p{N}_])/u.test(
      normalized
    );

  if (!hasQuestionSignal) {
    return false;
  }

  const memoryType = String(preferenceMemoryReferenceIntent?.memoryType || '').trim();
  const hasMemoryCue =
    /(?:ты|вы)\s+.*(?:^|[^\p{L}\p{N}_])(?:помнишь|помните|запомнил|запомнили|учел|учёл|учтешь|учтёшь)(?=$|[^\p{L}\p{N}_])/u.test(
      normalized
    ) ||
    /(?:^|[^\p{L}\p{N}_])(?:запомнил|запомнили|помнишь|помните|учел|учёл|учтешь|учтёшь)\s+ли(?=$|[^\p{L}\p{N}_])/u.test(
      normalized
    ) ||
    /(?:^|[^\p{L}\p{N}_])(?:помнишь|помните|запомнил|запомнили|учел|учёл|учтешь|учтёшь)(?=$|[^\p{L}\p{N}_])/u.test(
      normalized
    ) ||
    /(?:^|[^\p{L}\p{N}_])у\s+тебя\s+это\s+есть(?=$|[^\p{L}\p{N}_])/u.test(normalized);

  if (!hasMemoryCue) {
    return false;
  }

  if (memoryType === 'budget') {
    return false;
  }

  const hasSearchActionCue = hasExplicitSearchActionCue(text);

  if (preferenceMemoryReferenceIntent && hasMemoryCue && !hasSearchActionCue) {
    return true;
  }

  return !hasSearchActionCue;
}

function shouldPreferPreferenceMemoryMetaRouting(
  text = '',
  preferenceMemoryReferenceIntent = null,
  recommendationsIntent = null
) {
  if (!isAuthoritativeIntent(preferenceMemoryReferenceIntent)) {
    return false;
  }

  if (hasExplicitSearchActionCue(text)) {
    return false;
  }

  const recommendationsSource = String(recommendationsIntent?.source || '')
    .trim()
    .toLowerCase();
  if (
    isAuthoritativeIntent(recommendationsIntent) &&
    recommendationsSource &&
    recommendationsSource !== 'heuristic'
  ) {
    return false;
  }

  return true;
}

function formatPreferenceMemoryConfirmationSummary(
  preferences = null,
  memoryType = '',
  userMessage = ''
) {
  const normalizedMemoryType = String(memoryType || '').trim();
  const latestGenre =
    Array.isArray(preferences?.genres) && preferences.genres.length > 0
      ? String(preferences.genres[preferences.genres.length - 1] || '').trim()
      : '';
  const latestArtist =
    Array.isArray(preferences?.artists) && preferences.artists.length > 0
      ? String(preferences.artists[preferences.artists.length - 1] || '').trim()
      : '';
  const latestEventType =
    Array.isArray(preferences?.eventTypes) && preferences.eventTypes.length > 0
      ? String(preferences.eventTypes[preferences.eventTypes.length - 1] || '').trim()
      : '';
  const normalizedMessage = normalizeText(userMessage);

  if (
    (normalizedMemoryType === 'genre' ||
      normalizedMemoryType === 'taste' ||
      !normalizedMemoryType) &&
    latestGenre
  ) {
    return `вам нравится ${latestGenre}`;
  }

  if (
    (normalizedMemoryType === 'artist' ||
      normalizedMemoryType === 'taste' ||
      !normalizedMemoryType) &&
    latestArtist
  ) {
    return `вам нравится ${latestArtist}`;
  }

  if (
    (normalizedMemoryType === 'event_type' ||
      normalizedMemoryType === 'general' ||
      !normalizedMemoryType) &&
    latestEventType
  ) {
    return `вам ближе ${latestEventType}`;
  }

  if (/рок/u.test(normalizedMessage)) {
    return 'вам нравится рок';
  }

  return '';
}

function buildPreferenceMemoryConfirmationFallbackResponse({
  userPreferences = null,
  memoryType = '',
  userMessage = '',
} = {}) {
  const summary = formatPreferenceMemoryConfirmationSummary(
    userPreferences,
    memoryType,
    userMessage
  );
  const message = summary
    ? `Да, это предпочтение у меня уже сохранено: ${summary}.`
    : 'Да, ваши предпочтения у меня уже сохранены.';

  return {
    message,
    buttons: [],
    offer: null,
  };
}

function isSafePreferenceMemoryConfirmationText(text = '') {
  const value = String(text || '').trim();
  if (!value) return false;
  if (value.length > 220) return false;
  if (containsNonCyrillic(value)) return false;
  if (hasForbiddenAssistantFeminineSelfReference(value)) return false;

  const normalized = normalizeText(value);
  if (
    /(?<![A-Za-zА-Яа-яЁё0-9_])бот(?![A-Za-zА-Яа-яЁё0-9_])|(?<![A-Za-zА-Яа-яЁё0-9_])openai(?![A-Za-zА-Яа-яЁё0-9_])|(?<![A-Za-zА-Яа-яЁё0-9_])chatgpt(?![A-Za-zА-Яа-яЁё0-9_])|(?<![A-Za-zА-Яа-яЁё0-9_])gpt(?![A-Za-zА-Яа-яЁё0-9_])|(?<![A-Za-zА-Яа-яЁё0-9_])llm(?![A-Za-zА-Яа-яЁё0-9_])|(?<![A-Za-zА-Яа-яЁё0-9_])prompt(?![A-Za-zА-Яа-яЁё0-9_])/u.test(
      normalized
    )
  )
    return false;

  const hasMemoryAck =
    /(?:^|[^\p{L}\p{N}_])(?:уже\s+помню|помню|уже\s+запомнил|запомнил|уже\s+сохранено|сохранено|учту|буду\s+учитывать)(?=$|[^\p{L}\p{N}_])/u.test(
      normalized
    );
  const soundsLikeFreshSave =
    /(?:^|[^\p{L}\p{N}_])(?:вспоминаю|понял\s+вас|запомню|буду\s+учитывать\s+с(?:\s+)?этого\s+момента|в\s+дальнейшем\s+буду\s+учитывать)(?=$|[^\p{L}\p{N}_])/u.test(
      normalized
    ) &&
    !/(?:^|[^\p{L}\p{N}_])(?:уже\s+помню|уже\s+запомнил|помню)(?=$|[^\p{L}\p{N}_])/u.test(
      normalized
    );
  const driftsIntoSearch =
    /(?:^|[^\p{L}\p{N}_])(?:в\s+каком\s+городе|какой\s+город|что\s+подобрать|что\s+найти|покажу\s+варианты|подберу\s+варианты|вас\s+ждет|вас\s+ждёт)(?=$|[^\p{L}\p{N}_])/u.test(
      normalized
    );

  return hasMemoryAck && !soundsLikeFreshSave && !driftsIntoSearch;
}

async function buildPreferenceMemoryConfirmationResponseViaLlm({
  userId,
  sessionId,
  userMessage,
  requestId,
  userPreferences,
  memoryType = '',
}) {
  const fallback = buildPreferenceMemoryConfirmationFallbackResponse({
    userPreferences,
    memoryType,
    userMessage,
  });
  const summary = formatPreferenceMemoryConfirmationSummary(
    userPreferences,
    memoryType,
    userMessage
  );
  const history = await getMessageHistory(userId, sessionId);
  const lastAssistantText = Array.isArray(history)
    ? [...history].reverse().find((item) => item?.role === 'assistant' && item?.content)?.content ||
      ''
    : '';
  const buildSystemPrompt = ({ plainText = false } = {}) =>
    [
      'Ты ассистент Kassir.ru по подбору мероприятий.',
      'Пользователь спрашивает, запомнил ли ассистент его вкусы.',
      'Нужно коротко и по-человечески подтвердить, что предпочтение уже сохранено и ассистент уже его помнит, без запуска нового поиска и без лишних вопросов.',
      `Сохранённый ориентир: ${summary || 'есть сохранённые предпочтения'}.`,
      lastAssistantText
        ? `Последняя реплика ассистента в этой сессии: "${String(lastAssistantText).replace(/\s+/g, ' ').trim()}". Не повторяй её дословно и не копируй её заход.`
        : 'Сформулируй ответ свежо, без шаблонного канцелярита.',
      'Ограничения:',
      '- максимум 2 коротких предложения;',
      '- только русский язык, только кириллица;',
      '- ответ должен звучать как уже известный факт: например, "Да, уже помню..." или "Да, это уже сохранено...";',
      '- нельзя писать так, будто предпочтение запоминается только сейчас: запрещены "понял вас", "вспоминаю", "запомню", "в дальнейшем буду учитывать";',
      '- не упоминай конкретные мероприятия, концерты, спектакли, города, афишу и не создавай ощущение, будто ты уже что-то подобрал;',
      '- не задавай новый вопрос про город, жанр, дату или новый подбор;',
      '- не обещай прямо сейчас показать варианты;',
      '- не перечисляй кнопки;',
      plainText
        ? '- верни только текст ответа, без JSON и без дополнительных полей.'
        : '- верни строго JSON: {"text":"...","buttons":[]}.',
    ].join('\n');

  try {
    const normalized = await requestAssistantMessage(
      [
        { role: 'system', content: buildSystemPrompt() },
        {
          role: 'user',
          content: String(userMessage || '').trim() || 'Ты запомнил мои предпочтения?',
        },
      ],
      userId,
      sessionId,
      'preference_memory_confirmation',
      1,
      0.72,
      requestId,
      140
    );

    const rawPayload = String(normalized?.raw || '').trim();
    const primaryReturnedEmptyJson =
      rawPayload === '{}' || rawPayload === '{"text":"","buttons":[]}';
    const text = String(normalized?.text || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (isSafePreferenceMemoryConfirmationText(text)) {
      return {
        message: text,
        buttons: [],
        offer: null,
      };
    }

    const repairMessages = [
      { role: 'system', content: buildSystemPrompt() },
      {
        role: 'user',
        content: String(userMessage || '').trim() || 'Ты запомнил мои предпочтения?',
      },
      ...(normalized?.raw ? [{ role: 'assistant', content: String(normalized.raw) }] : []),
      {
        role: 'user',
        content:
          'Перепиши ответ естественнее и человечнее. Подтверди, что предпочтение уже сохранено и ты уже это помнишь. Не задавай новых вопросов, не предлагай подбор и не пиши так, будто запоминаешь это только сейчас.',
      },
    ];

    const repaired = await requestAssistantMessage(
      repairMessages,
      userId,
      sessionId,
      'preference_memory_confirmation_repair',
      1,
      0.66,
      requestId,
      140
    );

    const repairedRawPayload = String(repaired?.raw || '').trim();
    const repairedReturnedEmptyJson =
      repairedRawPayload === '{}' || repairedRawPayload === '{"text":"","buttons":[]}';
    const repairedText = String(repaired?.text || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (isSafePreferenceMemoryConfirmationText(repairedText)) {
      return {
        message: repairedText,
        buttons: [],
        offer: null,
      };
    }

    if (primaryReturnedEmptyJson || repairedReturnedEmptyJson) {
      console.warn(
        `⚠️ [${userId}][${sessionId}] PREFERENCE_MEMORY_CONFIRMATION: JSON-режим вернул пустой ответ, пробую plain-text recovery`
      );
    }

    const plainTextRecovery = await requestAssistantMessage(
      [
        { role: 'system', content: buildSystemPrompt({ plainText: true }) },
        {
          role: 'user',
          content: String(userMessage || '').trim() || 'Ты запомнил мои предпочтения?',
        },
      ],
      userId,
      sessionId,
      'preference_memory_confirmation_plaintext_recovery',
      1,
      0.62,
      requestId,
      120
    );

    const plainText = String(plainTextRecovery?.text || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (isSafePreferenceMemoryConfirmationText(plainText)) {
      return {
        message: plainText,
        buttons: [],
        offer: null,
      };
    }

    console.warn(
      `⚠️ [${userId}][${sessionId}] PREFERENCE_MEMORY_CONFIRMATION: все LLM-попытки не прошли safety-check, использую аварийный fallback`
    );
    return fallback;
  } catch (error) {
    console.warn(
      `⚠️ [${userId}][${sessionId}] PREFERENCE_MEMORY_CONFIRMATION: ошибка при генерации через LLM, использую аварийный fallback`,
      error
    );
    return fallback;
  }
}

function wantsMoreOffersAfterFeedback(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return false;
  }

  // Если пользователь после фидбека явно просит рекомендации — можно показывать выдачу.
  return (
    /(покажи|показать|посоветуй|предложи|подбери|найди)/u.test(normalized) ||
    /(похож|аналог|в\s+этом\s+же\s+духе|что\s+еще|что\s+ещ[её])/u.test(normalized) ||
    /(еще|ещ[её])\s+(вариант|событи|спектакл|концерт|мероприят)/u.test(normalized)
  );
}

function normalizeEventTypeForPreferences(value) {
  const normalized = normalizeText(String(value || ''));
  if (!normalized) return null;
  if (/(театр|спектакл|балет|опера)/u.test(normalized)) return 'театры';
  if (/(концерт|выступлен|музык)/u.test(normalized)) return 'концерты';
  if (/(выставк|экспозиц|галере)/u.test(normalized)) return 'выставки';
  if (/(стендап|стэндап|stand\s*-?\s*up)/u.test(normalized)) return 'стэндап';
  if (/(шоу|мюзикл)/u.test(normalized)) return 'шоу';
  if (/(кино|фильм)/u.test(normalized)) return 'кино';
  return null;
}

function extractPositiveFeedbackDetails(slotExtractionResult, positiveFeedbackIntent) {
  const detailsFromIntent =
    positiveFeedbackIntent && typeof positiveFeedbackIntent === 'object'
      ? positiveFeedbackIntent.eventDetails || positiveFeedbackIntent.details || null
      : null;

  const detailsFromSlot = Array.isArray(slotExtractionResult?.slots)
    ? slotExtractionResult.slots.find((s) => s && s.name === 'positive_feedback')?.eventDetails
    : null;

  const details = detailsFromIntent || detailsFromSlot || null;
  if (!details || typeof details !== 'object') {
    return null;
  }

  return {
    eventName: typeof details.eventName === 'string' ? details.eventName.trim() : null,
    eventType: typeof details.eventType === 'string' ? details.eventType.trim() : null,
    genre: typeof details.genre === 'string' ? details.genre.trim() : null,
  };
}

function hasMeaningfulSessionPreferenceContext(slots = []) {
  return (Array.isArray(slots) ? slots : []).some((slot) => {
    if (!slot || typeof slot.name !== 'string') {
      return false;
    }

    const normalizedName = slot.name.trim();
    if (!normalizedName || normalizedName === 'город') {
      return false;
    }

    return slot.value !== undefined && slot.value !== null && String(slot.value).trim() !== '';
  });
}

function shouldTreatAsContextualPositiveFeedback({
  userMessage = '',
  hasPositiveFeedbackIntent = false,
  hasPositiveFeedbackSlot = false,
  hasRecognizedIntent = false,
  hasRecentOfferContext = false,
  sessionSlots = [],
} = {}) {
  if (hasNegativeFeedback(userMessage)) {
    return false;
  }

  if (hasPositiveFeedbackIntent || hasPositiveFeedbackSlot) {
    return true;
  }

  if (hasRecognizedIntent) {
    return false;
  }

  if (!hasPositiveFeedback(userMessage)) {
    return false;
  }

  return Boolean(hasRecentOfferContext || hasMeaningfulSessionPreferenceContext(sessionSlots));
}

function persistPositiveFeedbackPreferences(userId, details) {
  if (!details || !userId) {
    return;
  }

  const tasks = [];

  const normalizedType = normalizeEventTypeForPreferences(details.eventType);
  if (normalizedType) {
    tasks.push(savePreference(userId, PREFERENCE_TYPES.EVENT_TYPE, normalizedType));
  }

  if (details.genre) {
    tasks.push(savePreference(userId, PREFERENCE_TYPES.GENRE, details.genre));
  }

  if (tasks.length === 0) {
    return;
  }

  Promise.allSettled(tasks).catch(() => null);
}

function dedupeEventTitlesPreservingCase(eventTitles = []) {
  const result = [];
  const seen = new Set();

  for (const rawTitle of Array.isArray(eventTitles) ? eventTitles : []) {
    const title = String(rawTitle || '').trim();
    const normalizedTitle = normalizeEventTitleValue(title);
    if (!title || !normalizedTitle || seen.has(normalizedTitle)) {
      continue;
    }

    seen.add(normalizedTitle);
    result.push(title);
  }

  return result;
}

function extractNegativeEventFeedbackDetails(negativeEventFeedbackIntent = null) {
  const details =
    negativeEventFeedbackIntent && typeof negativeEventFeedbackIntent === 'object'
      ? negativeEventFeedbackIntent.eventDetails || negativeEventFeedbackIntent.details || null
      : null;

  if (!details || typeof details !== 'object') {
    return null;
  }

  const rawEventNames = Array.isArray(details.eventNames)
    ? details.eventNames
    : Array.isArray(details.events)
      ? details.events.map((event) => event?.eventName || event?.title || event?.name || null)
      : [];
  const eventNames = dedupeEventTitlesPreservingCase(
    rawEventNames.map((eventName) => (typeof eventName === 'string' ? eventName.trim() : ''))
  );
  const eventName = typeof details.eventName === 'string' ? details.eventName.trim() : null;

  if (
    eventName &&
    !eventNames.some(
      (title) => normalizeEventTitleValue(title) === normalizeEventTitleValue(eventName)
    )
  ) {
    eventNames.unshift(eventName);
  }

  return {
    eventName,
    eventNames,
    eventType: typeof details.eventType === 'string' ? details.eventType.trim() : null,
  };
}

function formatQuotedEventTitles(eventTitles = []) {
  const normalizedTitles = dedupeEventTitlesPreservingCase(eventTitles);

  if (normalizedTitles.length === 0) {
    return '';
  }

  const quotedTitles = normalizedTitles.map((title) => `«${title}»`);
  if (quotedTitles.length === 1) {
    return quotedTitles[0];
  }
  if (quotedTitles.length === 2) {
    return `${quotedTitles[0]} и ${quotedTitles[1]}`;
  }
  return `${quotedTitles.slice(0, -1).join(', ')} и ${quotedTitles[quotedTitles.length - 1]}`;
}

function buildEventDislikeComplaintStartResponse(eventTitles = []) {
  const titlesText = formatQuotedEventTitles(eventTitles);
  const message = titlesText
    ? `Понял, варианты ${titlesText} больше не показываю. Что именно не подошло, чтобы следующий подбор был точнее?`
    : 'Понял, этот вариант больше не показываю. Что именно не подошло, чтобы следующий подбор был точнее?';

  return {
    replyKind: 'complaint_start',
    message,
    buttons: [...COMPLAINT_ROOT_BUTTONS],
    replyData: {
      eventTitles: dedupeEventTitlesPreservingCase(eventTitles),
    },
    offer: null,
  };
}

const POSITIVE_FEEDBACK_ACK_FALLBACK_TEMPLATES = Object.freeze([
  'Рад, что вам понравилось. Запомнил это. Хотите, подберу ещё похожие варианты?',
  'Отлично, беру это в ваши предпочтения. Показать ещё что-то похожее?',
  'Здорово, учту это на будущее. Хотите, найду ещё похожие варианты?',
  'Супер, запомнил, что вам это откликнулось. Подобрать ещё что-то в похожем духе?',
]);

function buildPositiveFeedbackAckFallbackResponse({
  userId = '',
  sessionId = '',
  userMessage = '',
} = {}) {
  const seed = `${userId}|${sessionId}|${userMessage}|positive_feedback_ack`;
  const template =
    pickVariant(POSITIVE_FEEDBACK_ACK_FALLBACK_TEMPLATES, seed) ||
    POSITIVE_FEEDBACK_ACK_FALLBACK_TEMPLATES[0];

  return {
    message: template,
    buttons: [...POSITIVE_FEEDBACK_ACK_BUTTONS],
    offer: null,
  };
}

function isSafePositiveFeedbackAckText(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (value.length > 220) return false;
  if (containsNonCyrillic(value)) return false;
  if (hasForbiddenAssistantFeminineSelfReference(value)) return false;

  const normalized = value.toLowerCase().replace(/ё/g, 'е');
  if (
    /(?<![A-Za-zА-Яа-яЁё0-9_])бот(?![A-Za-zА-Яа-яЁё0-9_])|(?<![A-Za-zА-Яа-яЁё0-9_])openai(?![A-Za-zА-Яа-яЁё0-9_])|(?<![A-Za-zА-Яа-яЁё0-9_])chatgpt(?![A-Za-zА-Яа-яЁё0-9_])|(?<![A-Za-zА-Яа-яЁё0-9_])gpt(?![A-Za-zА-Яа-яЁё0-9_])|(?<![A-Za-zА-Яа-яЁё0-9_])llm(?![A-Za-zА-Яа-яЁё0-9_])|(?<![A-Za-zА-Яа-яЁё0-9_])prompt(?![A-Za-zА-Яа-яЁё0-9_])/u.test(
      normalized
    )
  )
    return false;

  const hasFeedbackAck = /рад|здорово|отлично|супер|запомн|учту|предпочтен/i.test(normalized);
  const hasFollowUpQuestion =
    /похож|в\s+похожем\s+духе|еще|ещ[её].*(вариант|подбер|найд)/i.test(normalized) &&
    /[?？]/u.test(value);

  return hasFeedbackAck && hasFollowUpQuestion;
}

async function buildPositiveFeedbackAckResponseViaLlm({
  userId,
  sessionId,
  userMessage,
  requestId,
}) {
  const fallback = buildPositiveFeedbackAckFallbackResponse({ userId, sessionId, userMessage });
  const systemPrompt =
    'Ты ассистент Kassir.ru по подбору мероприятий.\n' +
    'Пользователь только что дал позитивный фидбек о предложенном событии.\n' +
    'Нужно коротко и тепло отреагировать, показать, что предпочтение учтено, и спросить, хочет ли он ещё похожие варианты.\n' +
    'Ограничения:\n' +
    '- максимум 2 коротких предложения;\n' +
    '- только русский язык, только кириллица;\n' +
    '- без упоминания моделей, технологий и устройства ассистента;\n' +
    '- без длинной благодарственной речи;\n' +
    '- обязательно закончи коротким вопросом про похожие варианты;\n' +
    '- верни строго JSON: {"text":"...","buttons":[]}.';

  try {
    const normalized = await requestAssistantMessage(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: String(userMessage || '').trim() || 'Мне понравилось.' },
      ],
      userId,
      sessionId,
      'positive_feedback_ack',
      1,
      0.85,
      requestId,
      160
    );

    const text = String(normalized?.text || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!isSafePositiveFeedbackAckText(text)) {
      console.warn(
        `⚠️ [${userId}][${sessionId}] POSITIVE_FEEDBACK_ACK: ответ LLM не прошёл safety-check, использую fallback`
      );
      return fallback;
    }

    return {
      message: text,
      buttons: [...POSITIVE_FEEDBACK_ACK_BUTTONS],
      offer: null,
    };
  } catch (error) {
    console.warn(
      `⚠️ [${userId}][${sessionId}] POSITIVE_FEEDBACK_ACK: ошибка при генерации через LLM, использую fallback`,
      error
    );
    return fallback;
  }
}

export {
  extractPriceCapFromText,
  parseBudgetSlotAmount,
  extractBudgetCapFromSlots,
  isRememberedBudgetQuestion,
  buildRememberedBudgetReply,
  isAuthoritativeIntent,
  isPreferenceMemoryConfirmationQuestion,
  shouldPreferPreferenceMemoryMetaRouting,
  buildPreferenceMemoryConfirmationFallbackResponse,
  isSafePreferenceMemoryConfirmationText,
  buildPreferenceMemoryConfirmationResponseViaLlm,
  wantsMoreOffersAfterFeedback,
  normalizeEventTypeForPreferences,
  extractPositiveFeedbackDetails,
  shouldTreatAsContextualPositiveFeedback,
  persistPositiveFeedbackPreferences,
  dedupeEventTitlesPreservingCase,
  extractNegativeEventFeedbackDetails,
  formatQuotedEventTitles,
  buildEventDislikeComplaintStartResponse,
  buildPositiveFeedbackAckResponseViaLlm,
};
