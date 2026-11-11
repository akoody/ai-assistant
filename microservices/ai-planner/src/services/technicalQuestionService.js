import {
  containsAwkwardRussianPhrasing,
  containsNonCyrillic,
  hasForbiddenAssistantFeminineSelfReference,
} from './llm/assistantResponseUtils.js';

export const TECHNICAL_REDIRECT_BUTTONS = Object.freeze([
  'Концерты',
  'Театры',
  'Выставки',
  'Покажи все',
]);

const TECHNICAL_REDIRECT_TEMPLATES = Object.freeze({
  refusal: [
    'С устройством ассистента я не помогаю, зато могу помочь с афишей.',
    'Технические детали моей работы я не обсуждаю, но могу помочь с выбором события.',
    'На такие технические вопросы я не отвечаю, зато помогу найти подходящее мероприятие.',
    'Подробности устройства я не раскрываю, лучше помогу с тем, куда сходить.',
    'Этот технический вопрос оставлю без деталей, а с выбором мероприятий помогу.',
    'Внутреннюю сторону работы я не обсуждаю, зато могу сориентировать по афише.',
    'Такие детали я не раскрываю, но помогу подобрать событие под ваши интересы.',
    'О технической стороне здесь не рассказываю, зато помогу выбрать мероприятие.',
  ],
  intro: {
    general: [
      'Я использую технологии машинного обучения, чтобы лучше понимать ваши интересы и подбирать подходящие мероприятия.',
      'Мне помогают технологии ИИ, чтобы быстрее ориентироваться в ваших предпочтениях и предлагать события по вкусу.',
      'Я работаю как виртуальный помощник и помогаю подбирать мероприятия, которые могут вам действительно подойти.',
    ],
    implementation: [
      'Я использую технологии машинного обучения, чтобы понимать ваши пожелания и подбирать подходящие мероприятия.',
      'Мне помогают технологии ИИ, чтобы быстро улавливать ваши интересы и предлагать события по афише.',
      'Я работаю как виртуальный помощник и помогаю находить мероприятия, которые совпадают с вашими интересами.',
    ],
    model: [
      'Я использую технологии машинного обучения, чтобы лучше понимать ваши интересы и подбирать события под ваш вкус.',
      'Мне помогают технологии ИИ, чтобы предлагать вам мероприятия, которые подходят по настроению и интересам.',
      'Я работаю как виртуальный помощник и помогаю быстрее находить подходящие мероприятия и билеты.',
    ],
    internals: [
      'Я использую технологии машинного обучения, чтобы понимать ваши пожелания и подбирать интересные мероприятия.',
      'Мне помогают технологии ИИ, чтобы быстрее подсказывать события, которые могут вам понравиться.',
      'Я работаю как виртуальный помощник и помогаю подобрать то, что вам действительно будет интересно.',
    ],
  },
  pivot: [
    'Если хотите, я сразу помогу с выбором по афише.',
    'Могу прямо сейчас подобрать для вас что-то интересное.',
    'Давайте лучше сразу перейдём к тому, что вам хотелось бы посмотреть.',
    'Я могу помочь вам быстро выбрать подходящее мероприятие.',
    'Сразу могу предложить варианты по вашим интересам.',
  ],
  question: [
    'Что вас интересует?',
    'Что вам сейчас ближе, концерты, театры или выставки?',
    'С чего начнём, с концертов, театра или выставок?',
    'Что хотите посмотреть?',
  ],
});

function normalizeText(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.toLowerCase().replace(/ё/g, 'е').trim();
}

