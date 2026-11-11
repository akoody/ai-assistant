import { hashToIndex, pickVariant } from './textUtils.js';
import {
  EMPTY_PREFERENCES_BUTTONS,
  CITY_CHANGE_CATEGORY_BUTTONS,
  CLARIFICATION_DECLINE_BUTTONS,
} from './replyConstants.js';
import {
  containsNonCyrillic,
  hasForbiddenAssistantFeminineSelfReference,
} from '../llm/assistantResponseUtils.js';
import { requestAssistantMessage } from './gatewayClient.js';
import {
  renderTemplate,
  COMPLAINT_BANNED_OPENINGS,
  pickComplaintStyleVariant,
  isSafeComplaintFlowText,
} from './redirects.js';
import { formatQuotedEventTitles } from './preferenceFeedback.js';
import { getMessageHistory } from '../messagesStorage.js';

const EMPTY_PREFERENCES_FALLBACK_REPLIES = Object.freeze([
  'Пока я не знаю ваших предпочтений. Расскажите, что вам нравится, например: "люблю стендап в Москве", или выберите категорию ниже.',
  'Я пока не знаю, что вам нравится. Напишите пару примеров, например: "нравятся стендапы в Москве", либо выберите категорию ниже.',
  'Похоже, я ещё не знаю ваших предпочтений. Поделитесь, что вам нравится, или выберите категорию ниже.',
  'Я ещё не знаю ваши предпочтения. Напишите, что вам нравится, или выберите категорию ниже.',
]);

function buildEmptyPreferencesFallbackResponse({
  userId = '',
  sessionId = '',
  userMessage = '',
} = {}) {
  const seed = `${userId}|${sessionId}|${userMessage}|empty_preferences`;
  const deterministic = process.env.DETERMINISTIC_EMPTY_PREFERENCES === '1';
  const entropy = deterministic ? 'deterministic' : String(Date.now());
  const reply =
    EMPTY_PREFERENCES_FALLBACK_REPLIES[
      hashToIndex(`${seed}|${entropy}`, EMPTY_PREFERENCES_FALLBACK_REPLIES.length)
    ] || EMPTY_PREFERENCES_FALLBACK_REPLIES[0];

  return {
    message: reply,
    buttons: [...EMPTY_PREFERENCES_BUTTONS],
    offer: null,
  };
}

function isSafeEmptyPreferencesText(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (value.length > 260) return false;
  if (containsNonCyrillic(value)) return false;
  if (hasForbiddenAssistantFeminineSelfReference(value)) return false;

  const normalized = value.toLowerCase().replace(/ё/g, 'е');
  const forbidden = [
    /(?<![A-Za-zА-Яа-яЁё0-9_])бот(?![A-Za-zА-Яа-яЁё0-9_])/u,
    /\bopenai\b/u,
    /\bchatgpt\b/u,
    /\bgpt\b/u,
    /\bllm\b/u,
    /\bprompt\b/u,
  ];
  if (forbidden.some((re) => re.test(normalized))) return false;

  const hasPreferenceContext = /предпочт|нрав|люблю|интерес|категор|что\s+вам\s+нрав/i.test(
    normalized
  );
  const hasAction = /напиш|расскаж|подел|выбер/i.test(normalized);

  return hasPreferenceContext && hasAction;
}

