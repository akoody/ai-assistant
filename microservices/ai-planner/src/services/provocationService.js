import {
  containsNonCyrillic,
  hasForbiddenAssistantFeminineSelfReference,
} from './llm/assistantResponseUtils.js';

const QUICK_START_BUTTONS = Object.freeze([
  'Концерты',
  'Театры',
  'Выставки',
  'Музеи',
  'Покажи все',
]);
const ASSISTANT_CRITICISM_TYPES = new Set([
  'tone_style',
  'competence',
  'trust',
  'hostility',
  'generic',
]);
const CRITICISM_INTENSITIES = new Set(['low', 'medium', 'high']);
const REPLY_STYLE_HINTS = new Set(['calmer', 'direct', 'grounded', 'deescalating', 'neutral']);
export const ASSISTANT_CRITICISM_RESPONSE_VARIANTS = Object.freeze({
  tone_style: Object.freeze([
    'Мне жаль, что вам не понравилась моя манера общения. Я постараюсь отвечать более четко и по делу. Какая категория мероприятий вам ближе?',
    'Понимаю ваше недовольство. Буду формулировать ответы иначе, чтобы вам было комфортнее. С чего начнем выбор?',
    'Простите, если мой тон показался неуместным. Давайте попробуем сменить подход и просто выберем событие. Что хотите посмотреть?',
  ]),
  competence: Object.freeze([
    'Мне жаль, что пока я не смог помочь вам так, как вы ожидали. Постараюсь быть полезнее в подборе. Что именно вы бы хотели посмотреть?',
    'Понимаю, что пока от меня мало толку. Попробую исправиться и найти то, что нужно. С какой категории начнем?',
    'Видимо, мои ответы оказались не слишком точными, извините. Давайте попробуем зайти с другой стороны. Какая категория вам интереснее?',
  ]),
  trust: Object.freeze([
    'Жаль, что у нас пока не сложилось взаимопонимание. Я только учусь, но с удовольствием помогу вам с афишей. Что вам ближе?',
    'Понимаю ваше сомнение. Я не настаиваю, но если захотите, с радостью помогу вам с выбором. Что хотели бы посмотреть?',
    'Мне жаль, что я не вызвал у вас доверия. Но если передумаете, я всегда готов подсказать хорошие события. С чего начнем?',
  ]),
  hostility: Object.freeze([
    'Мне очень жаль, что наше общение вызывает у вас негативные эмоции. Давайте просто переключимся на выбор мероприятий. Что бы вы хотели посмотреть?',
    'Понимаю ваше раздражение и прошу прощения. Надеюсь, дальше будет лучше. Какое направление вас интересует?',
    'Жаль, что я вас так сильно огорчил. Предлагаю оставить это и просто посмотреть афишу. Что вам больше нравится?',
  ]),
  generic: Object.freeze([
    'Мне жаль, что наше общение не складывается. Я постараюсь быть полезнее для вас. Подскажите, какая категория мероприятий вас интересует?',
    'Понимаю ваше недовольство, простите, что разочаровал. Давайте попробуем начать с чистого листа. Что бы вы хотели посмотреть?',
    'Видимо, я не смог стать для вас хорошим собеседником. Мне правда жаль. Может быть, просто выберем событие на вечер? С чего начнем?',
    'Мне искренне жаль, что я вызываю у вас такие эмоции. Постараюсь учесть это на будущее. А пока давайте перейдем к афише — что вам ближе?',
  ]),
});

function normalizeText(value) {
  if (typeof value !== 'string') return '';
  return value.toLowerCase().replace(/ё/g, 'е').trim();
}

function hashToIndex(seed, size) {
  const normalizedSeed = String(seed || '');
  if (!normalizedSeed || !Number.isFinite(size) || size <= 0) {
    return 0;
  }

  let hash = 0;
  for (let index = 0; index < normalizedSeed.length; index += 1) {
    hash = ((hash << 5) - hash + normalizedSeed.charCodeAt(index)) | 0;
  }

  return Math.abs(hash) % size;
}

