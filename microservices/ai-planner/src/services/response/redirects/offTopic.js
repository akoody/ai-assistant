import { OFF_TOPIC_INTENT_NAME } from '../intentPolicy.js';
import { normalizeText, escapeRegExp, hashToIndex, pickVariant } from '../textUtils.js';
import { renderTemplate } from './templates.js';
import { requestAssistantMessage } from '../gatewayClient.js';
import {
  containsNonCyrillic,
  containsAwkwardRussianPhrasing,
  hasForbiddenAssistantFeminineSelfReference,
} from '../../llm/assistantResponseUtils.js';
import { getOffTopicRedirectPrompt } from '../../configService.js';
import { getMessageHistory } from '../../messagesStorage.js';

const OFF_TOPIC_CONFIDENCE_THRESHOLD = 0.7;

function extractSlashCommand(text = '') {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^\/([a-z][a-z0-9_-]{0,63})(?:@\w+)?$/iu);
  if (!match) return null;

  return `/${String(match[1] || '').toLowerCase()}`;
}

function pickOffTopicIntent(intents = []) {
  if (!Array.isArray(intents)) return null;
  let best = null;
  intents.forEach((intent) => {
    if (!intent || intent.name !== OFF_TOPIC_INTENT_NAME) return;
    const confidence = typeof intent.confidence === 'number' ? intent.confidence : 1;
    const current = typeof best?.confidence === 'number' ? best.confidence : -Infinity;
    if (!best || confidence > current) best = intent;
  });
  if (!best) return null;
  if (best.confidence === undefined || best.confidence >= OFF_TOPIC_CONFIDENCE_THRESHOLD)
    return best;
  return null;
}

function shouldIgnoreOffTopicForTrustedUiAction({
  offTopicIntent = null,
  isQuickCategorySelection = false,
  isButtonEcho = false,
  isBuyTicketsUiCommand = false,
} = {}) {
  return Boolean(
    offTopicIntent && (isQuickCategorySelection || isButtonEcho || isBuyTicketsUiCommand)
  );
}

const OFF_TOPIC_BANNED_OPENINGS = Object.freeze([
  'это не совсем моя тема',
  'это не совсем по моей части',
  'по этой теме',
  'по этой части',
  'по такой теме',
  'по таким вопросам',
  'с таким вопросом я не подскажу',
  'я специализируюсь на мероприятиях',
]);

const OFF_TOPIC_DISRESPECTFUL_PATTERNS = Object.freeze([
  /(?:^|[^\p{L}\p{N}_])меня\s+не\s+интерес/u,
  /(?:^|[^\p{L}\p{N}_])мне\s+(?:это|такое|погода|новости|курс)\s+не\s+интерес/u,
  /(?:^|[^\p{L}\p{N}_])(?:погод[а-яё]*|новост[а-яё]*|курс[а-яё]*|доллар[а-яё]*|валют[а-яё]*|запрос|вопрос|тема)\s+не\s+интерес/u,
  /(?:^|[^\p{L}\p{N}_])(?:погод[а-яё]*|новост[а-яё]*|курс[а-яё]*|доллар[а-яё]*|валют[а-яё]*|запрос|вопрос|тема)\s+мне\s+не\s+интерес/u,
  /(?:^|[^\p{L}\p{N}_])это\s+не\s+моя\s+забот/u,
  /(?:^|[^\p{L}\p{N}_])(?:это|такая|эта)\s+не\s+моя\s+тем/u,
  /(?:^|[^\p{L}\p{N}_])мне\s+безразлич/u,
  /(?:^|[^\p{L}\p{N}_])(?:погод[а-яё]*|новост[а-яё]*|курс[а-яё]*|доллар[а-яё]*|валют[а-яё]*|запрос|вопрос|тема)\s+(?:мне\s+)?безразлич/u,
]);

const OFF_TOPIC_BUTTON_DUPLICATION_PATTERNS = Object.freeze([
  /концерт[а-яё]*\s*,\s*театр[а-яё]*/u,
  /театр[а-яё]*\s*,\s*выставк[а-яё]*/u,
  /выставк[а-яё]*\s*,\s*музе[а-яё]*/u,
  /концерт[а-яё]*\s*,\s*театр[а-яё]*\s+или\s+что(?:-|\s)?то\s+другое/u,
  /концерт[а-яё]*\s+или\s+выставк[а-яё]*/u,
]);

const OFF_TOPIC_TEMPLATE_SOURCE_PHRASES = Object.freeze([
  'по точному прогнозу погоды не подскажу',
  'по точному прогнозу погоды не помогу',
  'зато помогу выбрать мероприятие',
  'могу подобрать для вас интересное мероприятие',
  'что вас интересует больше всего',
  'чего вы хотели бы посмотреть сегодня',
]);