async function buildEmptyPreferencesResponseViaLlm({ userId, sessionId, userMessage, requestId }) {
  const fallback = buildEmptyPreferencesFallbackResponse({ userId, sessionId, userMessage });
  const systemPrompt =
    'Ты ассистент Kassir.ru по подбору мероприятий.\n' +
    'Пользователь попросил подобрать по его предпочтениям, но сохранённых предпочтений пока нет.\n' +
    'Нужно ответить тепло и естественно, без однотипного шаблона.\n' +
    'Смысл ответа:\n' +
    '- коротко скажи, что предпочтения пока не известны;\n' +
    '- предложи написать, что нравится;\n' +
    '- можно привести ОДИН короткий пример вроде "люблю стендап в Москве";\n' +
    '- в конце можно мягко предложить выбрать категорию ниже.\n' +
    'Ограничения:\n' +
    '- максимум 2 коротких предложения;\n' +
    '- только русский язык, только кириллица;\n' +
    '- без упоминания моделей, промптов, технологий и устройства ассистента;\n' +
    '- не перечисляй кнопки полностью в тексте;\n' +
    '- верни строго JSON: {"text":"...","buttons":[]}.';

  try {
    const normalized = await requestAssistantMessage(
      [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: String(userMessage || '').trim() || 'Подбери по моим предпочтениям.',
        },
      ],
      userId,
      sessionId,
      'empty_preferences',
      1,
      0.85,
      requestId,
      180
    );

    const text = String(normalized?.text || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!isSafeEmptyPreferencesText(text)) {
      console.warn(
        `⚠️ [${userId}][${sessionId}] EMPTY_PREFERENCES: ответ LLM не прошёл safety-check, использую fallback`
      );
      return fallback;
    }

    return {
      message: text,
      buttons: [...EMPTY_PREFERENCES_BUTTONS],
      offer: null,
    };
  } catch (error) {
    console.warn(
      `⚠️ [${userId}][${sessionId}] EMPTY_PREFERENCES: ошибка при генерации через LLM, использую fallback`,
      error
    );
    return fallback;
  }
}

const CITY_CHANGE_CATEGORY_FALLBACK_TEMPLATES = Object.freeze([
  'Хорошо, ищем мероприятия в городе {city}. Какая категория вам интересна?',
  'Отлично, продолжаем поиск в городе {city}. Что хотите посмотреть?',
  'Город поменял. Теперь подберу варианты в городе {city}. С какой категории начнем?',
  'Хорошо, смотрим афишу в городе {city}. Что вам ближе: концерты, театры, выставки, музеи или стендап?',
]);

function buildCityChangeCategoryFallbackResponse({
  userId = '',
  sessionId = '',
  userMessage = '',
  cityName = '',
} = {}) {
  const seed = `${userId}|${sessionId}|${userMessage}|${cityName}|city_change_category`;
  const template =
    pickVariant(CITY_CHANGE_CATEGORY_FALLBACK_TEMPLATES, seed) ||
    CITY_CHANGE_CATEGORY_FALLBACK_TEMPLATES[0];

  return {
    message: renderTemplate(template, { city: cityName || 'выбранный город' }),
    buttons: [...CITY_CHANGE_CATEGORY_BUTTONS],
    offer: null,
  };
}