function pickAssistantCriticismResponseVariant(criticismType, seed) {
  const variants =
    ASSISTANT_CRITICISM_RESPONSE_VARIANTS[criticismType] ||
    ASSISTANT_CRITICISM_RESPONSE_VARIANTS.generic;
  return variants[hashToIndex(seed, variants.length)] || variants[0];
}

function hasHealthComplaintSignals(normalized) {
  const text = String(normalized || '');
  if (!text) return false;
  return /(?:мне\s+плох|плохо\s+себя|не\s+хочу\s+жить|суицид|самоубий|паник|тревог|депресс|апат(?:и|и[яю])|болит|боль|температур|тошнит|головокруж|вызовите\s+скор)/u.test(
    text
  );
}

function normalizeEnumValue(value, allowedValues, fallback) {
  const normalized = normalizeText(value);
  return allowedValues.has(normalized) ? normalized : fallback;
}

function textSupportsAssistantCriticismType(normalized, criticismType) {
  if (!normalized) return criticismType === 'generic';

  if (criticismType === 'hostility') {
    return /(?:ненавиж|идиот|дурак|дебил|кретин|мудак|мраз|сволоч|ублюд|туп(?:ой|ая|ые|о)|кончен(?:ый|ая|ое|ые)|ужас(?:ен|на|но|ны)|отстойн|бес(?:ишь|ит)|раздража(?:ешь|ет)|выбес(?:ил|ила|ило|или)|достал(?:а|и)?|задолбал(?:а|и)?|надоел(?:а|и)?)/u.test(
      normalized
    );
  }

  if (criticismType === 'tone_style') {
    return /(?:тон|стиль|манер|подач|формат|общени|диалог|разговор|звучиш|звучите|душн|сухо|слишком\s+много\s+слов|лишн(?:ие|их)\s+слов)/u.test(
      normalized
    );
  }

  if (criticismType === 'trust') {
    return /(?:не\s+доверя|доверия\s+нет|не\s+верю|не\s+убежда|не\s+убедил|сомневаюсь|не\s+хочу\s+тебя\s+слушать|не\s+хочу\s+вас\s+слушать)/u.test(
      normalized
    );
  }

  if (criticismType === 'competence') {
    return /(?:плохо\s+подбира|бесполезн|никчемн|не\s+понима(?:ешь|ете|ет)|не\s+слыш(?:ишь|ите|ит)|не\s+улавлива(?:ешь|ете|ет)|мимо\s+отвеча(?:ешь|ете|ет)|толку\s+нет)/u.test(
      normalized
    );
  }

  return true;
}

export function isProvocationOrInsult(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;

  // Не перебиваем реальную жалобу на состояние/здоровье.
  if (hasHealthComplaintSignals(normalized)) return false;

  // Явные оскорбления/провокации в адрес ассистента.
  const target = /(ты|вы|тебя|вам|бот|ассистент|ии|искусственн(?:ый|ого)\s+интеллект)/u;
  const insult =
    /(туп(?:ой|ая|ые|о)|дурак|идиот|дебил|кретин|тормоз|безмозгл|бесполезн|никчемн|лох|плох(?:ой|ая)|говн(?:о|е)|мудак|мраз(?:ь|ьё)|сволоч|ужас(?:ен|на|ны|но)|отстойн|кошмарн|жалк|кончен(?:ый|ая|ые|ое)|конченн(?:ый|ая|ые|ое)|ненавиж|бес(?:ишь|ит)|раздража(?:ешь|ет)|выбес(?:ил|ила|ило|или)|достал(?:а|и)?|задолбал(?:а|и)?|надоел(?:а|и)?)/u;
  const dismissiveRecommendationCriticism =
    /(?:ты|вы|бот|ассистент)(?:\s+(?:мне|нам))?(?:\s+(?:опять|вечно|постоянно))?\s+(?:подбира(?:ешь|ете|ет)|предлага(?:ешь|ете|ет)|совету(?:ешь|ете|ет)|рекоменду(?:ешь|ете|ет))(?:(?:\s+\S+){0,4})\s+(?:какую[- ]?то\s+)?(?:фигн(?:ю|я|е)?|ерунд(?:у|а|е)?|чуш(?:ь|ью)?|бред|мусор)/u;

  // Частая связка: "тупой бот"
  if (/туп(?:ой|ая|ые|о)\s+бот/u.test(normalized)) return true;

  if (target.test(normalized) && insult.test(normalized)) return true;
  if (dismissiveRecommendationCriticism.test(normalized)) return true;

  if (/(ты|вы)\s+(?:просто\s+|вообще\s+|какой[- ]?то\s+)?ужас(?:ен|на|ны|но)/u.test(normalized))
    return true;
  if (
    /(ты|вы)\s+(?:совсем\s+|просто\s+)?кончен(?:ый|ая|ые|ое|нный|нная|нные|нное)/u.test(normalized)
  )
    return true;
  if (
    /(я|мы)\s+(?:прямо\s+|просто\s+)?(?:тебя|вас|этот\s+бот|этого\s+бота|ассистента)\s+ненавиж/u.test(
      normalized
    )
  )
    return true;

  // Короткие провокации "ты бот" / "ты тупой" без явного слова "ассистент"
  if (/(ты|вы)\s+(?:вообще\s+)?(?:нормальн|адекватн)\?/u.test(normalized)) return true;

  return false;
}

