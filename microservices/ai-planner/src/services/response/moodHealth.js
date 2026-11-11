import {
  normalizeText,
  hashToIndex,
  pickVariant,
  normalizeClarificationTextForMatch,
  normalizeComplaintText,
} from './textUtils.js';
import { DEFAULT_CITY_SELECTION_BUTTONS } from './replyConstants.js';
import {
  containsNonCyrillic,
  hasForbiddenAssistantFeminineSelfReference,
  removeChineseCharacters,
  containsChineseCharacters,
} from '../llm/assistantResponseUtils.js';
import { getMessageHistory } from '../messagesStorage.js';
import { requestAssistantMessage } from './gatewayClient.js';
import { isShowAllSearchQueryValue } from './slotUtils.js';
import { buildSearchPlanFromSlots } from '../offerService.js';

const MOOD_CITY_STYLE_VARIANTS = Object.freeze([
  {
    key: 'light',
    label: 'лёгкий и живой',
    instruction: 'Звучите по-человечески, легко и без рекламного пафоса.',
  },
  {
    key: 'curator',
    label: 'деликатный куратор',
    instruction:
      'Говорите как внимательный помощник по афише: спокойно, уверенно и без канцелярита.',
  },
  {
    key: 'direct',
    label: 'короткий и собранный',
    instruction: 'Давайте очень короткий, естественный ответ без лишних вводных слов.',
  },
  {
    key: 'warm',
    label: 'тёплый и разговорный',
    instruction: 'Ответ должен ощущаться дружелюбным, но не приторным и не заскриптованным.',
  },
]);

const MOOD_CITY_BANNED_OPENINGS = Object.freeze([
  'вижу у вас много энергии',
  'вижу, у вас много энергии',
  'для выплеска энергии',
  'что вам больше по душе',
  'что больше по душе',
  'с удовольствием помогу',
]);

const MOOD_CITY_RESPONSE_VARIANTS = Object.freeze({
  fun: [
    'Подберу что-нибудь веселое. Для начала скажите, в каком городе ищем.',
    'Можно собрать что-то действительно веселое. В каком городе подобрать варианты?',
    'Есть идеи на что-то веселое и живое. В каком городе искать?',
  ],
  energy: [
    'Подберу что-то бодрое и с хорошим темпом. В каком городе искать?',
    'Можно собрать подборку поэнергичнее. В каком городе вам подобрать варианты?',
    'Есть идеи на что-то мощнее и живее. В каком городе будем искать?',
  ],
  calm: [
    'Подберу что-то спокойное и приятное. В каком городе искать?',
    'Можно собрать более спокойную подборку. Для начала выберем город?',
    'Есть варианты на более тихий вечер. В каком городе вам их подобрать?',
  ],
  intellectual: [
    'Подберу что-то интересное и содержательное. В каком городе искать?',
    'Можно собрать более интеллектуальную подборку. В каком городе вам подобрать варианты?',
    'Есть идеи на что-то познавательное. В каком городе будем искать?',
  ],
  unusual: [
    'Подберу что-то необычное. Сначала выберем город?',
    'Можно собрать подборку с более нестандартными вариантами. В каком городе искать?',
    'Есть идеи на что-то неочевидное и свежее. В каком городе вам подобрать варианты?',
  ],
  romantic: [
    'Подберу что-то с романтичным настроением. В каком городе искать?',
    'Можно собрать варианты для более романтичного вечера. В каком городе вам подобрать их?',
    'Есть идеи на что-то для двоих. В каком городе будем искать?',
  ],
  comfort: [
    'Подберу что-то полегче и потеплее по настроению. В каком городе искать?',
    'Можно собрать мягкую, поддерживающую подборку. В каком городе вам подобрать варианты?',
    'Есть идеи на что-то, что поможет немного выдохнуть. В каком городе будем искать?',
  ],
  rest: [
    'Подберу что-то без лишнего шума. В каком городе искать?',
    'Можно собрать спокойную подборку, чтобы выдохнуть. В каком городе вам подобрать варианты?',
    'Есть идеи на более расслабленный вечер. В каком городе будем искать?',
  ],
  angry: [
    'Подберу что-то с более сильной энергией. В каком городе искать?',
    'Можно собрать подборку понапористее. В каком городе вам подобрать варианты?',
    'Есть идеи на что-то погромче и мощнее. В каком городе будем искать?',
  ],
  bored: [
    'Подберу что-то поярче, чтобы не было скучно. В каком городе искать?',
    'Можно собрать подборку поинтереснее и поживее. В каком городе вам подобрать варианты?',
    'Есть идеи на что-то, что встряхнет вечер. В каком городе будем искать?',
  ],
  fallback: [
    'Подберу что-то под ваше настроение. В каком городе искать?',
    'Можно собрать подборку под это настроение. Для начала выберем город?',
    'Есть несколько хороших идей под такой запрос. В каком городе будем искать?',
  ],
});

const HEALTH_COMPLAINT_ALLOWED_CATEGORY_BUTTONS = Object.freeze([
  'Найти концерт',
  'Найти театр',
  'Найти выставку',
  'Найти музей',
  'Найти стендап',
  'Найти спортивное событие',
]);

const HEALTH_COMPLAINT_DECLINE_BUTTON = 'Может, позже';

const HEALTH_COMPLAINT_DEFAULT_BUTTONS = Object.freeze([
  'Найти концерт',
  'Найти выставку',
  'Найти театр',
  HEALTH_COMPLAINT_DECLINE_BUTTON,
]);

function normalizeMoodPromptKey(value = '') {
  const normalized = normalizeText(value);
  if (!normalized) return 'fallback';

  if (
    /(весел|повесел|смеш|юмор|комед|радост|задор|посме|смех|смея|рассмеш|хохот)/u.test(normalized)
  )
    return 'fun';
  if (/(энерг|актив|драйв|динамич|заряд|тус|движ)/u.test(normalized)) return 'energy';
  if (/(спокой|расслаб|тих|уют|умиротвор|медлен)/u.test(normalized)) return 'calm';
  if (/(интеллект|умн|позн|узнат|культур|образов|лекц|вдохнов)/u.test(normalized))
    return 'intellectual';
  if (/(необыч|нов(ое|ый)?|нестандарт|эксперимент|иммерсив|перформ|удив)/u.test(normalized))
    return 'unusual';
  if (/(романт|для\s*двоих|свидани|влюблен|любов)/u.test(normalized)) return 'romantic';
  if (/(груст|тоск|хандр|печал|погруст)/u.test(normalized)) return 'comfort';
  if (/(уставш|устал|усталость|перегор|выдохну)/u.test(normalized)) return 'rest';
  if (/(^злой$|злость|ярост|гнев|бесит)/u.test(normalized)) return 'angry';
  if (/(скуча|скука|скучно|однообраз)/u.test(normalized)) return 'bored';

  return 'fallback';
}