function isSafeCityChangeCategoryText(text, cityName = '') {
  const value = String(text || '').trim();
  if (!value) return false;
  if (value.length > 220) return false;
  if (containsNonCyrillic(value)) return false;
  if (hasForbiddenAssistantFeminineSelfReference(value)) return false;

  const normalized = value.toLowerCase().replace(/ё/g, 'е');
  const safeCity = String(cityName || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .trim();

  if (
    /(?<![A-Za-zА-Яа-яЁё0-9_])бот(?![A-Za-zА-Яа-яЁё0-9_])|(?<![A-Za-zА-Яа-яЁё0-9_])openai(?![A-Za-zА-Яа-яЁё0-9_])|(?<![A-Za-zА-Яа-яЁё0-9_])chatgpt(?![A-Za-zА-Яа-яЁё0-9_])|(?<![A-Za-zА-Яа-яЁё0-9_])gpt(?![A-Za-zА-Яа-яЁё0-9_])|(?<![A-Za-zА-Яа-яЁё0-9_])llm(?![A-Za-zА-Яа-яЁё0-9_])|(?<![A-Za-zА-Яа-яЁё0-9_])prompt(?![A-Za-zА-Яа-яЁё0-9_])/u.test(
      normalized
    )
  )
    return false;
  if (
    /(?<![A-Za-zА-Яа-яЁё0-9_])другой\s+город(?![A-Za-zА-Яа-яЁё0-9_])|(?<![A-Za-zА-Яа-яЁё0-9_])выберите\s+город(?![A-Za-zА-Яа-яЁё0-9_])|(?<![A-Za-zА-Яа-яЁё0-9_])укажите\s+город(?![A-Za-zА-Яа-яЁё0-9_])|(?<![A-Za-zА-Яа-яЁё0-9_])подскажите\s+город(?![A-Za-zА-Яа-яЁё0-9_])/u.test(
      normalized
    )
  )
    return false;
  if (safeCity && !normalized.includes(safeCity)) return false;

  return /категор|что\s+хотите\s+посмотр|что\s+вам\s+интерес|с\s+какой\s+категор/i.test(normalized);
}

function isStandaloneCityReply(userMessage = '', slots = []) {
  const normalizedMessage = String(userMessage || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .trim();
  if (!normalizedMessage) return false;

  const citySlots = (Array.isArray(slots) ? slots : []).filter(
    (slot) =>
      slot &&
      slot.name === 'город' &&
      slot.value !== undefined &&
      slot.value !== null &&
      String(slot.value).trim() !== ''
  );

  if (citySlots.length === 0) return false;

  const hasNonCitySlot = (Array.isArray(slots) ? slots : []).some(
    (slot) =>
      slot &&
      typeof slot.name === 'string' &&
      slot.name !== 'город' &&
      slot.value !== undefined &&
      slot.value !== null &&
      String(slot.value).trim() !== ''
  );
  if (hasNonCitySlot) return false;

  const tokens = normalizedMessage.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 4) return false;

  return citySlots.some((slot) => {
    const city = String(slot.value || '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .trim();
    if (!city) return false;

    return (
      normalizedMessage === city ||
      normalizedMessage === `в ${city}` ||
      normalizedMessage === `город ${city}` ||
      normalizedMessage === `г ${city}` ||
      normalizedMessage === `город ${city} пожалуйста`
    );
  });
}

async function buildCityChangeCategoryResponseViaLlm({
  userId,
  sessionId,
  userMessage,
  requestId,
  cityName,
}) {
  const fallback = buildCityChangeCategoryFallbackResponse({
    userId,
    sessionId,
    userMessage,
    cityName,
  });
  const safeCity = String(cityName || '').trim() || 'выбранный город';
  const systemPrompt =
    'Ты ассистент Kassir.ru по подбору мероприятий.\n' +
    `Пользователь только что сменил город на "${safeCity}" и пока не задал других критериев.\n` +
    'Нужно коротко и естественно подтвердить новый город и мягко спросить, какая категория мероприятий интересна.\n' +
    'Ограничения:\n' +
    '- максимум 2 коротких предложения;\n' +
    '- только русский язык, только кириллица;\n' +
    '- обязательно упомяни новый город;\n' +
    '- не проси выбрать город снова;\n' +
    '- не перечисляй все кнопки полностью;\n' +
    '- без упоминания моделей, технологий и устройства ассистента;\n' +
    '- верни строго JSON: {"text":"...","buttons":[]}.';

  try {
    const normalized = await requestAssistantMessage(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: String(userMessage || '').trim() || `Ищем в городе ${safeCity}.` },
      ],
      userId,
      sessionId,
      'city_change_category',
      1,
      0.8,
      requestId,
      180
    );

    const text = String(normalized?.text || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!isSafeCityChangeCategoryText(text, safeCity)) {
      console.warn(
        `⚠️ [${userId}][${sessionId}] CITY_CHANGE_CATEGORY: ответ LLM не прошёл safety-check, использую fallback`
      );
      return fallback;
    }

    return {
      message: text,
      buttons: [...CITY_CHANGE_CATEGORY_BUTTONS],
      offer: null,
    };
  } catch (error) {
    console.warn(
      `⚠️ [${userId}][${sessionId}] CITY_CHANGE_CATEGORY: ошибка при генерации через LLM, использую fallback`,
      error
    );
    return fallback;
  }
}

const CLARIFICATION_DECLINE_FALLBACK_TEMPLATES = Object.freeze([
  'Хорошо. Что тогда вы хотите найти?',
  'Понял, сменим направление. Что вам сейчас интересно?',
  'Без проблем. Тогда давайте выберем другое направление. Что хотите посмотреть?',
  'Хорошо, не будем на этом останавливаться. Что вам ближе сейчас?',
]);

function buildClarificationDeclineFallbackResponse({
  userId = '',
  sessionId = '',
  userMessage = '',
} = {}) {
  const seed = `${userId}|${sessionId}|${userMessage}|clarification_decline`;
  const template =
    pickVariant(CLARIFICATION_DECLINE_FALLBACK_TEMPLATES, seed) ||
    CLARIFICATION_DECLINE_FALLBACK_TEMPLATES[0];

  return {
    message: template,
    buttons: [...CLARIFICATION_DECLINE_BUTTONS],
    offer: null,
  };
}