const OFF_TOPIC_STYLE_VARIANTS = Object.freeze([
  {
    key: 'concise',
    label: 'лаконичный живой',
    instruction:
      'Дайте короткий живой ответ без вводной тяжести. Быстро переведите разговор к афише.',
  },
  {
    key: 'warm',
    label: 'тёплый разговорный',
    instruction: 'Звучите по-человечески и мягко, но без сюсюканья и без штампов.',
  },
  {
    key: 'brisk',
    label: 'быстрый собранный',
    instruction: 'Держите бодрый темп и более короткий ритм фраз. Без канцелярита.',
  },
  {
    key: 'curator',
    label: 'спокойный куратор',
    instruction: 'Пишите как внимательный помощник по афише: спокойно, чисто, без служебного тона.',
  },
  {
    key: 'casual',
    label: 'легкий естественный',
    instruction: 'Сделайте ответ естественным и незажатым, будто это живая реплика в диалоге.',
  },
]);

const OFF_TOPIC_OPENING_FRAMES = Object.freeze({
  weather: [
    {
      key: 'weather_competence',
      instruction:
        'Построй начало через границу компетенции: ассистент не работает с внешними справочными данными, но помогает в рамках афиши.',
    },
    {
      key: 'weather_external_fact',
      instruction:
        'Построй начало через невозможность проверить внешний факт, без готовой фразы про прогноз и без ответа по сути погоды.',
    },
    {
      key: 'weather_soft_boundary',
      instruction:
        'Построй начало как мягкое ограничение по теме пользователя, затем плавно перейди к подбору досуга.',
    },
    {
      key: 'weather_external',
      instruction:
        'Построй начало без называния темы напрямую: обозначь внешний запрос и сразу предложи помощь по афише.',
    },
  ],
  generic: [
    {
      key: 'external_topic',
      instruction:
        'Построй начало через мягкое ограничение по внешней теме, затем естественно перейди к подбору мероприятий.',
    },
    {
      key: 'domain_help',
      instruction:
        'Построй начало через область реальной пользы ассистента: афиша и билеты, но без сухого служебного тона.',
    },
    {
      key: 'short_boundary',
      instruction:
        'Построй начало как короткую спокойную границу и затем отдельный переход к выбору события.',
    },
  ],
});

function normalizeOffTopicRedirectText(text = '') {
  const trimmed = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!trimmed) return '';

  return trimmed.replace(/^[а-яё]/u, (letter) => letter.toUpperCase());
}

function getOffTopicTemplateTokens(text = '') {
  return String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
}

function hasConsecutiveTokenOverlap(leftText = '', rightText = '', minLength = 4) {
  const leftTokens = getOffTopicTemplateTokens(leftText);
  const rightTokens = getOffTopicTemplateTokens(rightText);
  if (leftTokens.length < minLength || rightTokens.length < minLength) {
    return false;
  }

  const rightWindows = new Set();
  for (let index = 0; index <= rightTokens.length - minLength; index += 1) {
    rightWindows.add(rightTokens.slice(index, index + minLength).join(' '));
  }

  for (let index = 0; index <= leftTokens.length - minLength; index += 1) {
    if (rightWindows.has(leftTokens.slice(index, index + minLength).join(' '))) {
      return true;
    }
  }

  return false;
}

function getOffTopicOpeningText(text = '') {
  return normalizeOffTopicRedirectText(text).split(/[.!?]\s/u)[0] || '';
}

function hasPromptTemplatePhraseLeak(text = '') {
  const normalizedText = normalizeOffTopicRedirectText(text);
  return OFF_TOPIC_TEMPLATE_SOURCE_PHRASES.some((phrase) =>
    hasConsecutiveTokenOverlap(normalizedText, phrase, 4)
  );
}

function repeatsPreviousOffTopicOpeningFrame(text = '', previousAssistantText = '') {
  const currentOpening = getOffTopicOpeningText(text);
  const previousOpening = getOffTopicOpeningText(previousAssistantText);
  if (!currentOpening || !previousOpening) {
    return false;
  }

  const currentTokens = getOffTopicTemplateTokens(currentOpening);
  const previousTokens = getOffTopicTemplateTokens(previousOpening);
  if (currentTokens.length < 6 || previousTokens.length < 6) {
    return false;
  }

  if (
    currentTokens.length >= 3 &&
    previousTokens.length >= 3 &&
    currentTokens.slice(0, 3).join(' ') === previousTokens.slice(0, 3).join(' ')
  ) {
    return true;
  }

  const currentPrefix = currentTokens.slice(0, 8).join(' ');
  const previousPrefix = previousTokens.slice(0, 8).join(' ');
  return hasConsecutiveTokenOverlap(currentPrefix, previousPrefix, 4);
}

function stripOffTopicButtonCategoryDuplication(text = '') {
  let value = normalizeOffTopicRedirectText(text);
  if (!value) return '';

  const sentenceWithRepeatedButtonCategories =
    /(^|[.!?]\s+)[^.?!]*(?:концерт[а-яё]*|театр[а-яё]*|выставк[а-яё]*|музе[а-яё]*)[^.?!]*(?:концерт[а-яё]*|театр[а-яё]*|выставк[а-яё]*|музе[а-яё]*)[^.?!]*[.!?]?$/iu;

  while (sentenceWithRepeatedButtonCategories.test(value)) {
    const next = normalizeOffTopicRedirectText(
      value
        .replace(sentenceWithRepeatedButtonCategories, (match, delimiter = '') => delimiter.trim())
        .trim()
    );
    if (!next || next === value) break;
    value = next;
  }

  if (value && !/[?？]\s*$/u.test(value)) {
    const separator = /[.!…]\s*$/u.test(value) ? ' ' : '. ';
    value = normalizeOffTopicRedirectText(`${value}${separator}Что вам сейчас интереснее?`);
  }

  return value;
}