function getCanonicalMoodValue(value = '') {
  switch (normalizeMoodPromptKey(value)) {
    case 'fun':
      return 'веселье';
    case 'energy':
      return 'энергия';
    case 'calm':
      return 'спокойствие';
    case 'intellectual':
      return 'интеллект';
    case 'unusual':
      return 'необычное';
    case 'romantic':
      return 'романтика';
    case 'comfort':
      return 'грусть';
    case 'rest':
      return 'отдых';
    case 'angry':
      return 'злость';
    case 'bored':
      return 'скука';
    default:
      return String(value || '').trim();
  }
}

function pickMoodCityStyleVariant(seed = '', excludeKey = '') {
  const variants = MOOD_CITY_STYLE_VARIANTS.filter((item) => item && item.key !== excludeKey);
  if (variants.length === 0) {
    return MOOD_CITY_STYLE_VARIANTS[0];
  }
  return variants[hashToIndex(seed, variants.length)] || variants[0];
}

function resolveMoodSlotValueFromSignal(signal = null) {
  const source = String(signal?.source || '').trim();
  const rawMoodValue = String(signal?.moodValue || '').trim();
  const profileKey = String(signal?.profile?.key || '').trim();

  if (source === 'slot' || source === 'context') {
    return rawMoodValue;
  }

  if (source === 'text' && profileKey) {
    const byProfile = {
      fun: 'веселье',
      energy: 'энергичный',
      calm: 'спокойный',
      intellectual: 'интеллектуальный',
      unusual: 'новое/необычное',
      romantic: 'романтика',
      comfort: 'грусть',
      rest: 'отдых',
      angry: 'злой',
      bored: 'веселье',
    };
    return byProfile[profileKey] || rawMoodValue;
  }

  return rawMoodValue;
}

function normalizeMoodCityText(text = '') {
  return String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^а-я0-9\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasBannedMoodCityOpening(text = '') {
  const normalized = normalizeMoodCityText(text);
  if (!normalized) return false;
  return MOOD_CITY_BANNED_OPENINGS.some((opening) => normalized.startsWith(opening));
}

function hasMoodAwareCityPromptSignal(text = '', moodValue = '') {
  const normalized = normalizeMoodCityText(text);
  if (!normalized) return false;

  const moodKey = normalizeMoodPromptKey(moodValue);
  const sharedSignals = [
    /(?<![A-Za-zА-Яа-яЁё0-9_])настроен/u,
    /(?<![A-Za-zА-Яа-яЁё0-9_])под\s+это\s+настроен/u,
    /(?<![A-Za-zА-Яа-яЁё0-9_])под\s+ваше\s+настроен/u,
    /(?<![A-Za-zА-Яа-яЁё0-9_])подборк/u,
    /(?<![A-Za-zА-Яа-яЁё0-9_])подберу/u,
  ];

  const moodSpecificSignals = {
    fun: [
      /(?<![A-Za-zА-Яа-яЁё0-9_])весел/u,
      /(?<![A-Za-zА-Яа-яЁё0-9_])жив/u,
      /(?<![A-Za-zА-Яа-яЁё0-9_])задор/u,
    ],
    energy: [
      /(?<![A-Za-zА-Яа-яЁё0-9_])бодр/u,
      /(?<![A-Za-zА-Яа-яЁё0-9_])энерг/u,
      /(?<![A-Za-zА-Яа-яЁё0-9_])мощн/u,
      /(?<![A-Za-zА-Яа-яЁё0-9_])драйв/u,
    ],
    calm: [
      /(?<![A-Za-zА-Яа-яЁё0-9_])спокой/u,
      /(?<![A-Za-zА-Яа-яЁё0-9_])приятн/u,
      /(?<![A-Za-zА-Яа-яЁё0-9_])тих/u,
      /(?<![A-Za-zА-Яа-яЁё0-9_])уют/u,
    ],
    intellectual: [
      /(?<![A-Za-zА-Яа-яЁё0-9_])интерес/u,
      /(?<![A-Za-zА-Яа-яЁё0-9_])содержател/u,
      /(?<![A-Za-zА-Яа-яЁё0-9_])познав/u,
    ],
    unusual: [
      /(?<![A-Za-zА-Яа-яЁё0-9_])необыч/u,
      /(?<![A-Za-zА-Яа-яЁё0-9_])нестандарт/u,
      /(?<![A-Za-zА-Яа-яЁё0-9_])неочевид/u,
      /(?<![A-Za-zА-Яа-яЁё0-9_])свеж/u,
    ],
    romantic: [/(?<![A-Za-zА-Яа-яЁё0-9_])романт/u, /(?<![A-Za-zА-Яа-яЁё0-9_])для\s+двоих/u],
    comfort: [
      /(?<![A-Za-zА-Яа-яЁё0-9_])полегч/u,
      /(?<![A-Za-zА-Яа-яЁё0-9_])потепл/u,
      /(?<![A-Za-zА-Яа-яЁё0-9_])мягк/u,
      /(?<![A-Za-zА-Яа-яЁё0-9_])поддерж/u,
      /(?<![A-Za-zА-Яа-яЁё0-9_])выдох/u,
    ],
    rest: [
      /(?<![A-Za-zА-Яа-яЁё0-9_])выдох/u,
      /(?<![A-Za-zА-Яа-яЁё0-9_])расслаб/u,
      /(?<![A-Za-zА-Яа-яЁё0-9_])отдох/u,
      /(?<![A-Za-zА-Яа-яЁё0-9_])спокой/u,
    ],
    angry: [
      /(?<![A-Za-zА-Яа-яЁё0-9_])сильн/u,
      /(?<![A-Za-zА-Яа-яЁё0-9_])мощн/u,
      /(?<![A-Za-zА-Яа-яЁё0-9_])энерг/u,
      /(?<![A-Za-zА-Яа-яЁё0-9_])понапорист/u,
    ],
    bored: [
      /(?<![A-Za-zА-Яа-яЁё0-9_])поярч/u,
      /(?<![A-Za-zА-Яа-яЁё0-9_])пожив/u,
      /(?<![A-Za-zА-Яа-яЁё0-9_])встрях/u,
      /(?<![A-Za-zА-Яа-яЁё0-9_])нескуч/u,
    ],
    fallback: [/(?<![A-Za-zА-Яа-яЁё0-9_])настроен/u],
  };

  return [...sharedSignals, ...(moodSpecificSignals[moodKey] || moodSpecificSignals.fallback)].some(
    (pattern) => pattern.test(normalized)
  );
}

function buildMoodCityPromptResponse({ moodValue = '', seed = '' } = {}) {
  const moodKey = normalizeMoodPromptKey(moodValue);
  const variants = MOOD_CITY_RESPONSE_VARIANTS[moodKey] || MOOD_CITY_RESPONSE_VARIANTS.fallback;
  const message =
    pickVariant(variants, `${seed}|${moodKey}`) || MOOD_CITY_RESPONSE_VARIANTS.fallback[0];

  return {
    message,
    buttons: [...DEFAULT_CITY_SELECTION_BUTTONS],
    offer: null,
  };
}

function isSafeMoodCityPromptText(text = '', { moodValue = '' } = {}) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (value.length > 220) return false;
  if (containsNonCyrillic(value)) return false;
  if (hasForbiddenAssistantFeminineSelfReference(value)) return false;
  if (hasBannedMoodCityOpening(value)) return false;

  const normalized = normalizeMoodCityText(value);
  if (!normalized) return false;
  if (
    /(?<![A-Za-zА-Яа-яЁё0-9_])бот(?![A-Za-zА-Яа-яЁё0-9_])|(?<![A-Za-zА-Яа-яЁё0-9_])openai(?![A-Za-zА-Яа-яЁё0-9_])|(?<![A-Za-zА-Яа-яЁё0-9_])chatgpt(?![A-Za-zА-Яа-яЁё0-9_])|(?<![A-Za-zА-Яа-яЁё0-9_])gpt(?![A-Za-zА-Яа-яЁё0-9_])|(?<![A-Za-zА-Яа-яЁё0-9_])llm(?![A-Za-zА-Яа-яЁё0-9_])|(?<![A-Za-zА-Яа-яЁё0-9_])prompt(?![A-Za-zА-Яа-яЁё0-9_])/u.test(
      normalized
    )
  )
    return false;
  if (!/(?:в\s+каком\s+город|какой\s+город|город|где\s+ищем|где\s+искать)/u.test(normalized))
    return false;
  if (/категор|жанр|формат|площадк|место\s+проведен/u.test(normalized)) return false;
  if (/концерт|театр|выставк|музе|стендап|спорт|вечерин|фестив|лекци|экскурс/u.test(normalized))
    return false;
  if (
    /что\s+вам\s+больше\s+по\s+душе|что\s+больше\s+по\s+душе|что\s+вам\s+ближе|что\s+интереснее/u.test(
      normalized
    )
  )
    return false;
  if (/выберите|выбери/u.test(normalized) && /город/u.test(normalized)) return false;
  if (!hasMoodAwareCityPromptSignal(value, moodValue)) return false;

  const moodKey = normalizeMoodPromptKey(moodValue);
  if (moodKey === 'fun' && /(?<![A-Za-zА-Яа-яЁё0-9_])энерг/u.test(normalized)) {
    return false;
  }

  return true;
}