function isSafeClarificationDeclineText(text) {
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
  if (/(?<![A-Za-zА-Яа-яЁё0-9_])город(?![A-Za-zА-Яа-яЁё0-9_])/u.test(normalized)) return false;

  return /что\s+(?:вам|вы)\s+(?:сейчас\s+)?(?:интерес|хотите\s+посмотр|хотите\s+найти)|выбер(?:ем|ите)\s+друг/i.test(
    normalized
  );
}

async function buildClarificationDeclineResponseViaLlm({
  userId,
  sessionId,
  userMessage,
  requestId,
}) {
  const fallback = buildClarificationDeclineFallbackResponse({ userId, sessionId, userMessage });
  const systemPrompt =
    'Ты ассистент Kassir.ru по подбору мероприятий.\n' +
    'Пользователь ответил "нет" в середине уточняющего сценария.\n' +
    'Нужно мягко свернуть текущее уточнение и предложить выбрать другое направление поиска.\n' +
    'Ограничения:\n' +
    '- максимум 2 коротких предложения;\n' +
    '- только русский язык, только кириллица;\n' +
    '- не упоминай город, технологии, модель или устройство ассистента;\n' +
    '- не дави и не извиняйся слишком формально;\n' +
    '- мягко верни пользователя к выбору категории;\n' +
    '- верни строго JSON: {"text":"...","buttons":[]}.';

  try {
    const normalized = await requestAssistantMessage(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: String(userMessage || '').trim() || 'Нет.' },
      ],
      userId,
      sessionId,
      'clarification_decline',
      1,
      0.8,
      requestId,
      160
    );

    const text = String(normalized?.text || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!isSafeClarificationDeclineText(text)) {
      console.warn(
        `⚠️ [${userId}][${sessionId}] CLARIFICATION_DECLINE: ответ LLM не прошёл safety-check, использую fallback`
      );
      return fallback;
    }

    return {
      message: text,
      buttons: [...CLARIFICATION_DECLINE_BUTTONS],
      offer: null,
    };
  } catch (error) {
    console.warn(
      `⚠️ [${userId}][${sessionId}] CLARIFICATION_DECLINE: ошибка при генерации через LLM, использую fallback`,
      error
    );
    return fallback;
  }
}