function hashToIndex(value, modulo) {
  if (!modulo || modulo <= 0) return 0;
  const text = String(value ?? '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash % modulo;
}

function pickVariant(list, seed) {
  const items = Array.isArray(list) ? list : [];
  if (items.length === 0) return '';

  const deterministic = process.env.DETERMINISTIC_TECH_REDIRECT === '1';
  if (deterministic) {
    return items[hashToIndex(seed, items.length)] || items[0];
  }

  const randomIndex = Math.floor(Math.random() * items.length);
  const mixedIndex = (hashToIndex(seed, items.length) + randomIndex) % items.length;
  return items[mixedIndex] || items[0];
}

function containsEventContext(normalized) {
  return /(концерт|спектакл|театр|выставк|музе|стендап|кино|билет|афиш|событи|мероприят)/u.test(
    String(normalized || '')
  );
}

function detectTechnicalQuestionKind(normalized) {
  const value = String(normalized || '');

  if (/(модель|llm|chatgpt|openai|gpt|нейросет)/u.test(value)) {
    return 'model';
  }

  if (/(архитектур|внутр[ие]|как\s+.*(?:устро|работа|сдела|созда))/u.test(value)) {
    return 'internals';
  }

  if (
    /(python|phyton|питон|java|javascript|typescript|node|react|vue|angular|стек|фреймворк|библиотек|технологи|язык(?:а|е)?\s+программ)/u.test(
      value
    )
  ) {
    return 'implementation';
  }

  return 'general';
}

export function isTechnicalMetaQuestion(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;

  // "На каком языке идет спектакль/фильм?" — это про событие, не про устройство ассистента.
  const eventLanguageContext = /(спектакл|постановк|фильм|сеанс|субтитр|озвучк|перевод|оригинал)/u;

  const metaEntity =
    /(ты|тебя|тебе|вы|вас|вам|бот|ассистент|программа|нейросет|ии|искусственн(?:ый|ого)\s+интеллект)/u;

  // "код" часто приходит в падежах: "коде/кода/коду/кодом"
  const explicitTech =
    /(?:язык(?:а|е)?\s+программ|программир|исходник|исходны(?:й|е)\s+код|код(?:а|е|у|ом)?(?:\s|$|[!?.,:;])|стек|технологи|фреймворк|библиотек|архитектур|модель|llm|chatgpt|openai|gpt|python|phyton|питон|javascript|typescript|node\.?js|react|vue|angular)/u;
  if (explicitTech.test(normalized)) {
    if (metaEntity.test(normalized)) return true;
    if (containsEventContext(normalized)) return false;
    return true;
  }

  // Частая формулировка без слов "программирование": "На каком языке вы/ты написаны?"
  const asksLanguage = /на\s+каком\s+язык(?:е|у)(?:\s|$|[!?.,:;])/u.test(normalized);
  const mentionsImplementation =
    /(написан|написаны|сделан|сделаны|работаешь|устроен|устроены|создан|созданы|использовал(?:и|о|а)?)/u.test(
      normalized
    );

  if (asksLanguage && metaEntity.test(normalized) && mentionsImplementation) {
    // Если вопрос явно про язык постановки/озвучки — не считаем это "техвопросом".
    if (eventLanguageContext.test(normalized)) return false;
    return true;
  }

  // Ещё одна частая формулировка: "На чем вы/ты написаны?"
  const asksOnWhat = /на\s+чем(?:\s|$)/u.test(normalized);
  if (asksOnWhat && metaEntity.test(normalized) && mentionsImplementation) {
    if (eventLanguageContext.test(normalized)) return false;
    return true;
  }

  const asksHowWorks =
    /(как\s+(?:вы|ты)\s+(?:работа(?:ет|ете|ешь)|устро(?:ен|ены|ена)|сдела(?:н|ны)|созда(?:н|ны)))/u.test(
      normalized
    );
  if (asksHowWorks && metaEntity.test(normalized)) {
    if (containsEventContext(normalized)) return false;
    return true;
  }

  return false;
}

function hasTechnicalRefusalOpening(value) {
  return /^\s*(?:с\s+(?:таким|этим)\s+(?:вопросом|техническим\s+вопросом)\s+(?:я\s+)?не\s+помогу|здесь\s+(?:я\s+)?не\s+помогу\s+с\s+техническими\s+деталями|в\s+этом\s+(?:я\s+)?не\s+помогу|с\s+устройством\s+ассистента\s+(?:я\s+)?не\s+помогаю|технические\s+детали\s+(?:моей\s+)?работы\s+(?:я\s+)?не\s+обсуждаю|на\s+такие\s+технические\s+вопросы\s+(?:я\s+)?не\s+отвечаю|подробности\s+устройства\s+(?:я\s+)?не\s+раскрываю|этот\s+технический\s+вопрос\s+оставлю\s+без\s+деталей|внутреннюю\s+сторону\s+работы\s+(?:я\s+)?не\s+обсуждаю|такие\s+детали\s+(?:я\s+)?не\s+раскрываю|о\s+технической\s+стороне\s+здесь\s+не\s+рассказываю)/u.test(
    String(value || '')
  );
}

function countParagraphs(value) {
  return String(value || '')
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean).length;
}