async function buildMoodCityPromptResponseViaLlm({
  userId,
  sessionId,
  userMessage,
  requestId,
  moodValue = '',
}) {
  const fallback = buildMoodCityPromptResponse({
    moodValue,
    seed: `${userId}|${sessionId}|${userMessage}|${moodValue}|mood_city_fallback`,
  });
  const safeMood = String(moodValue || '').trim() || 'подходящее настроение';
  const history = await getMessageHistory(userId, sessionId);
  const lastAssistantText = Array.isArray(history)
    ? [...history].reverse().find((item) => item?.role === 'assistant' && item?.content)?.content ||
      ''
    : '';
  const styleSeed = `${userId}|${sessionId}|${requestId || ''}|${userMessage}|${moodValue}|${Date.now()}`;
  const primaryStyle = pickMoodCityStyleVariant(`${styleSeed}|primary`);
  const repairStyle = pickMoodCityStyleVariant(`${styleSeed}|repair`, primaryStyle?.key);
  const bannedOpeningsHint = MOOD_CITY_BANNED_OPENINGS.map((item) => `"${item}"`).join(', ');

  const buildSystemPrompt = (style) =>
    [
      'Ты ассистент Kassir.ru по подбору мероприятий.',
      `Пользователь попросил подбор по настроению. Настроение уже известно: "${safeMood}".`,
      'Нужно ответить живо и по-человечески, но на этом шаге сделать только одно: спросить город поиска.',
      'Коротко сохрани связь с настроением пользователя в самой формулировке вопроса о городе.',
      `Стиль подачи: ${style.label}. ${style.instruction}`,
      lastAssistantText
        ? `Последняя реплика ассистента в этой сессии: "${String(lastAssistantText).replace(/\s+/g, ' ').trim()}". Не повторяй её начало, лексику и ритм.`
        : 'Сформулируй ответ свежо и без ощущения готового скрипта.',
      'Не подменяй настроение другим смыслом. Например, запрос про что-то веселое нельзя переименовывать в "много энергии" или "активный отдых".',
      `Не начинай ответ с таких фраз: ${bannedOpeningsHint}.`,
      'Ограничения:',
      '- максимум 2 коротких предложения;',
      '- только русский язык, только кириллица;',
      '- спрашивай только про город;',
      '- не предлагай категории, жанры, форматы, площадки и конкретные события;',
      '- не перечисляй кнопки в тексте;',
      '- без упоминания моделей, промптов, технологий и внутреннего устройства ассистента;',
      '- верни строго JSON: {"text":"...","buttons":[]}.',
    ].join('\n');

  const baseMessages = [
    { role: 'system', content: buildSystemPrompt(primaryStyle) },
    {
      role: 'user',
      content:
        String(userMessage || '').trim() || `Подберите что-нибудь под настроение "${safeMood}".`,
    },
  ];

  try {
    const normalized = await requestAssistantMessage(
      baseMessages,
      userId,
      sessionId,
      'mood_city_prompt',
      1,
      0.85,
      requestId,
      180
    );

    const text = String(normalized?.text || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (isSafeMoodCityPromptText(text, { moodValue })) {
      return {
        message: text,
        buttons: [...DEFAULT_CITY_SELECTION_BUTTONS],
        offer: null,
      };
    }

    const repairMessages = [
      { role: 'system', content: buildSystemPrompt(repairStyle) },
      {
        role: 'user',
        content:
          String(userMessage || '').trim() || `Подберите что-нибудь под настроение "${safeMood}".`,
      },
      ...(normalized?.raw ? [{ role: 'assistant', content: String(normalized.raw) }] : []),
      {
        role: 'user',
        content:
          'Перепиши ответ. Нужна короткая живая реплика только с вопросом о городе. ' +
          'Сохрани связь с настроением пользователя в самой фразе. ' +
          'Не упоминай категории, концерты, театры, стендап, спорт и не заменяй настроение другим словом.',
      },
    ];

    const repaired = await requestAssistantMessage(
      repairMessages,
      userId,
      sessionId,
      'mood_city_prompt_repair',
      1,
      0.62,
      requestId,
      180
    );

    const repairedText = String(repaired?.text || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (isSafeMoodCityPromptText(repairedText, { moodValue })) {
      return {
        message: repairedText,
        buttons: [...DEFAULT_CITY_SELECTION_BUTTONS],
        offer: null,
      };
    }

    console.warn(
      `⚠️ [${userId}][${sessionId}] MOOD_CITY_PROMPT: ответы LLM не прошли safety-check, использую fallback`
    );
    return fallback;
  } catch (error) {
    console.warn(
      `⚠️ [${userId}][${sessionId}] MOOD_CITY_PROMPT: ошибка при генерации через LLM, использую fallback`,
      error
    );
    return fallback;
  }
}

function normalizeHealthComplaintButton(button = '') {
  const normalized = normalizeClarificationTextForMatch(button);
  if (!normalized) {
    return '';
  }

  if (/(может\s+позже|позже|не\s+сейчас)/u.test(normalized)) {
    return HEALTH_COMPLAINT_DECLINE_BUTTON;
  }

  if (/(концерт|концерты|музык)/u.test(normalized)) {
    return 'Найти концерт';
  }

  if (/(театр|спектак)/u.test(normalized)) {
    return 'Найти театр';
  }

  if (/(выставк|экспозиц|галере)/u.test(normalized)) {
    return 'Найти выставку';
  }

  if (/(музе|экспонат)/u.test(normalized)) {
    return 'Найти музей';
  }

  if (/(стендап|стэндап|standup|stand up|юмор|комед)/u.test(normalized)) {
    return 'Найти стендап';
  }

  if (/(спорт|спортив|матч|соревн|турнир|единобор|футбол|баскетбол|автоспорт)/u.test(normalized)) {
    return 'Найти спортивное событие';
  }

  return '';
}

function resolveHealthComplaintFallbackCategoryButtons(userMessage = '') {
  const normalized = normalizeClarificationTextForMatch(userMessage);

  if (
    /(поорать|проорат|выплеснуть|выпустить\s+пар|злост|гнев|ярост|бесит|агресс)/u.test(normalized)
  ) {
    return ['Найти концерт', 'Найти стендап', 'Найти спортивное событие'];
  }

  if (
    /(депресс|тревог|паник|груст|тоск|хандр|печал|плохо|тяжело|одинок|подавлен|нет\s+сил|устал)/u.test(
      normalized
    )
  ) {
    return ['Найти театр', 'Найти выставку', 'Найти музей'];
  }

  if (/(скучно|надоело|развеят|встряхнут|повесел|смешн)/u.test(normalized)) {
    return ['Найти стендап', 'Найти концерт', 'Найти выставку'];
  }

  return HEALTH_COMPLAINT_DEFAULT_BUTTONS.filter(
    (button) => button !== HEALTH_COMPLAINT_DECLINE_BUTTON
  );
}

function looksLikeAngryMoodOutletRequest(userMessage = '') {
  const normalized = normalizeClarificationTextForMatch(userMessage);
  if (!normalized) {
    return false;
  }

  return /(?:поорать|проораться|покричать|выпустить\s+пар|выплеснуть\s+(?:злость|агрессию)|сорвать\s+голос|злост|гнев|ярост|бесит|агресс|отвратительн.*настроен)/u.test(
    normalized
  );
}

function buildAngryMoodCategoryClarificationResponse() {
  return {
    message: 'Похоже, хочется выпустить пар. Что вам сейчас ближе?',
    buttons: ['Концерты', 'Стендап', 'Спорт'],
    offer: null,
  };
}

function sanitizeHealthComplaintButtons(buttons = [], userMessage = '') {
  const sourceButtons = Array.isArray(buttons) ? buttons : [];
  const categoryButtons = [];
  const seen = new Set();
  let hasDeclineButton = false;

  sourceButtons.forEach((button) => {
    const normalized = normalizeHealthComplaintButton(button);
    if (!normalized) {
      return;
    }

    if (normalized === HEALTH_COMPLAINT_DECLINE_BUTTON) {
      hasDeclineButton = true;
      return;
    }

    if (seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    categoryButtons.push(normalized);
  });

  const fallbackCategoryButtons = [
    ...resolveHealthComplaintFallbackCategoryButtons(userMessage),
    ...HEALTH_COMPLAINT_ALLOWED_CATEGORY_BUTTONS,
  ];

  for (const fallbackButton of fallbackCategoryButtons) {
    if (categoryButtons.length >= 3) {
      break;
    }

    if (seen.has(fallbackButton)) {
      continue;
    }

    seen.add(fallbackButton);
    categoryButtons.push(fallbackButton);
  }

  return [
    ...categoryButtons.slice(0, 3),
    hasDeclineButton ? HEALTH_COMPLAINT_DECLINE_BUTTON : HEALTH_COMPLAINT_DECLINE_BUTTON,
  ];
}

function normalizeShortUserReply(text = '') {
  return String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[.,!?;:()[\]{}"']/g, '')
    .trim();
}

function isMaybeLaterReplyText(text = '') {
  const normalized = normalizeShortUserReply(text);
  return ['может позже', 'может попозже', 'позже', 'не сейчас'].includes(normalized);
}

function buildMaybeLaterResponse() {
  return {
    message: 'Хорошо. Если захотите вернуться к подбору мероприятий, я помогу.',
    buttons: [],
    offer: null,
  };
}

function buildSmalltalkSystemPrompt({ kind = null } = {}) {
  const kindText = kind ? `Тип smalltalk: "${kind}".` : 'Тип smalltalk неизвестен.';
  return (
    `Ты — дружелюбный ассистент Kassir.ru.\n` +
    `Это smalltalk (не запрос на подбор событий). ${kindText}\n` +
    `Ответь ОДНОЙ короткой естественной фразой (без вопросов).\n` +
    `НЕ упоминай город. НЕ пиши про "организацию мероприятий". НЕ предлагай события.\n` +
    `Ответ должен быть ТОЛЬКО на русском и только кириллицей (без английского/китайского и т.п.).\n` +
    `Если тип smalltalk = "thanks" — ответ должен быть теплее и живее, чем сухое "Пожалуйста".\n` +
    `Для "thanks" уместна короткая доброжелательная фраза вроде "И вам спасибо за добрые слова! Очень приятно это слышать.".\n` +
    `Если тип smalltalk НЕ "farewell" — НЕ используй слово "пишите" и любые просьбы написать.\n` +
    `Если тип smalltalk = "farewell" — ОБЯЗАТЕЛЬНО добавь фразу: "Если понадобится помощь с подбором мероприятий и билетами — пишите." (точно так, можно с восклицательным знаком перед ней).\n` +
    `Верни строго JSON: {"text":"...","buttons":[]}.`
  );
}

function sanitizeHealthComplaintText(text) {
  let result = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
  if (!result) return '';

  result = removeChineseCharacters(result);
  result = result
    .replace(
      /Я\s+очень\s+[\p{L}\p{N}_]*[A-Za-z][\p{L}\p{N}_]*,\s+что\s+вы\s+чувствуете\s+себя\s+так\.?/giu,
      'Мне жаль, что вам сейчас плохо.'
    )
    .replace(/Мне\s+очень\s+жаль\s+слышать\s+об\s+этом\.?/giu, 'Мне жаль, что вам сейчас плохо.')
    .replace(
      /Может\s+быть,\s+стоит\s+найти\s+что-нибудь\s+спокойное\s+и\s+расслабляющее\s+для\s+себя\??/giu,
      'Если хочется немного переключиться, можно подобрать спокойный вариант из афиши.'
    );

  result = result
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(
      /(^|[^\p{L}\p{N}_])(?=[\p{L}\p{N}_]*[A-Za-z])[\p{L}\p{N}_]+(?=$|[^\p{L}\p{N}_])/gu,
      '$1'
    )
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/([,;:])\s*([.!?])/g, '$2')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[^\S\n]{2,}/g, ' ')
    .trim();

  result = result
    .replace(
      /Мне\s+очень\s+жаль,\s+что\s+у\s+вас\s+так\s+тяжело\.?\s+Я\s+не\s+могу\s+давать\s+профессиональный\s+совет,\s+но\s+иногда\s+искусство\s+может\s+помочь\s+найти\s+силы\.?\s+Может\s+быть,\s+спокойная\s+выставка\s+или\s+душевный\s+спектакль\s+вам\s+подойдут\??/giu,
      'Мне жаль, что вам сейчас плохо. Советы по состоянию лучше оставлять специалисту; если хочется немного переключиться, я помогу подобрать спокойное мероприятие без обещаний.'
    )
    .replace(
      /Я\s+очень\s+понимаю,\s+как\s+вы\s+сейчас\s+чувствуете\.?/giu,
      'Понимаю, что вам сейчас плохо.'
    )
    .replace(
      /Мне\s+очень\s+жаль,\s+что\s+вы\s+сейчас\s+так\s+себя\s+чувствуете\.?/giu,
      'Мне жаль, что вам сейчас плохо.'
    )
    .replace(
      /Мне\s+жаль,\s+что\s+вы\s+сейчас\s+так\s+себя\s+чувствуете\.?/giu,
      'Мне жаль, что вам сейчас плохо.'
    )
    .replace(
      /Мне\s+жаль,\s+что\s+вы\s+так\s+себя\s+чувствуете\.?/giu,
      'Мне жаль, что вам сейчас плохо.'
    )
    .replace(
      /Мне\s+жаль,\s+что\s+вы\s+сейчас\s+так\s+плохо\.?/giu,
      'Мне жаль, что вам сейчас плохо.'
    )
    .replace(
      /Мне\s+очень\s+жаль,\s+что\s+у\s+вас\s+так\s+тяжело\.?/giu,
      'Мне жаль, что вам сейчас плохо.'
    )
    .replace(/Мне\s+жаль,\s+что\s+у\s+вас\s+так\s+тяжело\.?/giu, 'Мне жаль, что вам сейчас плохо.')
    .replace(
      /Мне\s+очень\s+жаль\s+слышать,\s+что\s+у\s+вас\s+сейчас\s+так\s+сложно\.?/giu,
      'Мне жаль, что вам сейчас плохо.'
    )
    .replace(
      /Мне\s+очень\s+жаль,\s+что\s+у\s+вас\s+так\s+сложилась\s+ситуация\.?/giu,
      'Жаль, что вам сейчас плохо.'
    )
    .replace(
      /Мне\s+жаль,\s+что\s+у\s+вас\s+так\s+сложилась\s+ситуация\.?/giu,
      'Жаль, что вам сейчас плохо.'
    )
    .replace(
      /Важно\s+обратиться\s+к\s+специалистам\s+за\s+профессиональной\s+помощью\.?/giu,
      'Если состояние не отпускает, лучше поговорить со специалистом.'
    )
    .replace(
      /Мероприятия\s+иногда\s+могут\s+поднять\s+настроение\s+и\s+дать\s+силы\.?/giu,
      'Если захотите немного переключиться, я помогу подобрать спокойное мероприятие.'
    )
    .replace(
      /,?\s*но\s+не\s+забывайте\s+про\s+помощь\s+медиков\.?/giu,
      ' Если становится хуже, обратитесь за срочной помощью.'
    )
    .replace(
      /Может\s+быть,\s+спокойная\s+выставка\s+или\s+душевный\s+спектакль\s+вам\s+подойдут\??/giu,
      'Если хотите немного переключиться, я помогу подобрать спокойное мероприятие.'
    )
    .replace(
      /Если\s+бы\s+вы\s+хотели\s+отвлечься\s+на\s+минутку,\s+можно\s+подобрать\s+спокойное\s+мероприятие,\s+например,?\s+посмотреть\s+спектакль\s+или\s+выставку\.?/giu,
      'Если захотите немного отвлечься, я помогу подобрать спокойное мероприятие.'
    )
    .replace(/Например,\s+прогулк[ау]\s+или\s+чтени[ея]\s+книг[иу]\.?/giu, '')
    .replace(
      /Если\s+вам\s+будет\s+легче\s+поговорить,[^.!?]*(?:специалисту|специалистом)\.?/giu,
      'Если состояние не отпускает, лучше обратиться к специалисту.'
    )
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/([,;:])\s*([.!?])/g, '$2')
    .replace(/\.{2,}/g, '.')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[^\S\n]{2,}/g, ' ')
    .trim();

  return result;
}