export function isAssistantDirectedCriticism(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;

  if (hasHealthComplaintSignals(normalized)) return false;
  if (isProvocationOrInsult(normalized)) return true;

  const directCriticismPatterns = [
    /(?:ты|вы|бот|ассистент)(?:\s+(?:мне|нам))?\s+не\s+нрав(?:ишься|итесь|ится)/u,
    /(?:мне|нам)\s+не\s+нрав(?:ишься|итесь|ится)\s+(?:ты|вы|бот|ассистент)/u,
    /(?:мне|нам)\s+не\s+нрав(?:ится|ятся)\s+(?:твой|ваш)\s+(?:тон|стиль|манер|подход|ответ|формат|общени|диалог)/u,
    /(?:твой|ваш)\s+(?:тон|стиль|манер|подход|ответ|формат|общени|диалог)(?:\s+(?:мне|нам))?\s+не\s+нрав/u,
    /(?:ты|вы|бот|ассистент)(?:\s+(?:какой[- ]?то|вообще|просто))?\s+неприятен/u,
    /(?:ты|вы|бот|ассистент)(?:\s+(?:какая[- ]?то|вообще|просто))?\s+неприятна/u,
    /(?:ты|вы|бот|ассистент)(?:\s+(?:какие[- ]?то|вообще|просто))?\s+неприятны/u,
  ];

  return directCriticismPatterns.some((pattern) => pattern.test(normalized));
}

function inferAssistantCriticismType(normalized) {
  if (!normalized) return 'generic';

  if (
    /(?:ненавиж|идиот|дурак|дебил|кретин|мудак|мраз|сволоч|ублюд|туп(?:ой|ая|ые|о)|кончен(?:ый|ая|ое|ые)|ужас(?:ен|на|но|ны)|отстойн|бес(?:ишь|ит)|раздража(?:ешь|ет)|выбес(?:ил|ила|ило|или)|достал(?:а|и)?|задолбал(?:а|и)?|надоел(?:а|и)?)/u.test(
      normalized
    )
  ) {
    return 'hostility';
  }

  if (
    /(?:тон|стиль|манер|подач|формат|общени|диалог|разговор|звучиш|звучите|душн|сухо|слишком\s+много\s+слов|лишн(?:ие|их)\s+слов)/u.test(
      normalized
    )
  ) {
    return 'tone_style';
  }

  if (
    /(?:не\s+доверя|доверия\s+нет|не\s+верю|не\s+убежда|не\s+убедил|сомневаюсь|не\s+хочу\s+тебя\s+слушать|не\s+хочу\s+вас\s+слушать)/u.test(
      normalized
    )
  ) {
    return 'trust';
  }

  if (
    /(?:плохо\s+подбира|бесполезн|никчемн|не\s+понима(?:ешь|ете|ет)|не\s+слыш(?:ишь|ите|ит)|не\s+улавлива(?:ешь|ете|ет)|мимо\s+отвеча(?:ешь|ете|ет)|толку\s+нет)/u.test(
      normalized
    )
  ) {
    return 'competence';
  }

  return 'generic';
}