export function isSafeTechnicalRedirectText(text) {
  const value = String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е');
  if (!value) return false;
  if (/[:：]/u.test(value)) return false;
  const paragraphCount = countParagraphs(text);
  if (paragraphCount < 2 || paragraphCount > 3) return false;
  if (containsAwkwardRussianPhrasing(text)) return false;
  if (hasForbiddenAssistantFeminineSelfReference(text)) return false;
  const informalSecondPersonPattern =
    /(?:^|[\s,!.?;:()"«»-])(ты|тебе|тебя|тобой|твой|твоя|твое|твои)(?=$|[\s,!.?;:()"«»-])/u;

  const overusedOpenings = [
    /^\s*моя\s+роль\s+проще/u,
    /^\s*я\s+здесь\s+скорее\s+как\s+навигатор/u,
    /^\s*суть\s+не\s+в\s+том/u,
    /^\s*в\s+технические\s+подробности\s+вдаваться\s+не\s+буду/u,
    /^\s*о\s+внутреннем\s+устройстве\s+сейчас\s+говорить\s+не\s+буду/u,
    /^\s*технические\s+детали\s+(?:о\s+\w+\s+)?не\s+(?:раскрываю|обсуждаю)/u,
    /^\s*подробности\s+о\s+(?:языке|реализации|модели|внутренней\s+стороне)/u,
    /^\s*не\s+буду\s+уходить\s+в\s+устройство/u,
    /^\s*о\s+внутренней\s+модели\s+рассказывать\s+не\s+буду/u,
    /^\s*конечно[\s,!.?]/u,
    /^\s*я\s+здесь,\s*чтобы\s+помочь/u,
    /^\s*я\s+здесь\s+для\s+того,\s*чтобы\s+помочь/u,
    /^\s*с\s+таким\s+вопросом\s+(?:я\s+)?не\s+помогу/u,
    /^\s*с\s+этим\s+техническим\s+вопросом\s+(?:я\s+)?не\s+помогу/u,
    /^\s*нет[\s,!.?]/u,
    /^\s*да[\s,!.?]/u,
  ];

  if (overusedOpenings.some((re) => re.test(value))) return false;
  if (!hasTechnicalRefusalOpening(value)) return false;
  if (/гораздо\s+интереснее/u.test(value)) return false;
  if (/куда\s+интереснее/u.test(value)) return false;
  if (/намного\s+важнее/u.test(value)) return false;
  if (/за\s+кадром/u.test(value)) return false;
  if (/за\s+рамками/u.test(value)) return false;
  if (/хотите\s+посмотрет(?:ь|ь на)(?![A-Za-zА-Яа-яЁё0-9_])/u.test(value)) return false;
  if (/какое\s+у\s+вас\s+сегодня\s+настроение/u.test(value)) return false;
  if (
    /(?<![A-Za-zА-Яа-яЁё0-9_])мы\s+(?:используем|сделали|создали|написали|собрали)(?![A-Za-zА-Яа-яЁё0-9_])/u.test(
      value
    )
  )
    return false;
  if (/специальн\w*\s+инструмент/u.test(value)) return false;
  if (/создани[яеи]\s+ассистент/u.test(value)) return false;
  if (/позволя\w*\s+нам/u.test(value)) return false;

  // запрещаем любые попытки раскрыть реальный стек/модель/провайдера.
  const forbidden = [
    /\bpython\b/u,
    /\bphyton\b/u,
    /(?<![A-Za-zА-Яа-яЁё0-9_])питон(?![A-Za-zА-Яа-яЁё0-9_])/u,
    /\bjava\b/u,
    /java\s*script|\bjs\b/u,
    /type\s*script|\bts\b/u,
    /\bnode\.?js\b|\bnodejs\b/u,
    /\breact\b|\bvue\b|\bangular\b/u,
    /\brust\b|\bgolang\b|\bgo\b/u,
    /\bphp\b|\bruby\b/u,
    /c\+\+|c#|csharp/u,
    /\bpostgres\b|\bpostgresql\b|\bmysql\b|\bmongodb\b|\bredis\b|\bkafka\b/u,
    /\bdocker\b|\bkubernetes\b|\bk8s\b/u,
    /\baws\b|\bgcp\b|\bazure\b/u,
    /\bopenai\b|\bchatgpt\b|\bgpt-?\d\b|\bllama\b|\bgemini\b/u,
    /написан\s+на|реализован\s+на|стек\s*:/u,
  ];

  if (forbidden.some((re) => re.test(value))) return false;

  if (informalSecondPersonPattern.test(value)) return false;
  if (/интересующему\s+вас\s+направлению/u.test(value)) return false;

  if (!/(мероприят|билет|афиш|концерт|театр|выставк|событи|досуг)/u.test(value)) return false;
  if (
    !/(подбер|подбир|помо|предлож|найд|сориентир|начнем|начн[её]м|ищем|категор|понимат)/u.test(
      value
    )
  )
    return false;
  if (!/[?？]/u.test(value)) return false;

  // только кириллица и не должно быть запрещенных символов
  if (containsNonCyrillic(text)) return false;

  if (/(?<![A-Za-zА-Яа-яЁё0-9_])бот(?![A-Za-zА-Яа-яЁё0-9_])/u.test(value)) return false;

  return true;
}