function buildComplaintFlowInstruction({ replyKind = '', replyData = {} } = {}) {
  const genresText =
    Array.isArray(replyData?.genres) && replyData.genres.length > 0
      ? replyData.genres.join(', ')
      : '';
  const maxBudget = Number.isFinite(replyData?.maxBudget) ? replyData.maxBudget : null;
  const dislikedTitlesText =
    Array.isArray(replyData?.eventTitles) && replyData.eventTitles.length > 0
      ? formatQuotedEventTitles(replyData.eventTitles)
      : '';

  switch (replyKind) {
    case 'complaint_start':
      return [
        dislikedTitlesText
          ? `Пользователь пожаловался на конкретное событие или события: ${dislikedTitlesText}.`
          : 'Пользователь пожаловался на прошлую подборку.',
        'Нужно по-человечески признать неудачный опыт, показать желание исправиться и только потом спросить, что именно не подошло.',
        'Тон должен быть внимательным и включенным, без ощущения, что ассистенту все равно.',
        'Для этого шага нужен ровно один вопрос про причину отказа: что не подошло, что смутило, это из-за жанра, цены или чего-то еще.',
        dislikedTitlesText
          ? `Можно коротко назвать ${dislikedTitlesText}, но только если это звучит естественно и не превращает ответ в шаблон.`
          : 'Не перечисляй отвергнутые события, если их названия не нужны для естественного звучания.',
        'Не перечисляй варианты в тексте: выбор уже вынесен в кнопки.',
        'Не хвали отвергнутые пользователем события и не объясняй, что они "на самом деле хорошие".',
        'Не предлагай новые жанры, форматы и шоу до того, как пользователь ответит, что именно не подошло.',
      ].join('\n');
    case 'complaint_genre_menu':
      return [
        'Пользователь уточнил, что проблема была в жанре.',
        'Нужно поблагодарить за уточнение и мягко спросить, какие жанры точно не подходят.',
        'Важно звучать заинтересованно, как будто вы реально настраиваете следующий подбор точнее.',
        'Не предлагай новые вопросы сверх жанров.',
      ].join('\n');
    case 'complaint_price_menu':
      return [
        'Пользователь уточнил, что проблема была в цене.',
        'Нужно показать, что замечание услышано, и мягко перевести разговор к комфортному бюджету.',
        'Не перечисляй кнопки дословно и не уходи в другие параметры.',
      ].join('\n');
    case 'complaint_venue_menu':
      return [
        'Пользователь уточнил, что проблема была в месте.',
        'Нужно признать замечание и спросить, какие площадки, районы или локации не подходят.',
        'Не уводи разговор в другие параметры.',
      ].join('\n');
    case 'complaint_other_menu':
      return [
        'Пользователь выбрал категорию "другое".',
        'Нужно попросить коротко описать, что именно не понравилось, и дать понять, что это поможет сделать следующий подбор лучше.',
      ].join('\n');
    case 'complaint_genre_prompt':
      return [
        'Нужно попросить пользователя перечислить нежелательные жанры простым живым языком.',
        'Примеров много не давай, максимум один короткий намёк на формат списка.',
      ].join('\n');
    case 'complaint_price_prompt':
      return [
        'Нужно попросить пользователя написать комфортный бюджет живо и без канцелярита.',
        'Можно дать один короткий пример формата вроде "до 2000 рублей".',
      ].join('\n');
    case 'complaint_venue_prompt':
      return [
        'Нужно попросить пользователя перечислить места, площадки или районы, которые не подходят.',
        'Фраза должна звучать естественно, без оборотов вроде "напишите, пожалуйста".',
      ].join('\n');
    case 'complaint_other_prompt':
      return [
        'Нужно попросить пользователя в двух словах описать, что не понравилось.',
        'Сделай это тепло и без сухих вводных.',
      ].join('\n');
    case 'complaint_genre_resolved':
      return [
        genresText
          ? `Нужно естественно подтвердить, что жанры "${genresText}" больше не будут использоваться в подборе.`
          : 'Нужно естественно подтвердить, что это будет учтено в дальнейшем подборе.',
        'После подтверждения мягко пригласи выбрать, с чего продолжить поиск.',
        'Не начинай с шаблонов вроде "Спасибо, учту". Лучше показать уверенность, что следующий подбор будет точнее.',
      ].join('\n');
    case 'complaint_price_resolved':
      return [
        maxBudget
          ? `Нужно подтвердить, что ориентир по бюджету теперь до ${maxBudget} рублей.`
          : 'Нужно подтвердить, что замечание по цене учтено.',
        'После этого мягко предложи продолжить новый подбор.',
      ].join('\n');
    case 'complaint_venue_resolved':
      return [
        'Нужно живо и спокойно сказать, что замечание по месту учтено.',
        'После этого предложи продолжить новый подбор.',
      ].join('\n');
    case 'complaint_other_resolved':
      return ['Нужно подтвердить, что замечание учтено, и вернуть к новому подбору.'].join('\n');
    case 'complaint_restart':
      return [
        'Пользователь хочет начать заново.',
        'Нужно спокойно переключиться на новый поиск и дать ощущение нового старта без сухой служебной фразы.',
        'Если пользователь выбрал "с чистого листа", можно коротко обозначить, что прошлые предпочтения и контекст больше не учитываются.',
      ].join('\n');
    default:
      return 'Нужно естественно и внимательно провести пользователя по сценарию жалобы без лишних вопросов.';
  }
}