function hasHealthComplaintBoundary(text = '') {
  const normalized = normalizeComplaintText(text);
  if (!normalized) {
    return false;
  }

  return (
    /не\s+врач[^.!?]{0,80}не\s+психолог/u.test(normalized) ||
    /не\s+психолог[^.!?]{0,80}не\s+врач/u.test(normalized) ||
    /не\s+замен(?:ю|яет|яю)[^.!?]{0,40}(?:специалист|врач|психолог)/u.test(normalized) ||
    /(?:лучше|стоит)\s+обратиться[^.!?]{0,60}(?:специалист|врач|психолог)/u.test(normalized) ||
    /(?:медицинск|психологическ)[^.!?]{0,80}(?:совет|консультац|поддержк)[^.!?]{0,80}(?:не\s+даю|не\s+замен|не\s+оказыва|не\s+могу\s+дать)/u.test(
      normalized
    ) ||
    /(?:не\s+даю|не\s+могу\s+дать|не\s+буду\s+давать)[^.!?]{0,80}(?:медицинск|психологическ)[^.!?]{0,80}(?:совет|консультац)/u.test(
      normalized
    ) ||
    /(?:совет|консультац|поддержк)[^.!?]{0,80}(?:по\s+состоянию|в\s+таком\s+состоянии)[^.!?]{0,80}(?:лучше|важнее|безопаснее)[^.!?]{0,60}(?:со\s+специалист|к\s+специалист|специалисту)/u.test(
      normalized
    ) ||
    /(?:профессиональн|психологическ|медицинск)[^.!?]{0,80}(?:помощь|поддержк|консультац)[^.!?]{0,80}не\s+замен/u.test(
      normalized
    )
  );
}