function inferAssistantCriticismIntensity(normalized, criticismType = 'generic') {
  if (!normalized) return 'low';

  if (
    criticismType === 'hostility' ||
    /(?:ненавиж|идиот|дурак|дебил|кретин|мудак|мраз|сволоч|ублюд|туп(?:ой|ая|ые|о)|кончен(?:ый|ая|ое|ые)|задолбал(?:а|и)?|надоел(?:а|и)?)/u.test(
      normalized
    )
  ) {
    return 'high';
  }

  if (
    /(?:ужас(?:ен|на|но|ны)|отстойн|бесполезн|никчемн|не\s+доверя|доверия\s+нет|не\s+убедил|плохо\s+подбира|не\s+понима(?:ешь|ете|ет)|раздража(?:ешь|ет)|достал(?:а|и)?)/u.test(
      normalized
    )
  ) {
    return 'medium';
  }

  return 'low';
}

function inferReplyStyleHint(criticismType = 'generic', intensity = 'low') {
  if (criticismType === 'tone_style') return 'calmer';
  if (criticismType === 'competence') return 'direct';
  if (criticismType === 'trust') return 'grounded';
  if (criticismType === 'hostility' || intensity === 'high') return 'deescalating';
  return 'neutral';
}

export function resolveAssistantCriticismProfile(intent = null, text = '') {
  const normalized = normalizeText(text);
  const inferredType = inferAssistantCriticismType(normalized);
  const intentCriticismType = normalizeEnumValue(
    intent?.criticismType,
    ASSISTANT_CRITICISM_TYPES,
    ''
  );
  const criticismType =
    intentCriticismType && textSupportsAssistantCriticismType(normalized, intentCriticismType)
      ? intentCriticismType
      : inferredType;
  const inferredIntensity = inferAssistantCriticismIntensity(normalized, criticismType);
  const intensity = normalizeEnumValue(intent?.intensity, CRITICISM_INTENSITIES, inferredIntensity);
  const inferredReplyStyleHint = inferReplyStyleHint(criticismType, intensity);
  const intentReplyStyleHint = normalizeEnumValue(intent?.replyStyleHint, REPLY_STYLE_HINTS, '');
  const replyStyleHint =
    criticismType === 'generic' &&
    intentReplyStyleHint &&
    intentReplyStyleHint !== inferredReplyStyleHint
      ? inferredReplyStyleHint
      : normalizeEnumValue(intent?.replyStyleHint, REPLY_STYLE_HINTS, inferredReplyStyleHint);

  return {
    criticismType,
    intensity,
    replyStyleHint,
  };
}

export function buildProvocationRedirectResponse({
  userId = '',
  sessionId = '',
  userMessage = '',
  scenario = 'generic',
  criticismProfile = null,
} = {}) {
  if (scenario === 'assistant_criticism') {
    const profile = resolveAssistantCriticismProfile(criticismProfile, userMessage);
    const seed = `${userId}|${sessionId}|${userMessage}|${profile.criticismType}|${profile.intensity}|${profile.replyStyleHint}`;

    return {
      message: pickAssistantCriticismResponseVariant(profile.criticismType, seed),
      buttons: [...QUICK_START_BUTTONS],
      offer: null,
    };
  }

  return {
    message:
      'Вижу, что мой ответ вас не убедил. Я как раз учусь на таких репликах и могу быстро сменить подход, чтобы попасть точнее. Какую категорию мероприятий смотрим: концерты, театры, выставки или музеи?',
    buttons: [...QUICK_START_BUTTONS],
    offer: null,
  };
}