function buildOffTopicUserContent({ userMessage = '', slashCommand = null } = {}) {
  if (slashCommand) {
    return (
      'Пользователь прислал служебную slash-команду мессенджера. ' +
      'Считайте это нейтральным оффтоп-сообщением без предметного смысла. ' +
      'Не интерпретируйте название команды буквально.'
    );
  }

  return String(userMessage || '').trim() || 'Оффтоп-вопрос.';
}

function hasSlashCommandSemanticLeak(text = '') {
  const normalized = String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .trim();

  if (!normalized) return false;

  return [
    /(?<![A-Za-zА-Яа-яЁё0-9_])команд[аы](?![A-Za-zА-Яа-яЁё0-9_])/u,
    /\bslash\b/u,
    /\/(?:start|restart|info|go)\b/u,
    /начн[её]м\s+сначала/u,
    /начат[ьт]\s+сначала/u,
    /дава(?:й|йте)\s+сначала/u,
    /перезапуст/u,
    /заново\s+начн/u,
  ].some((pattern) => pattern.test(normalized));
}

function extractOffTopicPurchaseTarget(userMessage = '') {
  const source = String(userMessage || '')
    .replace(/[«»„“”"]/gu, '')
    .replace(/[.!?…]+$/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!source) {
    return '';
  }

  const match = source.match(
    /^(?:я\s+)?(?:хочу\s+купить|куплю|хотел(?:а)?\s+бы\s+купить|купить|приобрести|заказать)\s+(.{2,60})$/iu
  );
  if (!match) {
    return '';
  }

  const target = String(match[1] || '')
    .replace(/^(?:себе|мне|нам)\s+/iu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е');

  if (
    !target ||
    /(?:билет|мероприят|событи|афиш|концерт|спектакл|театр|выставк|музе)/iu.test(target)
  ) {
    return '';
  }

  return target;
}

function toSimpleRussianGenitivePhrase(value = '') {
  return String(value || '')
    .split(/\s+/u)
    .map((word, index, words) => {
      const clean = word.trim();
      if (!clean || index !== words.length - 1) {
        return clean;
      }

      if (/[ую]$/u.test(clean)) {
        return clean.replace(/[ую]$/u, (letter) => (letter === 'ю' ? 'и' : 'ы'));
      }

      return clean;
    })
    .join(' ')
    .trim();
}

function buildOffTopicPurchaseContextPhrase(userMessage = '') {
  const target = extractOffTopicPurchaseTarget(userMessage);
  if (!target) {
    return '';
  }

  const genitiveTarget = toSimpleRussianGenitivePhrase(target);
  return genitiveTarget ? `с покупкой ${genitiveTarget}` : '';
}

function buildOffTopicExternalContextPhrase(userMessage = '') {
  const purchaseContext = buildOffTopicPurchaseContextPhrase(userMessage);
  if (purchaseContext) {
    return purchaseContext;
  }

  const normalized = normalizeText(userMessage);
  if (/(?:погод|температур|прогноз|дожд|снег|ветер|мороз|жар[ауы]|осадк)/u.test(normalized)) {
    return 'с погодой';
  }
  if (/(?:курс|доллар|евро|валют|биткоин|акци|ипотек|кредит|налог)/u.test(normalized)) {
    return 'с финансовым вопросом';
  }
  if (/(?:новост|что\s+случилось|происход)/u.test(normalized)) {
    return 'с новостями';
  }
  if (/(?:код|алгоритм|python|javascript|sql|программирован|скрипт)/u.test(normalized)) {
    return 'с техническим вопросом';
  }

  return '';
}

function formatCityInPhrase(cityName = '') {
  const value = String(cityName || '').trim();
  if (!value) return '';

  const normalized = value.toLowerCase().replace(/ё/g, 'е');
  const knownForms = new Map([
    ['москва', 'в Москве'],
    ['санкт-петербург', 'в Санкт-Петербурге'],
    ['питер', 'в Санкт-Петербурге'],
    ['екатеринбург', 'в Екатеринбурге'],
    ['новосибирск', 'в Новосибирске'],
    ['казань', 'в Казани'],
    ['нижний новгород', 'в Нижнем Новгороде'],
    ['пенза', 'в Пензе'],
  ]);

  return knownForms.get(normalized) || `в городе ${value}`;
}

function hasQuotedOffTopicRequestOpening(responseText = '', userMessage = '') {
  const response = normalizeText(responseText)
    .replace(/[«»„“”"]/gu, '')
    .trim();
  const request = normalizeText(userMessage)
    .replace(/[«»„“”"]/gu, '')
    .replace(/[.!?…]+$/gu, '')
    .trim();
  if (!response || !request) {
    return false;
  }

  const purchaseTarget = extractOffTopicPurchaseTarget(userMessage);
  if (
    purchaseTarget &&
    new RegExp(
      `^(?:хочу\\s+купить|куплю|купить)\\s+${escapeRegExp(purchaseTarget)}(?:[?.!,]|\\s|$)`,
      'u'
    ).test(response)
  ) {
    return true;
  }

  if (
    response.startsWith(`${request}?`) ||
    response.startsWith(`${request}.`) ||
    response.startsWith(`${request},`)
  ) {
    return true;
  }

  const requestTokens = request.split(/\s+/u).filter(Boolean);
  if (requestTokens.length < 2) {
    return false;
  }

  const openingTokens = response.split(/\s+/u).slice(0, requestTokens.length);
  return requestTokens.every((token, index) => openingTokens[index] === token);
}

function pickOffTopicStyleVariant(seed = '', excludeKey = '') {
  const variants = OFF_TOPIC_STYLE_VARIANTS.filter((item) => item && item.key !== excludeKey);
  if (variants.length === 0) {
    return OFF_TOPIC_STYLE_VARIANTS[0];
  }

  return variants[hashToIndex(seed, variants.length)] || variants[0];
}

function pickOffTopicOpeningFrame({ userMessage = '', seed = '', excludeKey = '' } = {}) {
  const externalContext = buildOffTopicExternalContextPhrase(userMessage);
  const frameGroup =
    externalContext === 'с погодой'
      ? OFF_TOPIC_OPENING_FRAMES.weather
      : OFF_TOPIC_OPENING_FRAMES.generic;
  const variants = frameGroup.filter((item) => item && item.key !== excludeKey);
  if (variants.length === 0) {
    return frameGroup[0];
  }

  return variants[hashToIndex(seed, variants.length)] || variants[0];
}

function hasBannedOffTopicOpening(text = '') {
  const normalized = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е');

  if (!normalized) return false;
  return OFF_TOPIC_BANNED_OPENINGS.some((opening) => normalized.startsWith(opening));
}

function buildOffTopicRedirectResponse({
  normalizedCity = null,
  hasValidCity = false,
  seed = '',
  userMessage = '',
} = {}) {
  const quickButtons = ['Концерты', 'Театры', 'Выставки', 'Музеи', 'Покажи все'];
  const cityButtons = [
    'Москва',
    'Санкт-Петербург',
    'Екатеринбург',
    'Новосибирск',
    'Казань',
    'Нижний Новгород',
    'Другой город',
  ];
  const externalContext = buildOffTopicExternalContextPhrase(userMessage);
  const cityInPhrase = formatCityInPhrase(normalizedCity);

  const cityKnownTemplates =
    externalContext === 'с погодой'
      ? [
          'Погодные данные не проверяю, но помогу выбрать, куда сходить {cityIn}. Что вам сейчас интересно?',
          'С внешней справкой о погоде не помогу, но с афишей {cityIn} разберусь. Какой формат досуга подобрать?',
          'Погоду не рассчитываю, а варианты досуга {cityIn} подобрать могу. Что вам ближе?',
        ]
      : externalContext
        ? [
            '{externalContext} не помогу, зато могу подсказать, куда сходить {cityIn}. Что вам сейчас интересно?',
            '{externalContext} не сориентирую, но с афишей {cityIn} помогу. Какой формат показать?',
            '{externalContext} не подскажу, а варианты досуга {cityIn} подобрать могу. Что вам ближе?',
          ]
        : [
            'Не смогу подсказать по такому запросу, но могу помочь выбрать, куда сходить {cityIn}. Что вам сейчас интересно?',
            'Тут не подскажу, зато быстро сориентирую по афише {cityIn}. Что хотите посмотреть?',
            'С этим запросом не помогу, но могу собрать варианты по афише {cityIn}. Что вам интереснее?',
          ];

  const cityUnknownTemplates =
    externalContext === 'с погодой'
      ? [
          'Погодные данные не проверяю, но помогу подобрать событие. В каком городе ищем?',
          'С внешней справкой о погоде не помогу, но с афишей разберусь. В каком городе смотреть варианты?',
          'Погоду не рассчитываю, а с досугом помогу. Для какого города ищем?',
        ]
      : externalContext
        ? [
            '{externalContext} не помогу, зато могу подобрать событие. В каком городе ищем?',
            '{externalContext} не сориентирую, но с афишей помогу. В каком городе смотреть варианты?',
            '{externalContext} не подскажу, а с досугом помогу. Для какого города ищем?',
          ]
        : [
            'Не смогу подсказать по такому запросу, но с афишей помогу. В каком городе ищем?',
            'Тут не подскажу, зато могу подобрать мероприятие. В каком городе смотреть варианты?',
            'С таким запросом не помогу, но могу помочь с досугом. В каком городе будем искать?',
          ];

  const template =
    hasValidCity && normalizedCity
      ? pickVariant(cityKnownTemplates, `${seed}|cityKnown`)
      : pickVariant(cityUnknownTemplates, `${seed}|cityUnknown`);

  const message = normalizeOffTopicRedirectText(
    renderTemplate(template, {
      city: normalizedCity,
      cityIn: cityInPhrase,
      externalContext,
    })
  );

  return {
    message,
    buttons: hasValidCity && normalizedCity ? quickButtons : cityButtons,
    offer: null,
  };
}

async function classifyOffTopicViaLlmGate({ userId, sessionId, userMessage, requestId = null }) {
  const messages = [
    {
      role: 'system',
      content:
        'Ты бинарный классификатор для ассистента афиши Kassir.ru.\n' +
        'Определи, относится ли сообщение пользователя к подбору мероприятий/билетов.\n' +
        'Верни СТРОГО JSON: {"text":"OFF_TOPIC"} или {"text":"IN_SCOPE"}.\n' +
        'OFF_TOPIC: внешние темы (финансы, курс валют, погода, новости, программирование, общий справочник и т.п.).\n' +
        'IN_SCOPE: выбор мероприятий, билеты, жанры, афиша, куда сходить, уточнение по событиям.\n' +
        'Никаких пояснений и дополнительных полей.',
    },
    { role: 'user', content: String(userMessage || '').trim() || 'Пустое сообщение' },
  ];

  try {
    const normalized = await requestAssistantMessage(
      messages,
      userId,
      sessionId,
      'offtopic_gate',
      1,
      0.1,
      requestId,
      40
    );

    const decision = String(normalized?.text || '')
      .trim()
      .toUpperCase();
    if (decision === 'OFF_TOPIC') {
      return { isOffTopic: true, source: 'llm_gate' };
    }
    if (decision === 'IN_SCOPE') {
      return { isOffTopic: false, source: 'llm_gate' };
    }
  } catch (error) {
    console.warn(`⚠️ [${userId}][${sessionId}] OFFTOPIC_GATE: ошибка классификации`, error);
  }

  return { isOffTopic: false, source: 'llm_gate_fallback' };
}

function getOffTopicRedirectSafetyRejectionReason(
  text,
  {
    slashCommand = null,
    userMessage = '',
    previousAssistantText = '',
    previousAttemptText = '',
  } = {}
) {
  const normalizedSource = normalizeOffTopicRedirectText(text);
  const value = normalizedSource.toLowerCase().replace(/ё/g, 'е');
  if (!value) return 'empty';
  if (containsAwkwardRussianPhrasing(normalizedSource)) return 'awkward_russian';
  if (hasForbiddenAssistantFeminineSelfReference(normalizedSource))
    return 'forbidden_self_reference';
  if (hasQuotedOffTopicRequestOpening(normalizedSource, userMessage)) return 'quoted_user_request';
  if (hasPromptTemplatePhraseLeak(normalizedSource)) return 'template_phrase';
  if (
    previousAssistantText &&
    repeatsPreviousOffTopicOpeningFrame(normalizedSource, previousAssistantText)
  ) {
    return 'repeats_opening_frame';
  }
  if (
    previousAttemptText &&
    repeatsPreviousOffTopicOpeningFrame(normalizedSource, previousAttemptText)
  ) {
    return 'repeats_attempt_opening_frame';
  }

  if (/(?:^|[^\p{L}\p{N}_])бот(?=$|[^\p{L}\p{N}_])/u.test(value)) return 'mentions_bot';

  const forbiddenSecondPerson = [
    /(?:^|[^\p{L}\p{N}_])ты(?=$|[^\p{L}\p{N}_])/u,
    /(?:^|[^\p{L}\p{N}_])тебе(?=$|[^\p{L}\p{N}_])/u,
    /(?:^|[^\p{L}\p{N}_])тебя(?=$|[^\p{L}\p{N}_])/u,
    /(?:^|[^\p{L}\p{N}_])тобой(?=$|[^\p{L}\p{N}_])/u,
    /(?:^|[^\p{L}\p{N}_])твой(?=$|[^\p{L}\p{N}_])/u,
    /(?:^|[^\p{L}\p{N}_])твоя(?=$|[^\p{L}\p{N}_])/u,
    /(?:^|[^\p{L}\p{N}_])тво[её](?=$|[^\p{L}\p{N}_])/u,
    /(?:^|[^\p{L}\p{N}_])твои(?=$|[^\p{L}\p{N}_])/u,
  ];
  if (forbiddenSecondPerson.some((re) => re.test(value))) return 'uses_informal_you';

  if (hasBannedOffTopicOpening(normalizedSource)) return 'banned_opening';
  if (OFF_TOPIC_DISRESPECTFUL_PATTERNS.some((pattern) => pattern.test(value)))
    return 'disrespectful_tone';
  if (OFF_TOPIC_BUTTON_DUPLICATION_PATTERNS.some((pattern) => pattern.test(value)))
    return 'duplicates_button_categories';
  if (/меня\s+не\s+специализиру/u.test(value)) return 'broken_specialization_phrase';
  if (/какие\s+события\s+вам\s+сейчас\s+подойдут/u.test(value)) return 'awkward_event_question';
  if (/какое\s+событие\s+вас\s+больше\s+всего\s+заинтересует/u.test(value))
    return 'awkward_event_question';
  if (/чем\s+вам\s+сейчас\s+заинтересуетесь/u.test(value)) return 'awkward_event_question';
  if (/(?:^|[^\p{L}\p{N}_])с\s+(?:со|с)\s+/u.test(value)) return 'duplicate_preposition';

  if (containsNonCyrillic(normalizedSource)) return 'non_cyrillic';
  if (slashCommand && hasSlashCommandSemanticLeak(normalizedSource)) return 'slash_command_leak';

  return null;
}

function isSafeOffTopicRedirectText(text, options = {}) {
  return !getOffTopicRedirectSafetyRejectionReason(text, options);
}

async function buildOffTopicRedirectResponseViaLlm({
  userId,
  sessionId,
  userMessage,
  requestId,
  normalizedCity = null,
  hasValidCity = false,
  slashCommand = null,
  skipHistoryLookup = false,
}) {
  const quickButtons = ['Концерты', 'Театры', 'Выставки', 'Музеи', 'Покажи все'];
  const cityButtons = [
    'Москва',
    'Санкт-Петербург',
    'Екатеринбург',
    'Новосибирск',
    'Казань',
    'Нижний Новгород',
    'Другой город',
  ];
  const offTopicExternalContext = buildOffTopicExternalContextPhrase(userMessage);
  const isWeatherOffTopic = offTopicExternalContext === 'с погодой';
  const disrespectfulToneExamples = isWeatherOffTopic
    ? '"меня не интересует", "мне это не интересно", "погода не интересует", "это не моя забота"'
    : '"меня не интересует", "мне это не интересно", "эта тема не интересна", "это не моя забота"';
  const weatherSpecificGuidance = isWeatherOffTopic
    ? '- Для погодного запроса не используйте готовые формулы из инструкций. Меняйте способ отказа: область компетенции, внешний факт, мягкая граница по теме или переход от вопроса к афише.\n'
    : '';

  const fallbackSeed = `${userId}|${sessionId}|${userMessage}`;
  const styleSeed = `${userId}|${sessionId}|${requestId || ''}|${userMessage}|${Date.now()}|offtopic`;
  const primaryStyle = pickOffTopicStyleVariant(`${styleSeed}|primary`);
  const repairStyle = pickOffTopicStyleVariant(`${styleSeed}|repair`, primaryStyle?.key);
  const primaryOpeningFrame = pickOffTopicOpeningFrame({
    userMessage,
    seed: `${styleSeed}|opening-primary`,
  });
  const repairOpeningFrame = pickOffTopicOpeningFrame({
    userMessage,
    seed: `${styleSeed}|opening-repair`,
    excludeKey: primaryOpeningFrame?.key,
  });

  let lastAssistantText = '';
  if (!skipHistoryLookup) {
    try {
      const recentHistory = await getMessageHistory(userId, sessionId, 8);
      lastAssistantText = String(
        [...recentHistory].reverse().find((item) => item?.role === 'assistant')?.content || ''
      ).trim();
    } catch (historyError) {
      console.warn(
        `⚠️ [${userId}][${sessionId}] OFFTOPIC_REDIRECT: не удалось загрузить историю для антидубля`,
        historyError
      );
    }
  }
  const lastAssistantOpening = lastAssistantText
    ? String(lastAssistantText)
        .split(/[.!?]\s/u)[0]
        .slice(0, 120)
    : '';

  const rawPrompt = getOffTopicRedirectPrompt();
  let systemPrompt = String(rawPrompt || '').trim();
  if (!systemPrompt) {
    return buildOffTopicRedirectResponse({
      normalizedCity,
      hasValidCity,
      seed: fallbackSeed,
      userMessage,
    });
  }

  const contextHint =
    hasValidCity && normalizedCity
      ? `Город пользователя: ${normalizedCity}. Задай вопрос о том, какие мероприятия интересны в этом городе.`
      : 'Город пользователя НЕ известен. Задай вопрос «в каком городе ищем?» или аналогичный.';
  const buttonsForPrompt =
    hasValidCity && normalizedCity
      ? '"Концерты","Театры","Выставки","Музеи","Покажи все"'
      : '"Москва","Санкт-Петербург","Екатеринбург","Новосибирск","Казань","Нижний Новгород","Другой город"';

  systemPrompt = systemPrompt
    .replace('{contextHint}', contextHint)
    .replace('{buttonsJson}', buttonsForPrompt);
  systemPrompt +=
    '\n\nДополнительная установка на этот ответ:\n' +
    `- Стиль подачи: ${primaryStyle.label}. ${primaryStyle.instruction}\n` +
    `- Смысловая задача для первой фразы именно в этом ответе: ${primaryOpeningFrame.instruction}\n` +
    '- Это инструкция по смыслу, а не готовая строка для копирования. Сформулируйте своими словами, без дословного повторения примеров из промпта.\n' +
    (lastAssistantOpening
      ? `- Предыдущий ответ ассистента начинался так: "${lastAssistantOpening}". Не повторяйте это начало и не копируйте тот же синтаксический каркас.\n`
      : '') +
    '- Первая фраза должна заметно отличаться от самых типовых оффтоп-редиректов.\n' +
    '- Не начинайте сразу с афиши или города: сначала коротко обозначьте, что по внешнему запросу не помогаете, затем переведите к мероприятиям.\n' +
    '- В отказе кратко отразите тему вопроса пользователя, не отвечая по сути этой темы. Не уходите в полностью абстрактное "с этим запросом", если тему можно назвать естественно.\n' +
    '- Формулируйте отказ естественно и разнообразно: меняйте начало, переход к афише и финальный вопрос, не копируйте один каркас.\n' +
    '- Не цитируйте вопрос пользователя как заголовок или переспрос. Можно кратко назвать предмет запроса внутри отказа, если это звучит естественно.\n' +
    '- Не превращайте нейтральное "хочу ..." в покупку; про покупку говорите только при явной просьбе купить, приобрести или заказать.\n' +
    '- Не дублируйте в тексте категории из кнопок: кнопки уже будут отдельно.\n' +
    `- Тон должен быть уважительным и спокойным. Запрещены фразы ${disrespectfulToneExamples} и любые формулировки, где тема пользователя названа неинтересной.\n` +
    '- Не делайте тему пользователя подлежащим при словах "не интересует/не интересна/безразлична"; говорите о границе возможностей ассистента, а не о ценности темы пользователя.\n' +
    '- Смысл ответа: не "мне не интересна ваша тема", а "я не могу помочь с внешней темой, зато помогу с афишей".\n' +
    weatherSpecificGuidance +
    '- Не копируйте подряд 4 и более слова из инструкций, предыдущего ответа или собственной прошлой попытки. Замена одного глагола не делает ответ новым.\n' +
    '- Не перечисляйте категории из кнопок в тексте: не пишите "концерты, театры или что-то другое".\n' +
    '- Лучше задайте один короткий вопрос; не превращайте финал в серию уточнений.\n' +
    '- Перед отправкой проверьте грамматику, падежи и предлоги; если фраза звучит искусственно, перепишите проще.\n' +
    '- Не давайте определений в формате "<тема> — это ..." или "<термин> означает ...".\n';

  if (slashCommand) {
    systemPrompt +=
      '\n\nДополнительная установка:\n' +
      '- Пользователь прислал служебную slash-команду мессенджера.\n' +
      '- НЕ интерпретируйте название команды буквально.\n' +
      '- НЕ пишите про "начать сначала", "перезапустить", "команду", "меню", "кнопку", "/start", "/restart", "/info", "/go".\n' +
      '- Отвечайте так, будто это нейтральный оффтоп без предметного смысла.\n' +
      '- Нужен живой короткий редирект к афише без канцелярита.';
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: buildOffTopicUserContent({ userMessage, slashCommand }) },
  ];

  try {
    const MAX_ATTEMPTS = 3;
    let currentMessages = messages;
    let previousAttemptText = '';

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const normalized = await requestAssistantMessage(
        currentMessages,
        userId,
        sessionId,
        'offtopic_redirect',
        attempt,
        attempt === 1 ? 0.85 : 0.55,
        requestId,
        220,
        { noCache: true }
      );

      const rawText = normalizeOffTopicRedirectText(normalized?.text || '');
      const strippedText = stripOffTopicButtonCategoryDuplication(rawText);
      const text = strippedText;
      if (!normalized?.parsedFromJson || !text) {
        console.warn(
          `⚠️ [${userId}][${sessionId}] OFFTOPIC_REDIRECT: попытка ${attempt} — пустой/непарсимый ответ`
        );
        if (attempt < MAX_ATTEMPTS) {
          currentMessages = [
            ...currentMessages,
            { role: 'assistant', content: String(normalized?.raw || '{}') },
            {
              role: 'user',
              content:
                'Ответ пустой или не JSON. Сформируй нормальный ответ заново: строго JSON с непустым полем "text" и массивом "buttons". ' +
                'Сначала мягко скажи, что с внешней темой не поможешь, затем предложи подбор мероприятий. ' +
                'Не отвечай по сути внешней темы, не перечисляй категории в тексте.',
            },
          ];
        }
        continue;
      }

      if (strippedText !== rawText) {
        console.info(
          `ℹ️ [${userId}][${sessionId}] OFFTOPIC_REDIRECT: попытка ${attempt} — убрал дубли категорий из текста`
        );
      }
      const repeatsPreviousAssistant = Boolean(
        text && lastAssistantText && text === lastAssistantText
      );
      const repeatsPreviousAttempt = Boolean(
        text && previousAttemptText && text === previousAttemptText
      );
      const safetyRejectionReason = getOffTopicRedirectSafetyRejectionReason(text, {
        slashCommand,
        userMessage,
        allowedLeakText: normalizedCity || '',
        previousAssistantText: lastAssistantText,
        previousAttemptText,
      });

      if (!safetyRejectionReason && !repeatsPreviousAssistant && !repeatsPreviousAttempt) {
        if (attempt > 1) {
          console.info(
            `ℹ️ [${userId}][${sessionId}] OFFTOPIC_REDIRECT: попытка ${attempt} — текст прошёл проверку после коррекции`
          );
        }
        return {
          message: text,
          buttons: hasValidCity && normalizedCity ? quickButtons : cityButtons,
          offer: null,
        };
      }

      if (repeatsPreviousAssistant || repeatsPreviousAttempt) {
        console.warn(
          `⚠️ [${userId}][${sessionId}] OFFTOPIC_REDIRECT: попытка ${attempt} — ответ повторяет предыдущую формулировку`
        );
      } else {
        console.warn(
          `⚠️ [${userId}][${sessionId}] OFFTOPIC_REDIRECT: попытка ${attempt} — не прошёл safety-check (${safetyRejectionReason || 'unknown'}): "${text.slice(0, 80)}..."`
        );
      }
      previousAttemptText = text;

      if (attempt < MAX_ATTEMPTS) {
        const badJson = JSON.stringify({ text, buttons: [] });
        const weatherSpecificCorrection = isWeatherOffTopic
          ? 'Для погодного запроса не бери готовые формулы из инструкций; выбери другой способ формулировки ограничения. '
          : '';
        const correctionInstruction =
          'Перепиши ответ заново: только кириллица, без латинских букв, с заглавной буквы в начале. ' +
          'Пиши грамотным литературным русским языком, без буквальных или ломаных конструкций. ' +
          'Не используй заезженное начало и не повторяй прежний каркас. ' +
          `Смысловая задача для новой первой фразы: ${repairOpeningFrame.instruction} ` +
          'Это не готовая фраза для копирования; сформулируй своими словами. ' +
          'Сначала обозначь мягкое ограничение по внешнему запросу, затем переведи к мероприятиям. ' +
          `Пиши уважительно: не используй фразы ${disrespectfulToneExamples} и любые формулировки, где тема пользователя названа неинтересной. ` +
          'Не делай тему пользователя подлежащим при словах "не интересует/не интересна/безразлична"; говори о границе возможностей ассистента, а не о ценности темы пользователя. ' +
          'Смысл должен быть не "мне не интересна ваша тема", а "я не могу помочь с внешней темой, зато помогу с афишей". ' +
          weatherSpecificCorrection +
          'Не копируй подряд 4 и более слова из инструкций, предыдущего ответа или плохой попытки. Нужен новый синтаксис, не синонимы в старом порядке. ' +
          'Не начинай с цитаты или переспроса исходного запроса. Можно кратко назвать предмет запроса внутри отказа, но не пиши "с покупкой", если пользователь явно не просил купить. ' +
          'Исправь грамматику, не дублируй кнопки в тексте, не перечисляй категории из кнопок и оставь короткий финальный вопрос. ' +
          'Новый ответ должен заметно отличаться по первой фразе и ритму. ' +
          `Используйте ДРУГОЙ стиль подачи: ${repairStyle.label}. ${repairStyle.instruction} ` +
          (lastAssistantText
            ? `Не повторяйте формулировку "${lastAssistantText.slice(0, 80)}". `
            : '') +
          (slashCommand
            ? 'Не интерпретируйте slash-команду буквально и не пишите про "начать сначала", "перезапустить", "команду", "меню". '
            : '') +
          'Верни строго JSON того же формата.';
        currentMessages = [
          ...currentMessages,
          { role: 'assistant', content: badJson },
          { role: 'user', content: correctionInstruction },
        ];
      }
    }

    console.warn(
      `⚠️ [${userId}][${sessionId}] OFFTOPIC_REDIRECT: все ${MAX_ATTEMPTS} попытки не прошли проверку, использую шаблон`
    );
    return buildOffTopicRedirectResponse({
      normalizedCity,
      hasValidCity,
      seed: fallbackSeed,
      userMessage,
    });
  } catch (error) {
    console.warn(
      `⚠️ [${userId}][${sessionId}] OFFTOPIC_REDIRECT: ошибка при генерации через LLM, использую шаблон`,
      error
    );
    return buildOffTopicRedirectResponse({
      normalizedCity,
      hasValidCity,
      seed: fallbackSeed,
      userMessage,
    });
  }
}

export {
  extractSlashCommand,
  pickOffTopicIntent,
  shouldIgnoreOffTopicForTrustedUiAction,
  normalizeOffTopicRedirectText,
  stripOffTopicButtonCategoryDuplication,
  buildOffTopicUserContent,
  hasSlashCommandSemanticLeak,
  buildOffTopicRedirectResponse,
  classifyOffTopicViaLlmGate,
  getOffTopicRedirectSafetyRejectionReason,
  isSafeOffTopicRedirectText,
  buildOffTopicRedirectResponseViaLlm,
};