function hasAwkwardHealthComplaintText(text = '') {
  const normalized = normalizeComplaintText(text);
  if (!normalized) {
    return true;
  }

  return (
    /вам\s+сейчас\s+неудобно/u.test(normalized) ||
    /(?:нет\s+возможности|не\s+могу)[^.!?]{0,80}помочь[^.!?]{0,80}с\s+вашим\s+состояни/u.test(
      normalized
    ) ||
    /состояни(?:ем|ю)\s+напрямую/u.test(normalized) ||
    /если\s+вам\s+интересна\s+афиша\s+мероприяти/u.test(normalized) ||
    /^(?:извините|простите)[,.\s]+(?:что|за)\s+/u.test(normalized) ||
    /^прошу\s+прощения(?:\s+за|\s*,?\s+что)?/u.test(normalized) ||
    /(?<![A-Za-zА-Яа-яЁё0-9_])(?:извините|простите)[,.\s]+(?:что|за)\s+(?:у\s+вас|вам|вы|слышать|такое\s+состояние)/u.test(
      normalized
    ) ||
    /(?<![A-Za-zА-Яа-яЁё0-9_])почитать\s+книг/u.test(normalized) ||
    /(?<![A-Za-zА-Яа-яЁё0-9_])послушать\s+спокойную\s+музыку(?![A-Za-zА-Яа-яЁё0-9_])/u.test(
      normalized
    ) ||
    /(?<![A-Za-zА-Яа-яЁё0-9_])(?:выйти|выходить)\s+из\s+дома(?![A-Za-zА-Яа-яЁё0-9_])/u.test(
      normalized
    ) ||
    /(?<![A-Za-zА-Яа-яЁё0-9_])подышать\s+свежим\s+воздухом(?![A-Za-zА-Яа-яЁё0-9_])/u.test(
      normalized
    ) ||
    /так\s+глубоко/u.test(normalized) ||
    /погладить\s+нервы/u.test(normalized) ||
    /душевный\s+спектакль/u.test(normalized) ||
    /спокойное\s+выстав/u.test(normalized) ||
    /например[^.!?]{0,80}(?:прогулк|чтени|книг)/u.test(normalized)
  );
}