async function buildComplaintFlowResponseViaLlm({
  userId,
  sessionId,
  userMessage,
  requestId,
  fallbackResponse,
}) {
  const fallback = {
    message: String(fallbackResponse?.message || '').trim(),
    buttons: Array.isArray(fallbackResponse?.buttons) ? [...fallbackResponse.buttons] : [],
    offer: null,
  };

  const replyKind = String(fallbackResponse?.replyKind || '').trim();
  if (!replyKind) {
    return fallback;
  }

  const history = await getMessageHistory(userId, sessionId);
  const lastAssistantText = Array.isArray(history)
    ? [...history].reverse().find((item) => item?.role === 'assistant' && item?.content)?.content ||
      ''
    : '';

  const styleSeed = `${userId}|${sessionId}|${requestId || ''}|${replyKind}|${userMessage}|${Date.now()}`;
  const primaryStyle = pickComplaintStyleVariant(`${styleSeed}|primary`);
  const repairStyle = pickComplaintStyleVariant(`${styleSeed}|repair`, primaryStyle?.key);
  const plainTextStyle = pickComplaintStyleVariant(
    `${styleSeed}|plain_text`,
    repairStyle?.key || primaryStyle?.key
  );
  const buttonsHint = JSON.stringify(fallback.buttons);
  const bannedOpeningsHint = COMPLAINT_BANNED_OPENINGS.map((item) => `"${item}"`).join(', ');
  const scenarioInstruction = buildComplaintFlowInstruction({
    replyKind,
    replyData: fallbackResponse?.replyData || {},
  });

  const buildSystemPrompt = (style) =>
    [
      'Ты LLM-ассистент Kassir.ru по подбору мероприятий.',
      'Нужно ответить живо и по-человечески, без ощущения заскриптованной реплики.',
      'В сценарии жалобы особенно важно показать участие: пользователь должен почувствовать, что его услышали и что ассистент хочет исправить впечатление.',
      scenarioInstruction,
      `Стиль подачи: ${style.label}. ${style.instruction}`,
      lastAssistantText
        ? `Последняя реплика ассистента в этой сессии: "${String(lastAssistantText).replace(/\s+/g, ' ').trim()}". Не повторяй её начало, лексику и ритм.`
        : 'Сформулируй ответ свежо, без повторения типовой заготовки.',
      `Не начинай ответ с таких фраз: ${bannedOpeningsHint}.`,
      'Ограничения:',
      '- обычно 2-3 коротких предложения;',
      '- только русский язык, только кириллица;',
      '- не упоминай модели, промпты, технологии и внутреннее устройство ассистента;',
      '- не добавляй новые вопросы сверх текущего шага сценария;',
      '- не перечисляй кнопки дословно в тексте;',
      '- не пиши сухие заходы вроде "Понял", "Хорошо", "Напишите, пожалуйста" как самостоятельную первую фразу;',
      '- не звучи равнодушно, формально или как оператор поддержки;',
      '- не используй ломаные обороты вроде "их не подошло", "видите ли", "рад уделить внимание вашим предпочтениям";',
      replyKind === 'complaint_start'
        ? '- для complaint_start нельзя спрашивать, какой жанр пользователь хочет теперь, что искать дальше или что ему подобрать; нужно спросить только, что именно не подошло в отвергнутом варианте.'
        : '- держись только текущего шага сценария.',
      `- кнопки уже заданы отдельно и менять их нельзя: ${buttonsHint};`,
      '- верни строго JSON: {"text":"...","buttons":[]}.',
    ].join('\n');
  const buildPlainTextPrompt = (style) =>
    [
      'Ты LLM-ассистент Kassir.ru по подбору мероприятий.',
      'Нужно ответить живо и по-человечески, без ощущения заскриптованной реплики.',
      'Это аварийный recovery-режим: предыдущие JSON-ответы сломались, поэтому теперь нужен только короткий текст.',
      scenarioInstruction,
      `Стиль подачи: ${style.label}. ${style.instruction}`,
      lastAssistantText
        ? `Последняя реплика ассистента в этой сессии: "${String(lastAssistantText).replace(/\s+/g, ' ').trim()}". Не повторяй её начало, лексику и ритм.`
        : 'Сформулируй ответ свежо, без повторения типовой заготовки.',
      `Не начинай ответ с таких фраз: ${bannedOpeningsHint}.`,
      'Ограничения:',
      '- только русский язык, только кириллица;',
      '- максимум 2-3 коротких предложения;',
      '- не используй JSON, markdown, списки и подписи кнопок;',
      '- не упоминай модели, промпты, технологии и внутреннее устройство ассистента;',
      '- не перечисляй кнопки дословно в тексте;',
      '- не меняй смысл текущего шага сценария;',
      replyKind === 'complaint_start'
        ? '- для complaint_start задай только вопрос о том, что именно не подошло, без ухода в новый подбор.'
        : '- держись только текущего шага сценария.',
      '- верни только текст ответа, без JSON и без дополнительных полей.',
    ].join('\n');

  const baseMessages = [
    { role: 'system', content: buildSystemPrompt(primaryStyle) },
    { role: 'user', content: String(userMessage || '').trim() || 'Продолжи сценарий жалобы.' },
  ];

  try {
    const normalized = await requestAssistantMessage(
      baseMessages,
      userId,
      sessionId,
      'complaint_flow',
      1,
      0.9,
      requestId,
      220
    );

    const rawPayload = String(normalized?.raw || '').trim();
    const primaryReturnedEmptyJson =
      rawPayload === '{}' || rawPayload === '{"text":"","buttons":[]}';
    if (primaryReturnedEmptyJson) {
      console.warn(
        `⚠️ [${userId}][${sessionId}] COMPLAINT_FLOW: LLM вернула пустой JSON, запускаю repair-попытку`
      );
    }

    const text = String(normalized?.text || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (isSafeComplaintFlowText(text, { replyKind })) {
      return {
        message: text,
        buttons: [...fallback.buttons],
        offer: null,
      };
    }

    const repairMessages = [
      {
        role: 'system',
        content: buildSystemPrompt(repairStyle),
      },
      { role: 'user', content: String(userMessage || '').trim() || 'Продолжи сценарий жалобы.' },
      ...(normalized?.raw ? [{ role: 'assistant', content: String(normalized.raw) }] : []),
      {
        role: 'user',
        content:
          replyKind === 'complaint_start'
            ? 'Перепиши ответ живее, теплее и естественнее. Можно в 2-3 коротких предложениях. Не используй шаблонные заходы, не повторяй прошлую реплику и не меняй смысл текущего шага. В финале задай только вопрос о том, что именно не подошло в отвергнутом варианте, без нового подбора жанра или формата.'
            : 'Перепиши ответ живее, теплее и естественнее. Можно в 2-3 коротких предложениях. Не используй шаблонные заходы, не повторяй прошлую реплику и не меняй смысл текущего шага.',
      },
    ];

    const repaired = await requestAssistantMessage(
      repairMessages,
      userId,
      sessionId,
      'complaint_flow_repair',
      1,
      0.78,
      requestId,
      220
    );

    const repairedRawPayload = String(repaired?.raw || '').trim();
    const repairedReturnedEmptyJson =
      repairedRawPayload === '{}' || repairedRawPayload === '{"text":"","buttons":[]}';
    const repairedText = String(repaired?.text || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (isSafeComplaintFlowText(repairedText, { replyKind })) {
      return {
        message: repairedText,
        buttons: [...fallback.buttons],
        offer: null,
      };
    }

    if (primaryReturnedEmptyJson || repairedReturnedEmptyJson) {
      console.warn(
        `⚠️ [${userId}][${sessionId}] COMPLAINT_FLOW: JSON-режим вернул пустой ответ, пробую plain-text recovery`
      );

      const plainTextMessages = [
        {
          role: 'system',
          content: buildPlainTextPrompt(plainTextStyle),
        },
        { role: 'user', content: String(userMessage || '').trim() || 'Продолжи сценарий жалобы.' },
      ];

      const plainTextRecovery = await requestAssistantMessage(
        plainTextMessages,
        userId,
        sessionId,
        'complaint_flow_plaintext_recovery',
        1,
        0.7,
        requestId,
        180
      );

      const plainText = String(plainTextRecovery?.text || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (isSafeComplaintFlowText(plainText, { replyKind })) {
        return {
          message: plainText,
          buttons: [...fallback.buttons],
          offer: null,
        };
      }
    }
  } catch (error) {
    console.warn(
      `⚠️ [${userId}][${sessionId}] COMPLAINT_FLOW: ошибка при генерации через LLM, использую fallback`,
      error
    );
  }

  return fallback;
}

export {
  buildEmptyPreferencesResponseViaLlm,
  isStandaloneCityReply,
  buildCityChangeCategoryResponseViaLlm,
  buildClarificationDeclineResponseViaLlm,
  buildComplaintFlowResponseViaLlm,
};