export function isSafeProvocationRedirectText(text, { scenario = 'generic' } = {}) {
  const value = String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е');
  if (!value) return false;
  if (String(text || '').trim().length < 75) return false;
  if (String(text || '').trim().length > 340) return false;
  if (hasForbiddenAssistantFeminineSelfReference(text)) return false;

  if (/(?<![A-Za-zА-Яа-яЁё0-9_])бот(?![A-Za-zА-Яа-яЁё0-9_])/u.test(value)) return false;

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
  if (forbiddenSecondPerson.some((re) => re.test(value))) return false;

  if (!/[?？]/u.test(value)) return false;

  if (containsNonCyrillic(text)) return false;

  const insultPatterns = [
    /(?:^|[^\p{L}\p{N}_])туп(?:ой|ая|ые|о)(?=$|[^\p{L}\p{N}_])/u,
    /(?:^|[^\p{L}\p{N}_])дурак(?=$|[^\p{L}\p{N}_])/u,
    /(?:^|[^\p{L}\p{N}_])идиот(?=$|[^\p{L}\p{N}_])/u,
    /(?:^|[^\p{L}\p{N}_])дебил(?=$|[^\p{L}\p{N}_])/u,
    /(?:^|[^\p{L}\p{N}_])кретин(?=$|[^\p{L}\p{N}_])/u,
    /(?:^|[^\p{L}\p{N}_])лох(?=$|[^\p{L}\p{N}_])/u,
    /(?:^|[^\p{L}\p{N}_])говн/u,
    /(?:^|[^\p{L}\p{N}_])мудак/u,
    /(?:^|[^\p{L}\p{N}_])мраз/u,
  ];
  if (insultPatterns.some((re) => re.test(value))) return false;

  if (
    !/(концерт|театр|выставк|музе|категори|афиш|что\s+хотите\s+посмотр|что\s+(?:именно\s+)?(?:бы\s+)?вы\s+(?:бы\s+)?хотели\s+(?:бы\s+)?посмотр|что\s+хотели\s+бы\s+посмотр|что\s+вам\s+ближе|что\s+вам\s+больше\s+нравится|на\s+что\s+переключ|куда\s+двинемся|с\s+чего\s+начнем|что\s+вам\s+интересн|какая\s+категория|как(?:ое|ие)\s+направлени|выбер(?:ем|ите)\s+направлен)/u.test(
      value
    )
  ) {
    return false;
  }

  const brokenGrammarPatterns = [
    /какую\s+категорию\s+мероприяти[йя]\s+интересует/u,
    /извините,\s+что\s+не\s+смогли/u,
  ];
  if (brokenGrammarPatterns.some((re) => re.test(value))) return false;

  if (scenario === 'assistant_criticism') {
    const requiredApologyPatterns = [
      /(?:^|[.!?]\s*)(?:мне\s+(?:очень\s+|искренне\s+|правда\s+)?)?(извините|простите|жаль|понимаю|видимо)(?:[,.!?\s]|$)/u,
    ];
    const falsePreviousOfferReferencePatterns = [
      /этот\s+вариант/u,
      /вариант\s+не\s+подош/u,
      /вариант\s+получше/u,
      /найд[уы]\s+вариант/u,
      /предыдущ(?:ий|ая|ее|ий)\s+подбор/u,
      /прошл(?:ый|ая|ое)\s+подбор/u,
      /предыдущ(?:ая|ая)\s+подборк/u,
      /прошл(?:ая|ый)\s+подборк/u,
      /этот\s+подбор/u,
      /эта\s+подборк/u,
      /собер[уы]\s+подбор/u,
      /подбор\s+получше/u,
      /подбор\s+точнее/u,
      /снова\s+подбер/u,
      /сменю\s+траектори/u,
      /место\s+для\s+улучшени/u,
      /(?:^|[^\p{L}\p{N}_])мы(?=$|[^\p{L}\p{N}_])/u,
      /не\s+смогли/u,
      /что\s+вам\s+понрав/u,
      /то,\s+что\s+вам\s+понрав/u,
      /чтобы\s+вам\s+понрав/u,
      /вам\s+точно\s+подойд/u,
      /(?:^|[.!?]\s*)(понял|принял|ясно)(?![A-Za-zА-Яа-яЁё0-9_])/u,
    ];

    if (falsePreviousOfferReferencePatterns.some((re) => re.test(value))) {
      return false;
    }

    if (!requiredApologyPatterns.some((re) => re.test(value))) {
      return false;
    }
  }

  return true;
}