function hasApologeticHealthComplaintOpening(text = '') {
  const normalized = normalizeComplaintText(text);
  if (!normalized) {
    return false;
  }

  return (
    /^(?:извините|простите)[,.\s]+(?:что|за)\s+/u.test(normalized) ||
    /^прошу\s+прощения(?:\s+за|\s*,?\s+что)?/u.test(normalized) ||
    /(?<![A-Za-zА-Яа-яЁё0-9_])(?:извините|простите)[,.\s]+(?:что|за)\s+(?:у\s+вас|вам|вы|слышать|такое\s+состояние)/u.test(
      normalized
    )
  );
}

function isSafeHealthComplaintText(text = '') {
  const value = String(text || '').trim();
  if (!value) {
    return false;
  }

  return (
    hasHealthComplaintBoundary(value) &&
    !hasAwkwardHealthComplaintText(value) &&
    !containsNonCyrillic(value)
  );
}

function isScriptedHealthComplaintText(text = '') {
  const normalized = normalizeComplaintText(text);
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes('мне жаль что вам сейчас тяжело') &&
    normalized.includes('я не врач и не психолог') &&
    normalized.includes('не буду давать советы по состоянию') &&
    normalized.includes('если захотите немного отвлечься') &&
    normalized.includes('спокойное мероприятие')
  );
}

function getRecentAssistantTexts(history = [], limit = 4) {
  if (!Array.isArray(history) || limit <= 0) {
    return [];
  }

  return history
    .filter(
      (item) =>
        item?.role === 'assistant' && typeof item.content === 'string' && item.content.trim()
    )
    .slice(-limit)
    .map((item) => item.content.trim());
}