export function buildTechnicalRedirectResponse({
  userId = '',
  sessionId = '',
  userMessage = '',
} = {}) {
  const deterministic = process.env.DETERMINISTIC_TECH_REDIRECT === '1';
  const entropy = deterministic ? 'deterministic' : String(Date.now());
  const seed = `${userId}|${sessionId}|${userMessage}|${entropy}`;
  const questionKind = detectTechnicalQuestionKind(normalizeText(userMessage));
  const introVariants =
    TECHNICAL_REDIRECT_TEMPLATES.intro[questionKind] || TECHNICAL_REDIRECT_TEMPLATES.intro.general;
  const refusal = pickVariant(
    TECHNICAL_REDIRECT_TEMPLATES.refusal,
    `${seed}|refusal|${questionKind}`
  );
  const intro = pickVariant(introVariants, `${seed}|intro|${questionKind}`);
  const pivot = pickVariant(TECHNICAL_REDIRECT_TEMPLATES.pivot, `${seed}|pivot`);
  const question = pickVariant(TECHNICAL_REDIRECT_TEMPLATES.question, `${seed}|question`);

  const structures = [
    [refusal, intro, `${pivot} ${question}`].filter(Boolean).join('\n\n'),
    [refusal, `${intro} ${pivot}`, question].filter(Boolean).join('\n\n'),
    [`${refusal} ${intro}`, `${pivot} ${question}`].filter(Boolean).join('\n\n'),
  ];

  const message = pickVariant(structures, `${seed}|structure`)
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  return {
    message,
    buttons: [...TECHNICAL_REDIRECT_BUTTONS],
    offer: null,
  };
}