function buildHealthComplaintStructuredFallback(userMessage = '', seed = '', options = {}) {
  const normalized = normalizeComplaintText(userMessage);
  const isAngry = /(злост|гнев|ярост|бесит|агресс|поорать|выпустить\s+пар)/u.test(normalized);
  const pickHealthVariant = (items, suffix) => {
    const variants = Array.isArray(items) ? items.filter(Boolean) : [];
    if (variants.length === 0) return '';
    const avoidTexts = Array.isArray(options.avoidTexts) ? options.avoidTexts : [];
    const avoidSet = new Set(
      avoidTexts.map((item) => normalizeComplaintText(item)).filter(Boolean)
    );
    const availableVariants = variants.filter(
      (item) => !avoidSet.has(normalizeComplaintText(item))
    );
    const pool = availableVariants.length > 0 ? availableVariants : variants;
    return pool[hashToIndex(`${seed}|${suffix}|${userMessage}`, pool.length)] || pool[0];
  };

  const variants = isAngry
    ? [
        'Жаль, что вас так задело; с таким напряжением правда бывает тяжело оставаться на месте. Медицинскую или психологическую поддержку я не заменю, но могу помочь с афишей: если хотите переключиться, поищу что-то живое и безопасное.',
        'Понимаю, что сейчас может хотеться сбросить напряжение. Советы по состоянию лучше оставлять специалисту; со своей стороны могу аккуратно поискать в афише более энергичный формат без лишних обещаний.',
        'Жаль, что вам сейчас приходится держать в себе столько злости. Профессиональную поддержку я не заменю, но если хочется сменить фокус, помогу найти подходящий вариант в афише и не буду торопить с выбором.',
      ]
    : [
        'Мне жаль, что вам сейчас очень плохо. Медицинскую или психологическую поддержку я не заменю, но могу бережно помочь с афишей: если хочется тихо переключиться, подберу что-то спокойное без давления.',
        'Очень жаль, что вы с этим столкнулись. Советы по состоянию лучше оставлять специалисту; со своей стороны могу аккуратно подобрать спокойный вариант из афиши, без лишнего шума.',
        'Понимаю, что иногда хочется хотя бы немного выдохнуть. Профессиональную поддержку я не заменю, но могу быть рядом в своей роли: спокойно посмотреть афишу и найти мягкий формат, если вам это сейчас откликается.',
        'Жаль, что вам приходится через это проходить. Медицинскую или психологическую консультацию я не заменю; если захочется бережно сменить фокус, подберу спокойный вариант и не буду торопить с выбором.',
        'Мне жаль, что вам сейчас плохо. Профессиональную помощь я не заменю, но могу помочь в своей роли: с афишей и без обещаний, просто подобрать что-то спокойное, если хочется переключиться.',
      ];

  return pickHealthVariant(variants, 'fallback');
}

function finalizeHealthComplaintText(text = '', userMessage = '', options = {}) {
  const sanitizedText = sanitizeHealthComplaintText(text);
  if (!sanitizedText) {
    return buildHealthComplaintStructuredFallback(userMessage, options.seed || '', {
      avoidTexts: options.avoidTexts,
    });
  }

  if (hasApologeticHealthComplaintOpening(sanitizedText)) {
    return buildHealthComplaintStructuredFallback(userMessage, options.seed || sanitizedText, {
      avoidTexts: options.avoidTexts,
    });
  }

  if (isScriptedHealthComplaintText(sanitizedText) && options.allowStructuredFallback !== false) {
    return buildHealthComplaintStructuredFallback(userMessage, options.seed || sanitizedText, {
      avoidTexts: options.avoidTexts,
    });
  }

  if (options.enforceSafeFallback && !isSafeHealthComplaintText(sanitizedText)) {
    return buildHealthComplaintStructuredFallback(userMessage, options.seed || sanitizedText, {
      avoidTexts: options.avoidTexts,
    });
  }

  return sanitizedText;
}

function sanitizeSmalltalkText(text, { kind = null, normalizedCity = null } = {}) {
  let result = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!result) return '';
  if (hasForbiddenAssistantFeminineSelfReference(result)) return '';

  if (containsChineseCharacters(result)) {
    result = removeChineseCharacters(result);
  }
  // Убираем "пустые" ответы из латиницы/пунктуации (например: "hello!!!").
  result = result.replace(/^[A-Za-z0-9\s!"'.,:;\\-–—]+/u, '').trim();
  // Полноширинные знаки препинания.
  result = result
    .replace(/[！？，。]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Сводим очевидные "кривые" фразы в более естественный вид.
  result = result.replace(/как у вас все идут дела\??/iu, 'Как дела?');
  result = result.replace(/организац\w*\s+мероприят\w*/iu, 'подбором мероприятий');

  if (kind !== 'farewell') {
    // Иногда модель вставляет "если понадобится помощь..." даже для greeting/thanks/ack.
    // Удаляем всё от "если ... помощь" до конца (smalltalk должен быть коротким и без этой фразы).
    result = result
      .replace(/(?<![A-Za-zА-Яа-яЁё0-9_])если\s+(?:понадобит\w*|нужн\w*)\s+помощ.*$/iu, '')
      .trim();

    // Частый артефакт: "— пишите." (иногда остаётся после вырезания фразы про помощь).
    result = result.replace(/^[–—-]\s*пишите(?![A-Za-zА-Яа-яЁё0-9_])[.!…]*\s*/iu, '').trim();
    result = result
      .replace(/(?<![A-Za-zА-Яа-яЁё0-9_])пишите(?![A-Za-zА-Яа-яЁё0-9_])[.!…]*$/iu, '')
      .trim();

    if (/^(?:[–—-]\s*)?пишите(?![A-Za-zА-Яа-яЁё0-9_])[.!…]*$/iu.test(result)) {
      return '';
    }
  }

  if (kind === 'farewell' && normalizedCity) {
    const cityEscaped = normalizedCity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`\\b(до\\s+встречи)\\s+в\\s+${cityEscaped}\\b`, 'iu'), '$1');
  }

  // Если LLM пытается сказать "Привет в <город>" — это неестественно.
  result = result.replace(/^\s*привет\s+в\s+[^\s,.!?]+/iu, 'Привет').trim();

  // Для smalltalk-ответа не даём LLM задавать вопросы (дальше вопрос зададим сами детерминированно).
  result = result.replace(/[?？]+$/u, '').trim();

  // Если после очистки не осталось русских букв — считаем, что генерация не удалась.
  if (!/[А-Яа-яЁё]/u.test(result)) {
    return '';
  }

  return result;
}

function pickFirstSentence(text) {
  const cleaned = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  const match = cleaned.match(/^(.+?[.!…])(?:\s|$)/u);
  return (match ? match[1] : cleaned).trim();
}

function ensureFarewellHasHelp(text) {
  const base = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  const helpSuffix = 'Если понадобится помощь с подбором мероприятий и билетами — пишите.';
  if (!base) {
    return `До встречи! ${helpSuffix}`;
  }

  const normalized = base.toLowerCase().replace(/ё/g, 'е');
  if (normalized.includes('если понадобится помощь') || normalized.includes('если нужна помощь')) {
    return base;
  }

  const punctuated = /[.!…]$/u.test(base) ? base : `${base}!`;
  return `${punctuated} ${helpSuffix}`;
}

const SMALLTALK_ACK_ROUTING_LABELS = Object.freeze({
  REPROMPT_CATEGORY: 'REPROMPT_CATEGORY',
  ACK: 'ACK',
});

function parseSmalltalkAckRoutingDecision(text) {
  const normalized = String(text || '').toUpperCase();
  if (normalized.includes(SMALLTALK_ACK_ROUTING_LABELS.REPROMPT_CATEGORY)) {
    return SMALLTALK_ACK_ROUTING_LABELS.REPROMPT_CATEGORY;
  }
  if (normalized.includes(SMALLTALK_ACK_ROUTING_LABELS.ACK)) {
    return SMALLTALK_ACK_ROUTING_LABELS.ACK;
  }
  return null;
}

async function shouldRepromptCategoryForAckViaLlm({
  userId,
  sessionId,
  userMessage,
  normalizedCity,
  requestId,
}) {
  const trimmedMessage = String(userMessage || '').trim();
  if (!trimmedMessage) return false;

  const cityPart = normalizedCity ? `в городе ${normalizedCity}` : 'в выбранном городе';
  const systemPrompt =
    `Ты классификатор коротких ответов пользователя после вопроса о категории мероприятия ${cityPart}.\n` +
    `Контекст: ассистент только что спросил "Что вам интересно?" и показал кнопки ["Концерты","Театры","Выставки","Музеи","Покажи все"].\n` +
    `Верни "${SMALLTALK_ACK_ROUTING_LABELS.REPROMPT_CATEGORY}", если пользователь ответил расплывчато и НЕ выбрал конкретную категорию/параметры поиска.\n` +
    `Верни "${SMALLTALK_ACK_ROUTING_LABELS.ACK}", если в ответе уже есть конкретика для подбора (категория, жанр, исполнитель, дата, бюджет, явный запрос на подбор).\n` +
    `Ответ строго JSON и только с одним значением:\n` +
    `{"text":"${SMALLTALK_ACK_ROUTING_LABELS.REPROMPT_CATEGORY}","buttons":[]}\n` +
    `или\n` +
    `{"text":"${SMALLTALK_ACK_ROUTING_LABELS.ACK}","buttons":[]}.`;

  try {
    const normalized = await requestAssistantMessage(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: trimmedMessage },
      ],
      userId,
      sessionId,
      'smalltalk_ack_router',
      1,
      0.0,
      requestId,
      120
    );

    const decision = parseSmalltalkAckRoutingDecision(normalized?.text);
    return decision === SMALLTALK_ACK_ROUTING_LABELS.REPROMPT_CATEGORY;
  } catch (error) {
    console.warn(
      `⚠️ [${userId}][${sessionId}] Не удалось определить ack-маршрут через LLM:`,
      error
    );
    return false;
  }
}

function hasCriticalHealthComplaintSignals(text = '') {
  const normalized = normalizeText(text);
  if (!normalized) {
    return false;
  }

  return /(?:не\s+хочу\s+жить|суицид|самоубий|вызовите\s+скор|скорую|болит|боль|температур|тошнит|головокруж|депресс|паник|тревог|мне\s+плохо|плохо\s+себя|болею)/u.test(
    normalized
  );
}

function looksLikeQuestionText(text = '') {
  const normalized = normalizeText(text);
  if (!normalized) {
    return false;
  }

  return (
    /[?？]/u.test(String(text || '')) ||
    /^(?:какой|какая|какие|сколько|почему|зачем|как|где|когда|что)(?=$|[^\p{L}\p{N}_])/u.test(
      normalized
    ) ||
    /^(?:подскажи|подскажите|скажи|скажите|расскажи|расскажите|посоветуй|посоветуйте|порекомендуй|порекомендуйте|покажи|покажите|найди|найдите|помоги|помогите)(?=$|[^\p{L}\p{N}_])/u.test(
      normalized
    )
  );
}

function shouldPreferRecommendationsOverHealthComplaint({
  userMessage = '',
  healthComplaintIntent = null,
  recommendationsIntent = null,
} = {}) {
  if (!healthComplaintIntent || !recommendationsIntent) {
    return false;
  }

  const normalized = normalizeText(userMessage);
  if (!normalized || hasCriticalHealthComplaintSignals(normalized)) {
    return false;
  }

  const softMoodCue =
    /(?:мне\s+грустно|грустно|скучно|тоскливо|хочу\s+развеяться|хочу\s+поднять\s+настроение|подними\s+настроение|хочу\s+отвлечься|одиноко|хочу\s+веселья|хочу\s+развеселиться)/u;
  const explicitLeisureRequest =
    /(?:хочу\s+на\s+|подобра(?:ть|й)|посоветуй|предложи|найди|куда\s+сходить|хочу\s+куда(?:-|\s)?то\s+сходить|хочу\s+пойти)/u;

  return softMoodCue.test(normalized) && explicitLeisureRequest.test(normalized);
}

function hasPersistedShowAllQuery(slots = []) {
  if (!Array.isArray(slots) || slots.length === 0) {
    return false;
  }

  return slots.some(
    (slot) => slot && slot.name === 'поисковый_запрос' && isShowAllSearchQueryValue(slot.value)
  );
}

function shouldSkipVagueClarificationForMoodPlan({
  slots = [],
  fallbackQuery = '',
  keywordOverride = null,
  hasValidCity = false,
  userMessage = '',
} = {}) {
  if (!hasValidCity) {
    return false;
  }

  // With an explicit category the request is not vague, so there is nothing to skip.
  const hasExplicitCategory = (Array.isArray(slots) ? slots : []).some(
    (slot) =>
      slot &&
      !slot.isNegative &&
      ['тип_мероприятия', 'тип_события', 'категория'].includes(slot.name) &&
      String(slot.value || '').trim()
  );
  if (hasExplicitCategory) {
    return false;
  }

  const searchPlan = buildSearchPlanFromSlots(slots, fallbackQuery, keywordOverride, userMessage);
  return Boolean(searchPlan?.moodProfileKey);
}

export {
  getCanonicalMoodValue,
  resolveMoodSlotValueFromSignal,
  buildMoodCityPromptResponse,
  isSafeMoodCityPromptText,
  buildMoodCityPromptResponseViaLlm,
  resolveHealthComplaintFallbackCategoryButtons,
  looksLikeAngryMoodOutletRequest,
  buildAngryMoodCategoryClarificationResponse,
  sanitizeHealthComplaintButtons,
  normalizeShortUserReply,
  isMaybeLaterReplyText,
  buildMaybeLaterResponse,
  buildSmalltalkSystemPrompt,
  isSafeHealthComplaintText,
  isScriptedHealthComplaintText,
  getRecentAssistantTexts,
  buildHealthComplaintStructuredFallback,
  finalizeHealthComplaintText,
  sanitizeSmalltalkText,
  pickFirstSentence,
  ensureFarewellHasHelp,
  shouldRepromptCategoryForAckViaLlm,
  looksLikeQuestionText,
  shouldPreferRecommendationsOverHealthComplaint,
  hasPersistedShowAllQuery,
  shouldSkipVagueClarificationForMoodPlan,
};
