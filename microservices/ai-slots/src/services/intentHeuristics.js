import { resolveHeuristicArtistSlot } from './artistHeuristics.js';
import { looksLikeUnknownArtistDiscoveryText } from '../../../../shared/vagueArtistUtils.js';

function normalizeText(value) {
  if (typeof value !== 'string') return '';
  return value.toLowerCase().replace(/ё/g, 'е').trim();
}

function tokenize(text) {
  const compact = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!compact) return [];
  return compact.split(' ').filter(Boolean);
}

function normalizeEnumValue(value, allowedValues, fallback) {
  const normalized = normalizeText(value);
  return allowedValues.has(normalized) ? normalized : fallback;
}

function extractSlashCommand(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^\/([a-z][a-z0-9_-]{0,63})(?:@\w+)?$/iu);
  if (!match) return null;

  return `/${String(match[1] || '').toLowerCase()}`;
}

const TECHNICAL_META_INTENT_NAME = 'technical_meta_question';
const RECOMMENDATIONS_INTENT_NAME = 'recommendations_request';
const OFF_TOPIC_INTENT_NAME = 'off_topic';
const SMALLTALK_INTENT_NAME = 'smalltalk';
const HEALTH_COMPLAINT_INTENT_NAME = 'health_complaint';
const BUY_TICKET_INTENT_NAME = 'buy_ticket';
const NEGATIVE_EVENT_FEEDBACK_INTENT_NAME = 'negative_event_feedback';
const RECOMMENDATION_COMPLAINT_INTENT_NAME = 'recommendation_complaint';
const ASSISTANT_CRITICISM_INTENT_NAME = 'assistant_criticism';
const ASSISTANT_CRITICISM_TYPES = new Set([
  'tone_style',
  'competence',
  'trust',
  'hostility',
  'generic',
]);
const RECOMMENDATION_COMPLAINT_TYPES = new Set([
  'genre',
  'price',
  'relevance',
  'location',
  'time',
  'generic',
]);
const CRITICISM_INTENSITIES = new Set(['low', 'medium', 'high']);
const REPLY_STYLE_HINTS = new Set(['calmer', 'direct', 'grounded', 'deescalating', 'neutral']);

const EVENT_DETAILS_INTENT_NAME = 'event_details_request';
const MODEL_INTENT_SOURCES = new Set(['llm', 'model']);

function isModelIntent(intent) {
  if (!intent || typeof intent !== 'object') {
    return false;
  }

  const source = normalizeText(String(intent.source || ''));
  if (!source) {
    return false;
  }

  return MODEL_INTENT_SOURCES.has(source);
}

function hasAuthoritativeModelOffTopicIntent(intents = []) {
  const input = Array.isArray(intents) ? intents : [];
  return input.some((intent) => {
    if (intent?.name !== OFF_TOPIC_INTENT_NAME || !isModelIntent(intent)) {
      return false;
    }

    return typeof intent.confidence !== 'number' || intent.confidence >= 0.7;
  });
}

function hasAuthoritativeModelCounterIntent(intents = []) {
  const input = Array.isArray(intents) ? intents : [];
  return input.some((intent) => {
    if (!isModelIntent(intent)) {
      return false;
    }

    const intentName = normalizeText(intent?.name);
    if (!intentName) {
      return false;
    }

    if (
      intentName === OFF_TOPIC_INTENT_NAME ||
      intentName === SMALLTALK_INTENT_NAME ||
      intentName === ASSISTANT_CRITICISM_INTENT_NAME
    ) {
      return false;
    }

    return typeof intent.confidence !== 'number' || intent.confidence >= 0.7;
  });
}

function hasMeaningfulExtractedSlots(slots = []) {
  const input = Array.isArray(slots) ? slots : [];
  return input.some((slot) => {
    if (!slot || typeof slot !== 'object') {
      return false;
    }

    const slotName = normalizeText(slot.name);
    const slotValue = normalizeText(slot.value);

    if (!slotName || !slotValue) {
      return false;
    }

    // Игнорируем 'город' и 'поисковый_запрос', так как они часто добавляются эвристиками или есть всегда
    return slotName !== 'город' && slotName !== 'поисковый_запрос';
  });
}

function shouldSuppressHeuristicAssistantCriticism(intents = [], slots = []) {
  return hasAuthoritativeModelCounterIntent(intents) || hasMeaningfulExtractedSlots(slots);
}

const EVENT_FOLLOW_UP_QUESTION_PATTERNS = [
  /(?:сколько|как\s+долго|какова)\s+(?:длит|идет|идёт|продолж)/u,
  /(?:длительность|продолжительность|длина)\s+(?:его|её|ее|этого|этой|того|той|данного|данной)?/u,
  /(?:сколько|как\s+долго)\s+(?:по\s+времени|часов|минут)/u,
  /(?:сколько|какова)\s+(?:стоит|цена|стоимость)\s+(?:\S+\s+)*?(?:его|её|ее|этого|этой|того|той|данного|данной|билет|туда)/u,
  /(?:где|в\s+каком\s+месте|по\s+какому\s+адресу)\s+(?:\S+\s+)*?(?:проход|пройдет|пройдёт|будет|состоит|проводит)/u,
  /(?:когда|во\s+сколько|в\s+какое\s+время)\s+(?:начин|начнет|начнёт|начало|состоит|проход|пройдет|пройдёт|будет|стартует)/u,
  /(?:какой|по\s+какому)\s+адрес/u,
  /(?:где|когда|во\s+сколько)\s+(?:он|она|оно|они|это|этот|эта)\s+(?:проход|пройдет|будет|начин|начало|состоит)/u,
  /(?:расскажи|расскажите)(?:\s+\S+)*?\s+(?:о\s+нем|о\s+ней|о\s+нём|про\s+него|про\s+неё|про\s+нее|об\s+этом|про\s+этот|про\s+это)/u,
  /подробнее\s+(?:о\s+нем|о\s+ней|о\s+нём|про\s+него|про\s+неё|про\s+нее|об\s+этом|про\s+этот|про\s+это)/u,
  /(?:есть|будет|имеется)\s+(?:ли\s+)?(?:антракт|перерыв|пауза)/u,
  /(?:какие?\s+)?(?:возрастн|ограничен)\s*(?:по\s+возраст)?/u,
  /(?:с\s+какого\s+возраста|можно\s+ли\s+(?:с\s+)?(?:ребенк|ребёнк|детьми|дет))/u,
];

const EVENT_FOLLOW_UP_PRONOUN_PATTERNS = [
  /(?:его|её|ее|этого|этой|этот|эта|это|того|той|данного|данной|данное)\s+(?:концерт|спектакл|выступлен|шоу|мероприят|событи|выставк|матч|представлен)/u,
  /(?:концерт|спектакл|выступлен|шоу|мероприят|событи|выставк|матч|представлен)\w*\s+(?:его|её|ее|этого|этой)/u,
  /(?:на\s+)?(?:него|неё|нее|этот|эту|это)\s+(?:билет|пойти|сходить|попасть)/u,
];

const BUY_TICKET_EXPLICIT_TRIGGERS = [
  /купить\s+билет/u,
  /куплю\s+билет/u,
  /купить\s+(?:на|билеты)/u,
  /куплю\s+(?:на|билеты)/u,
  /хочу\s+билет/u,
  /оформить\s+билет/u,
  /заказать\s+билет/u,
  /приобрести\s+билет/u,
  /хочу\s+попасть\s+на/u,
  /взять\s+билет/u,
  /перейти\s+к\s+покупке/u,
  /покупка\s+билет/u,
];

const GENERIC_BUY_TICKET_TRIGGER =
  /(?:^|[^\p{L}\p{N}_])(?:хочу\s+купить|куплю|хотел(?:а)?\s+бы\s+купить)(?=$|[^\p{L}\p{N}_])/u;

const BUY_TICKET_DOMAIN_SIGNAL_PATTERNS = [
  /(?:мероприят|событи|афиш|билет|досуг)/u,
  /(?:концерт|выступлен|жива[яо]?\s+музык|творческ.*(?:вечер|встреч))/u,
  /(?:театр|театральн|спектакл|постановк|пьес|опер|балет|мюзикл|драм|комед|мелодрам|трагикомед|сказк|иммерсив|моноспект|гастрол)/u,
  /(?:выставк|экспозиц)/u,
  /(?:музе|галере)/u,
  /(?:планетар)/u,
  /(?:ст[еэ]ндап|юмор|юморист)/u,
  /(?:шоу|представлен|перформанс|цирк|цирков|клоунад)/u,
  /(?:иллюзионист|фокусник|иллюзион)/u,
  /(?:кино|фильм|сеанс|премьер)/u,
  /(?:спорт|спортивн|матч|соревн|турнир|автоспорт|футбол|баскетбол|хоккей)/u,
  /(?:квест)/u,
  /(?:экскурс)/u,
  /(?:фестив)/u,
  /(?:детск|детям|для\s*детей|ребен|ребён|малыш|семейн)/u,
  /(?:лекци|семинар|мастер[- ]?класс|тренинг)/u,
  /(?:классик|симфон|рок|джаз|фолк|этно|шансон|романс|авторск|бард|рэп|реп|хип[\s-]?хоп|электрон|техно|хаус|метал|танц)/u,
  /(^|[^\p{L}\p{N}_])(?:pop|поп)(?=$|[^\p{L}\p{N}_])/u,
];

function hasBuyTicketDomainSignal(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  return BUY_TICKET_DOMAIN_SIGNAL_PATTERNS.some((pattern) => pattern.test(normalized));
}

function looksLikeGenericNonEventPurchaseText(userMessage) {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;

  return GENERIC_BUY_TICKET_TRIGGER.test(normalized) && !hasBuyTicketDomainSignal(normalized);
}

function looksLikeGenericNonEventDesireText(userMessage, slots = []) {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;

  if (
    looksLikeLeisureRequestText(normalized) ||
    looksLikeShowMoreRequestText(normalized) ||
    looksLikeBuyTicketText(normalized) ||
    hasEventDomainSignal(normalized) ||
    hasArtistSignal(normalized, slots)
  ) {
    return false;
  }

  return /^(?:я\s+)?(?:хочу|хотел(?:а|о)?(?:сь)?|желаю)\s+(?!на\s|в\s|куда|что|чем|как)(?:[\p{L}\p{N}_-]+(?:\s+[\p{L}\p{N}_-]+){0,4})$/u.test(
    normalized
  );
}

function looksLikeGenericNonEventLookupText(userMessage, slots = []) {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;

  if (
    looksLikeLeisureRequestText(normalized) ||
    looksLikeShowMoreRequestText(normalized) ||
    looksLikeBuyTicketText(normalized) ||
    looksLikeClarificationActionText(normalized) ||
    hasEventDomainSignal(normalized) ||
    hasArtistSignal(normalized, slots)
  ) {
    return false;
  }

  return /^(?:покажи|покажите|найди|найдите|поищи|подскажи|подскажите|расскажи|расскажите)\s+(?!все$|всё$|куда|что|чем|как)(?:[\p{L}\p{N}_-]+(?:\s+[\p{L}\p{N}_-]+){0,4})$/u.test(
    normalized
  );
}

const EVENT_DOMAIN_SIGNAL_PATTERNS = [
  /(?:мероприят|событи|афиш|билет|досуг)/u,
  /(?:концерт|выступлен|жива[яо]?\s+музык|творческ.*(?:вечер|встреч))/u,
  /(?:театр|театральн|спектакл|постановк|пьес|опер|балет|мюзикл|драм|комед|мелодрам|трагикомед|сказк|иммерсив|моноспект|гастрол)/u,
  /(?:выставк|экспозиц)/u,
  /(?:музе|галере)/u,
  /(?:планетар)/u,
  /(?:ст[еэ]ндап|stand[\s-]*up|юмор|юморист)/u,
  /(?:шоу|show|представлен|перформанс|цирк|цирков|клоунад)/u,
  /(?:иллюзионист|фокусник|иллюзион)/u,
  /(?:кино|фильм|сеанс|премьер)/u,
  /(?:спорт|спортивн|матч|соревн|турнир|автоспорт|футбол|баскетбол|хоккей)/u,
  /(?:квест|escape\s*room)/u,
  /(?:экскурс|турист|прогулк|путешеств|достопримеч)/u,
  /(?:^|\s)тур(?:ы|а|у|ом|е|ов)?(?:$|\s|[.,!?;:\-–—])/u,
  /(?:фестив|open\s*air|опен[\s-]?эйр)/u,
  /(?:детск|детям|для\s*детей|ребен|ребён|малыш|семейн)/u,
  /(?:образован|обучен|лекци|семинар|мастер[- ]?класс|тренинг|курс)/u,
  /(?:распродаж|скидк|акци)/u,
  /(?:классик|симфон|академическ|рок|рок[-\s]?н[-\s]?рол|джаз|jazz|фолк|этно|шансон|романс|авторск|бард|рэп|реп|хип[\s-]?хоп|trap|трэп|электрон|электроник|edm|техно|techno|house|хаус|метал|metal|хэви|heavy|instrumental|инструментальн|танц)/u,
  /(^|[^\p{L}\p{N}_])(?:pop|поп)(?=$|[^\p{L}\p{N}_])/u,
  /(?:свидани|романтик|романтическ)/u,
];

function hasEventDomainSignal(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  return EVENT_DOMAIN_SIGNAL_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Определяет, хочет ли пользователь купить билет.
 */
function looksLikeBuyTicketText(userMessage) {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;
  if (BUY_TICKET_EXPLICIT_TRIGGERS.some((rx) => rx.test(normalized))) {
    return true;
  }

  return GENERIC_BUY_TICKET_TRIGGER.test(normalized) && hasBuyTicketDomainSignal(normalized);
}

function looksLikeFreeBudgetText(userMessage) {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;

  return (
    /бесплатн/u.test(normalized) ||
    /без\s+денег/u.test(normalized) ||
    /нет\s+денег/u.test(normalized) ||
    /денег\s+нет/u.test(normalized) ||
    /на\s+халяв/u.test(normalized) ||
    /не\s*(?:хочу|готов|могу)\s*платить/u.test(normalized) ||
    /нулев(?:ой|ым)\s+бюджет/u.test(normalized) ||
    /бюджет\s*0/u.test(normalized)
  );
}

function looksLikeExplicitAnyBudgetText(userMessage) {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;

  return (
    normalized === 'любой' ||
    normalized === 'любой бюджет' ||
    normalized === 'любая цена' ||
    normalized === 'не важно' ||
    normalized === 'неважно'
  );
}

function looksLikeBudgetSelectionText(userMessage) {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;

  if (looksLikeExplicitAnyBudgetText(normalized)) {
    return true;
  }

  return (
    /^(?:до|не дороже|не больше|максимум)\s+\d/u.test(normalized) ||
    /^(?:у меня|мой бюджет|бюджет|цена)\s+(?:\d{3,}(?:[ .,\u00a0]\d{3})*|\d+(?:[.,]\d+)?\s*(?:к|k|тыс(?:\.|яч(?:а|и)?)?|тыщ(?:а|и)?|тысяча|тысячи|тысяч|косар(?:ь|я|ей)?))(?:\s*(?:₽|р|руб(?:\.|ля|лей)?))?$/u.test(
      normalized
    ) ||
    /^\d{3,}(?:[ .,\u00a0]\d{3})*(?:\s*(?:₽|р|руб(?:\.|ля|лей)?))?$/u.test(normalized) ||
    /^\d{1,3}(?:[ .,\u00a0]\d{3})+(?:\s*(?:₽|р|руб(?:\.|ля|лей)?))?$/u.test(normalized) ||
    /^\d+(?:[.,]\d+)?\s*(?:к|k|тыс(?:\.|яч(?:а|и)?)?|тыщ(?:а|и)?|тысяча|тысячи|тысяч|косар(?:ь|я|ей)?)(?:\s*(?:₽|р|руб(?:\.|ля|лей)?))?$/u.test(
      normalized
    )
  );
}

function looksLikeDateSelectionText(userMessage) {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;

  return (
    normalized === 'сегодня' ||
    normalized === 'завтра' ||
    normalized === 'послезавтра' ||
    normalized === 'вчера' ||
    normalized === 'любая' ||
    normalized === 'любая дата' ||
    normalized === 'любое время' ||
    normalized === 'ближайшие выходные' ||
    normalized === 'на выходных' ||
    normalized === 'выходные' ||
    normalized === 'на этой неделе' ||
    normalized === 'эта неделя' ||
    normalized === 'эту неделю' ||
    normalized === 'на следующей неделе' ||
    normalized === 'следующая неделя' ||
    normalized === 'следующую неделю' ||
    normalized === 'через неделю'
  );
}

function looksLikeTimeSelectionText(userMessage) {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;

  return (
    normalized === 'утром' ||
    normalized === 'днем' ||
    normalized === 'вечером' ||
    normalized === 'ночью' ||
    normalized === 'любое время'
  );
}

function looksLikeClarificationActionText(userMessage) {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;

  return (
    normalized === 'уточнить категорию' ||
    normalized === 'изменить категорию' ||
    normalized === 'выбрать категорию' ||
    normalized === 'уточнить жанр' ||
    normalized === 'выбрать жанр' ||
    normalized === 'другой жанр' ||
    normalized === 'уточнить бюджет' ||
    normalized === 'изменить бюджет' ||
    normalized === 'уточнить время' ||
    normalized === 'изменить время' ||
    normalized === 'выбрать время' ||
    normalized === 'уточнить дату' ||
    normalized === 'изменить дату'
  );
}

function looksLikeLeisureRequestText(userMessage) {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;

  const hasMoodOutletRequest =
    /(?:(?:где|куда)\s+(?:можно\s+)?)?(?:поорать|проораться|покричать|выпустить\s+пар|выплеснуть\s+(?:злость|агрессию)|сорвать\s+голос)/u.test(
      normalized
    );

  // Более устойчивое распознавание "хочу рекомендации", чтобы не зависеть от
  // ограниченного списка точных формулировок.
  const hasRecommendationVerb =
    /(?:^|[^\p{L}\p{N}_])(?:хочу|хотел(?:а|о)?(?:сь)?|ищу|ищем|подскажи|подскажите|посоветуй|посоветуйте|предложи|предложите|порекомендуй|порекомендуйте|подбери|подберите|помоги|помогите)(?=$|[^\p{L}\p{N}_])/u.test(
      normalized
    );
  const hasOpenEndedLeisureObject =
    /(?:куда(?:-|\s)?(?:то|нибудь)|где(?:-|\s)?(?:то|нибудь)|что(?:-|\s)?(?:то|нибудь)|чем\s+заняться|как\s+провести\s+(?:\S+\s+){0,2}(?:вечер|время|выходны|день)|куда\s+выбраться|куда\s+сходить|куда\s+пойти|где\s+погулять|чего\s+интересного|что\s+посмотреть|где\s+отдохнуть|что\s+поделать)/u.test(
      normalized
    );
  const hasLeisureAction =
    /(?:сходить|пойти|погулять|развеяться|отдохнуть|выбраться|провести\s+(?:\S+\s+){0,2}(?:вечер|время|выходны|день)|заняться\s+(?:вечером|сегодня|на\s+выходных)|потусить|повеселиться|потанцевать|расслабиться|развлечься)/u.test(
      normalized
    );

  return (
    looksLikeUnknownArtistDiscoveryText(normalized) ||
    hasMoodOutletRequest ||
    (hasRecommendationVerb && (hasOpenEndedLeisureObject || hasLeisureAction)) ||
    /не\s+знаю,\s*что\s+хоч(?:у|ется)/u.test(normalized) ||
    /не\s+знаю,\s*куда\s+(?:сходить|пойти)/u.test(normalized) ||
    /^(?:ну\s+)?(?:посоветуй|посоветуйте|подскажи|подскажите|предложи|предложите)(?:\s+(?:мне\s+)?)?(?:что(?:-|\s)?то|что(?:-|\s)?нибудь)?(?:\s+(?:интересн|популярн|классн|хорош|прикольн))?(?:[.!?]|$)/u.test(
      normalized
    ) ||
    /хочу\s+что(?:-|\s)?(?:то|нибудь)\s+(?:интересн|популярн|классн|хорош|прикольн)/u.test(
      normalized
    ) ||
    /(?:что|чего)\s+(?:интересн|популярн|классн|хорош|прикольн)(?:\s+в\s+городе)?/u.test(
      normalized
    ) ||
    /(?:посоветуй|посоветуйте|подскажи|подскажите|предложи|предложите)\s+(?:(?:что(?:-|\s)?то|что(?:-|\s)?нибудь)\s*)?(?:интересн|популярн|классн|хорош|прикольн)/u.test(
      normalized
    ) ||
    /(?:куда|где)\s*(?:то|нибудь)?\s*(?:можно\s+)?(?:сходить|пойти|погулять)/u.test(normalized) ||
    /хочу\s+(?:(?:куда(?:-|\s)?(?:то|нибудь))\s+)?(?:сходить|пойти|погулять|развеяться|отдохнуть)/u.test(
      normalized
    ) ||
    hasEventDomainSignal(normalized) ||
    /(?:распродаж|скидк|акци)/u.test(normalized)
  );
}

function looksLikeEventFollowUpQuestionText(userMessage) {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;

  if (EVENT_FOLLOW_UP_QUESTION_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  if (EVENT_FOLLOW_UP_PRONOUN_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  return false;
}

function looksLikeNegativeEventFeedbackText(userMessage) {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;

  if (/[?？]/u.test(String(userMessage || ''))) {
    return false;
  }

  const hasNegativeCue =
    /(?:не\s+понрав|не\s+нрав|не\s+заш[её]л|не\s+подош|не\s+устро|разочаров|ужасн|отврат|кошмар|мимо(?![A-Za-zА-Яа-яЁё0-9_]))/u.test(
      normalized
    );

  if (!hasNegativeCue) {
    return false;
  }

  return hasEventDomainSignal(normalized);
}

function looksLikeBudgetConstrainedLeisureRequestText(userMessage) {
  return looksLikeFreeBudgetText(userMessage) && looksLikeLeisureRequestText(userMessage);
}

function hasNonCitySlots(slots = []) {
  const inputSlots = Array.isArray(slots) ? slots.filter(Boolean) : [];
  return inputSlots.some(
    (slot) =>
      slot &&
      typeof slot.name === 'string' &&
      slot.name.trim() !== '' &&
      slot.name !== 'город' &&
      slot.value !== undefined &&
      slot.value !== null &&
      String(slot.value).trim() !== ''
  );
}

function getCitySlotValues(slots = []) {
  const inputSlots = Array.isArray(slots) ? slots.filter(Boolean) : [];

  return inputSlots
    .filter(
      (slot) =>
        slot &&
        typeof slot.name === 'string' &&
        slot.name === 'город' &&
        slot.value !== undefined &&
        slot.value !== null &&
        String(slot.value).trim() !== ''
    )
    .map((slot) => normalizeText(String(slot.value)))
    .filter(Boolean);
}

function looksLikeStandaloneCityReplyText(userMessage, slots = []) {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;

  const cityValues = getCitySlotValues(slots);
  if (cityValues.length === 0 || hasNonCitySlots(slots)) return false;

  const tokens = tokenize(normalized);
  if (tokens.length === 0 || tokens.length > 4) return false;

  return cityValues.some((city) => {
    if (!city) return false;

    return (
      normalized === city ||
      normalized === `в ${city}` ||
      normalized === `город ${city}` ||
      normalized === `г ${city}` ||
      normalized === `город ${city} пожалуйста`
    );
  });
}

function hasArtistSignal(text, slots = []) {
  const inputSlots = Array.isArray(slots) ? slots.filter(Boolean) : [];
  const hasArtistSlot = inputSlots.some((slot) => {
    if (!slot || typeof slot !== 'object') {
      return false;
    }

    const slotName = String(slot.name || '').trim();
    const slotValue = String(slot.value || '').trim();
    return (slotName === 'исполнитель' || slotName === 'артист') && slotValue !== '';
  });

  if (hasArtistSlot) {
    return true;
  }

  return Boolean(resolveHeuristicArtistSlot(text, []));
}

function hasSeniorCompanionSignalText(userMessage) {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;

  return /(?:^|[^\p{L}])(?:бабушк[\p{L}\d]*|бабк[\p{L}\d]*|бабул[\p{L}\d]*|дедушк[\p{L}\d]*|дедул[\p{L}\d]*|дед(?:а|у|ом|е)?|пенсионер[\p{L}\d]*|пожил[\p{L}\d]*|старш[\p{L}\d]*\s+поколени[\p{L}\d]*)(?=$|[^\p{L}])/u.test(
    normalized
  );
}

function looksLikeLikelyOffTopicText(userMessage) {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;

  if (looksLikeClarificationActionText(normalized)) return false;
  if (looksLikeTimeSelectionText(normalized)) return false;
  if (looksLikeDateSelectionText(normalized)) return false;
  if (looksLikeLeisureRequestText(normalized)) return false;
  if (looksLikeBudgetSelectionText(normalized)) return false;
  if (looksLikeShowMoreRequestText(normalized)) return false;
  if (looksLikeTechnicalMetaQuestionText(normalized)) return false;

  const isSmalltalkLike =
    /^(привет|здравствуйте|спасибо|пока|до свидания|ок|okay|хорошо|понятно|ага|угу|да|нет)$/u.test(
      normalized
    );
  if (isSmalltalkLike) return false;

  const hasEventVocabulary = hasEventDomainSignal(normalized);
  if (hasEventVocabulary) return false;

  const tokens = tokenize(normalized);
  if (tokens.length === 0) return false;

  return tokens.length <= 6;
}

function looksLikeRecommendationComplaintText(userMessage) {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;

  const hasRecommendationContext =
    /(?:в\s+прошл(?:ый|ом)\s+раз)/u.test(normalized) ||
    /(?:ты|вы|бот|ассистент)(?:\s+мне)?\s+(?:подобрал|подобрали|предложил|предложили|посоветовал|посоветовали|советовал|советовали|порекомендовал|порекомендовали)/u.test(
      normalized
    ) ||
    /(?:подбор|рекомендац|вариант|событи|мероприят|мест)/u.test(normalized);

  const hasNegativeSignal =
    /(?:ужасн|отврат|плох|неудач|разочаров|не\s+подош|не\s+понрав|не\s+нрав|не\s+устроил|мимо)/u.test(
      normalized
    ) || /(?:слишком\s+дорог|дорого|неудобн|далеко)/u.test(normalized);

  return hasRecommendationContext && hasNegativeSignal;
}

function inferRecommendationComplaintType(userMessage) {
  const normalized = normalizeText(userMessage);
  if (!normalized) return 'generic';

  if (/(?:цен|дорог|дешев|бюджет|стоимост)/u.test(normalized)) return 'price';
  if (/(?:жанр|музык|рок|джаз|рэп|реп|поп|классик|не\s+тот\s+формат)/u.test(normalized))
    return 'genre';
  if (/(?:далеко|район|локац|мест|площадк|зал|неудобн)/u.test(normalized)) return 'location';
  if (/(?:дат|времен|слишком\s+рано|слишком\s+поздно|не\s+в\s+тот\s+день)/u.test(normalized))
    return 'time';
  if (
    /(?:мимо|не\s+подош|не\s+понрав|не\s+заш|не\s+то|не\s+интересно|не\s+попал)/u.test(normalized)
  )
    return 'relevance';

  return 'generic';
}

function textSupportsAssistantCriticismType(normalized, criticismType) {
  if (!normalized) return criticismType === 'generic';

  if (criticismType === 'hostility') {
    return /(?:ненавиж|идиот|дурак|дебил|кретин|мудак|мраз|сволоч|ублюд|туп(?:ой|ая|ые|о)|кончен(?:ый|ая|ое|ые)|ужас(?:ен|на|но|ны)|отвратител|достал(?:а|и)?|задолбал(?:а|и)?|раздража(?:ешь|ет)|выбес(?:ил|ила|ило|или)|фигн(?:ю|я|е)?|ерунд(?:у|а|е)?|чуш(?:ь|ью)?|бред)/u.test(
      normalized
    );
  }

  if (criticismType === 'tone_style') {
    return /(?:тон|стиль|манер|подач|формат|общени|диалог|разговор|звучиш|звучите|лишн(?:ие|их)\s+слов|душн|сухо)/u.test(
      normalized
    );
  }

  if (criticismType === 'trust') {
    return /(?:не\s+доверя|доверия\s+нет|не\s+верю|не\s+убедил|сомневаюсь)/u.test(normalized);
  }

  if (criticismType === 'competence') {
    return /(?:плохо\s+подбира|бесполезн|никчемн|не\s+понима(?:ешь|ете|ет)|не\s+слыш(?:ишь|ите|ит)|толку\s+нет|мимо\s+отвеча(?:ешь|ете|ет))/u.test(
      normalized
    );
  }

  return true;
}

function inferAssistantCriticismType(userMessage) {
  const normalized = normalizeText(userMessage);
  if (!normalized) return 'generic';

  if (
    /(?:ненавиж|идиот|дурак|дебил|кретин|мудак|мраз|сволоч|ублюд|туп(?:ой|ая|ые|о)|кончен(?:ый|ая|ое|ые)|ужас(?:ен|на|но|ны)|отвратител|достал(?:а|и)?|задолбал(?:а|и)?|раздража(?:ешь|ет)|выбес(?:ил|ила|ило|или)|фигн(?:ю|я|е)?|ерунд(?:у|а|е)?|чуш(?:ь|ью)?|бред)/u.test(
      normalized
    )
  ) {
    return 'hostility';
  }

  if (
    /(?:тон|стиль|манер|подач|формат|общени|диалог|разговор|звучиш|звучите|лишн(?:ие|их)\s+слов|душн|сухо)/u.test(
      normalized
    )
  ) {
    return 'tone_style';
  }

  if (/(?:не\s+доверя|доверия\s+нет|не\s+верю|не\s+убедил|сомневаюсь)/u.test(normalized)) {
    return 'trust';
  }

  if (
    /(?:плохо\s+подбира|бесполезн|никчемн|не\s+понима(?:ешь|ете|ет)|не\s+слыш(?:ишь|ите|ит)|толку\s+нет|мимо\s+отвеча(?:ешь|ете|ет))/u.test(
      normalized
    )
  ) {
    return 'competence';
  }

  return 'generic';
}

function inferCriticismIntensity(userMessage, criticismKind = 'generic') {
  const normalized = normalizeText(userMessage);
  if (!normalized) return 'low';

  if (
    criticismKind === 'hostility' ||
    /(?:ненавиж|идиот|дурак|дебил|кретин|мудак|мраз|сволоч|ублюд|туп(?:ой|ая|ые|о)|кончен(?:ый|ая|ое|ые)|задолбал(?:а|и)?|фигн(?:ю|я|е)?|ерунд(?:у|а|е)?|чуш(?:ь|ью)?|бред)/u.test(
      normalized
    )
  ) {
    return 'high';
  }

  if (
    /(?:ужас(?:ен|на|но|ны)|отврат|бесполезн|никчемн|не\s+доверя|не\s+убедил|совсем\s+мимо|слишком\s+дорог|слишком\s+далеко|не\s+понрав|не\s+подош|плохо\s+подбира)/u.test(
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

function buildAssistantCriticismMetadata(userMessage) {
  const criticismType = inferAssistantCriticismType(userMessage);
  const intensity = inferCriticismIntensity(userMessage, criticismType);

  return {
    criticismType,
    intensity,
    replyStyleHint: inferReplyStyleHint(criticismType, intensity),
  };
}

function buildRecommendationComplaintMetadata(userMessage) {
  const complaintType = inferRecommendationComplaintType(userMessage);
  const intensity = inferCriticismIntensity(userMessage, complaintType);

  return {
    complaintType,
    intensity,
  };
}

function enrichCriticismIntent(intent, text) {
  if (!intent || typeof intent !== 'object') {
    return intent;
  }

  if (intent.name === ASSISTANT_CRITICISM_INTENT_NAME) {
    const inferred = buildAssistantCriticismMetadata(text);
    const intentCriticismType = normalizeEnumValue(
      intent.criticismType,
      ASSISTANT_CRITICISM_TYPES,
      ''
    );
    const criticismType =
      intentCriticismType &&
      textSupportsAssistantCriticismType(normalizeText(text), intentCriticismType)
        ? intentCriticismType
        : inferred.criticismType;
    const intensity = normalizeEnumValue(
      intent.intensity,
      CRITICISM_INTENSITIES,
      inferred.intensity
    );
    const inferredReplyStyleHint = inferReplyStyleHint(criticismType, intensity);
    const intentReplyStyleHint = normalizeEnumValue(intent.replyStyleHint, REPLY_STYLE_HINTS, '');
    return {
      ...intent,
      criticismType,
      intensity,
      replyStyleHint:
        criticismType === 'generic' &&
        intentReplyStyleHint &&
        intentReplyStyleHint !== inferredReplyStyleHint
          ? inferredReplyStyleHint
          : normalizeEnumValue(intent.replyStyleHint, REPLY_STYLE_HINTS, inferredReplyStyleHint),
    };
  }

  if (intent.name === RECOMMENDATION_COMPLAINT_INTENT_NAME) {
    const inferred = buildRecommendationComplaintMetadata(text);
    return {
      ...intent,
      complaintType: normalizeEnumValue(
        intent.complaintType,
        RECOMMENDATION_COMPLAINT_TYPES,
        inferred.complaintType
      ),
      intensity: normalizeEnumValue(intent.intensity, CRITICISM_INTENSITIES, inferred.intensity),
    };
  }

  return intent;
}

function looksLikeMoodStateStatementText(userMessage) {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;

  const hasMoodState =
    /(?:^|[^\p{L}])(грустно|тоскливо|хандра|печально|паршиво)(?=$|[^\p{L}])/u.test(normalized) ||
    /настроени[еяюеми]?\s+(?:у\s+меня\s+)?(?:грустн|тосклив|печальн|плох|паршив)/u.test(
      normalized
    ) ||
    /(?:грустн|тосклив|печальн|плох|паршив)\S*\s+настроени/u.test(normalized);

  if (!hasMoodState) return false;

  const hasComplaintContext =
    /(?:подборк|вариант|рекомендац|предложил|предложили|посоветовал|посоветовали|не\s+подош|не\s+понрав|не\s+устро)/u.test(
      normalized
    );

  return !hasComplaintContext;
}

function hasCriticalHealthComplaintSignals(userMessage) {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;

  return /(?:не\s+хочу\s+жить|суицид|самоубий|вызовите\s+скор|скорую|болит|боль|температур|тошнит|головокруж|депресс|паник|тревог|мне\s+плохо|плохо\s+себя|болею)/u.test(
    normalized
  );
}

function looksLikeSoftMoodWithLeisureIntentText(userMessage) {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;

  if (hasCriticalHealthComplaintSignals(normalized)) return false;

  const softMoodCue =
    /(?:мне\s+грустно|грустно|скучно|тоскливо|хочу\s+развеяться|хочу\s+поднять\s+настроение|подними\s+настроение|хочу\s+отвлечься|одиноко|хочу\s+веселья|хочу\s+развеселиться|настроение\s+отвратительное|паршиво\s+настроение|ужасное\s+настроение)/u;
  const explicitLeisureRequest =
    /(?:хочу\s+на\s+|подобра(?:ть|й)|посоветуй|предложи|найди|куда\s+сходить|хочу\s+куда(?:-|\s)?то\s+сходить|хочу\s+пойти|где\s+можно\s+поорать|где\s+можно\s+покричать|выпустить\s+пар)/u;

  return softMoodCue.test(normalized) && explicitLeisureRequest.test(normalized);
}

function looksLikeAssistantDirectedHostilityText(userMessage) {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;

  const assistantTarget =
    /(?:^|[\s,.!?;:])(ты|тебя|тебе|тобой|твой|твоя|твое|твои|вы|вас|вам|вами|бот|ассистент|ии|искусственн(?:ый|ого)\s+интеллект)(?=$|[\s,.!?;:])/u;
  const hostilitySignal =
    /(?:ненавиж|презира|терпеть\s+не\s+могу|бес(?:ишь|ит)|раздража(?:ешь|ет)|выбес(?:ил|ила|ило|или)|достал(?:а|и)?|задолбал(?:а|и)?|ужас(?:ен|на|но|ны)|отвратител(?:ен|ьн)|омерзител(?:ен|ьн)|мерз(?:ок|ка|ко|ки|кий|кая|кое|кие)|туп(?:ой|ая|ое|ые)|идиот|дурак|дебил|кретин|мудак|мраз(?:ь|ьё)|сволоч|ублюд|бесполезн|никчемн)/u;
  const directCriticismSignal =
    /(?:не\s+нрав(?:ишься|итесь|ится)|не\s+нрав(?:ит|ятся)\s+(?:твой|ваш)\s+(?:тон|стиль|манер|подход|ответ|формат|общени|диалог)|тон\s+не\s+заш(?:е|ё)л|стиль\s+не\s+заш(?:е|ё)л|не\s+доверя|доверия\s+нет|не\s+убедил|сомневаюсь)/u;
  const dismissiveRecommendationCriticism =
    /(?:ты|вы|бот|ассистент)(?:\s+(?:мне|нам))?(?:\s+(?:опять|вечно|постоянно))?\s+(?:подбира(?:ешь|ете|ет)|предлага(?:ешь|ете|ет)|совету(?:ешь|ете|ет)|рекоменду(?:ешь|ете|ет))(?:(?:\s+\S+){0,4})\s+(?:какую[- ]?то\s+)?(?:фигн(?:ю|я|е)?|ерунд(?:у|а|е)?|чуш(?:ь|ью)?|бред|мусор)/u;

  if (!assistantTarget.test(normalized)) return false;
  if (dismissiveRecommendationCriticism.test(normalized)) return true;
  if (hostilitySignal.test(normalized)) return true;
  return directCriticismSignal.test(normalized);
}

function looksLikeAssistantLivenessQuestionText(userMessage) {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;
  if (looksLikeTechnicalMetaQuestionText(normalized)) return false;

  const assistantTarget =
    /(?:^|[\s,.!?;:])(ты|вы|вас|вам|бот|ассистент|ии|нейросеть|искусственн(?:ый|ого)\s+интеллект)(?=$|[\s,.!?;:])/u;
  const livenessCue =
    /(?:жив(?:ой|а|ое|ые)|человек|бот(?:ик|яра)?|реальн(?:ый|ая|ое)|настоящ(?:ий|ая|ее|ий\s+человек))/u;
  const identityQuestionCue =
    /(?:кто\s+ты|кто\s+вы|ты\s+кто|вы\s+кто|ты\s+жив(?:ой|а)?|вы\s+жив(?:ой|ы|ые)?|ты\s+человек|вы\s+человек|ты\s+бот|вы\s+бот|или\s+нет)/u;

  if (!assistantTarget.test(normalized)) return false;
  return livenessCue.test(normalized) || identityQuestionCue.test(normalized);
}

function looksLikeTechnicalMetaQuestionText(userMessage) {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;

  const eventLanguageContext = /(спектакл|постановк|фильм|сеанс|субтитр|озвучк|перевод|оригинал)/u;
  if (eventLanguageContext.test(normalized) && /на\s+каком\s+язык(?:е|у)/u.test(normalized)) {
    return false;
  }

  const eventContext =
    /(концерт|спектакл|театр|выставк|музе|стендап|кино|билет|афиш|событи|мероприят)/u;
  const metaEntity =
    /(ты|вы|вас|бот|ассистент|программа|нейросет|ии|искусственн(?:ый|ого)\s+интеллект)/u;
  const explicitTech =
    /(язык(?:а|е)?\s+программ|программир|исходник|исходны(?:й|е)\s+код|код(?:а|е|у|ом)?(?:\s|$|[!?.,:;])|стек|технологи|фреймворк|библиотек|архитектур|модель|llm|chatgpt|openai|gpt)/u;

  if (explicitTech.test(normalized)) {
    if (metaEntity.test(normalized)) return true;
    if (eventContext.test(normalized)) return false;
    return true;
  }

  const asksLanguage = /на\s+каком\s+язык(?:е|у)(?:\s|$|[!?.,:;])/u.test(normalized);
  const mentionsImplementation =
    /(написан|написаны|сделан|сделаны|работаешь|работает|устроен|устроены|создан|созданы)/u.test(
      normalized
    );

  if (asksLanguage && metaEntity.test(normalized) && mentionsImplementation) return true;

  const asksOnWhat = /на\s+чем(?:\s|$)/u.test(normalized);
  if (asksOnWhat && metaEntity.test(normalized) && mentionsImplementation) return true;

  const asksHowWorks =
    /(как\s+(?:вы|ты)\s+(?:работа(?:ет|ете|ешь)|устро(?:ен|ены|ена)|сдела(?:н|ны)|созда(?:н|ны)))/u.test(
      normalized
    );
  if (asksHowWorks && metaEntity.test(normalized)) {
    if (eventContext.test(normalized)) return false;
    return true;
  }

  return false;
}

function looksLikeShowMoreRequestText(userMessage) {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;

  const compact = normalized.replace(/\s+/g, ' ').trim();
  const tokens = tokenize(compact);

  if (
    compact === 'покажи все' ||
    compact === 'покажи всё' ||
    compact === 'показать все' ||
    compact === 'показать всё' ||
    compact === 'еще' ||
    compact === 'ещё' ||
    compact === 'а еще' ||
    compact === 'а ещё' ||
    compact === 'и еще' ||
    compact === 'и ещё'
  ) {
    return true;
  }

  if (compact === 'показать другие варианты') return true;

  if (compact === 'а еще что' || compact === 'а ещё что') return true;
  if (compact === 'еще что' || compact === 'ещё что') return true;
  if (compact === 'что еще' || compact === 'что ещё') return true;
  if (compact === 'что еще есть' || compact === 'что ещё есть') return true;

  const allowedTail = new Set([
    'что',
    'вариант',
    'варианты',
    'события',
    'событие',
    'мероприятия',
    'мероприятие',
    'концерт',
    'концерты',
    'спектакль',
    'спектакли',
    'матч',
    'матчи',
    'игра',
    'игры',
  ]);

  if (tokens.length >= 2 && (tokens[0] === 'еще' || tokens[0] === 'ещё')) {
    if (tokens.length <= 3 && allowedTail.has(tokens[1])) return true;
  }
  if (tokens.length >= 3 && tokens[0] === 'а' && (tokens[1] === 'еще' || tokens[1] === 'ещё')) {
    if (tokens.length <= 4 && allowedTail.has(tokens[2])) return true;
  }

  if (
    /(?:^|\s)друг(?:ие|ой|ую)\s+(?:вариант|событи|мероприят|концерт|спектакл|матч|игр)/u.test(
      compact
    )
  ) {
    return true;
  }

  if (/(?:^|\s)(покажи|показать)\s+ещ[её](?:\s|$)/u.test(compact)) return true;
  if (
    /(?:^|\s)ещ[её]\s+(?:вариант|событи|мероприят|концерт|спектакл|матч|игр)(?:\s|$)/u.test(compact)
  )
    return true;

  if (/^(?:дальше|далее|продолжай|следующие)(?:\s|$)/u.test(compact)) return true;

  return false;
}

function hasExplicitContinuationRequestText(userMessage) {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;

  if (looksLikeShowMoreRequestText(normalized)) {
    return true;
  }

  if (looksLikeBuyTicketText(normalized)) {
    return true;
  }

  return (
    /(?:^|\s)(покажи|показать|подбери|подобрать|найди|найти|посоветуй|посоветовать|предложи|предложить)(?:\s|$)/u.test(
      normalized
    ) ||
    /(?:^|\s)(хочу|давай)\s+(?:еще|ещё|еще\s+варианты|ещё\s+варианты)/u.test(normalized) ||
    /(?:^|\s)(что|а)\s+еще(?:\s|$)/u.test(normalized) ||
    /(?:^|\s)еще\s+(?:вариант|варианты|событи|мероприят|концерт|спектакл)/u.test(normalized) ||
    /(?:^|\s)ещё\s+(?:вариант|варианты|событи|мероприят|концерт|спектакл)/u.test(normalized)
  );
}

function detectSoftClosureSmalltalkKind(userMessage) {
  const normalized = normalizeText(userMessage);
  if (!normalized) return null;

  if (hasExplicitContinuationRequestText(normalized)) {
    return null;
  }

  if (
    /(?:^|\s)(пока|до\s+свидания|до\s+встречи|всего\s+доброго|хорошего\s+дня|хорошего\s+вечера)(?:\s|$)/u.test(
      normalized
    )
  ) {
    return 'farewell';
  }

  if (/(?:^|\s)(спасибо|благодарю|благодарствую|спс|пасиб)(?:\s|$)/u.test(normalized)) {
    return 'thanks';
  }

  return null;
}

function shouldDropOffTopicIntent(intents = [], slots = [], text = '') {
  const inputIntents = Array.isArray(intents) ? intents.filter(Boolean) : [];
  if (inputIntents.length === 0) return false;

  const hasOffTopic = inputIntents.some((intent) => intent?.name === OFF_TOPIC_INTENT_NAME);
  if (!hasOffTopic) return false;
  const hasModelOffTopic = hasAuthoritativeModelOffTopicIntent(inputIntents);

  const hasTechnicalMeta = inputIntents.some(
    (intent) => intent?.name === TECHNICAL_META_INTENT_NAME
  );
  if (hasTechnicalMeta) return true;

  // Если off_topic уже пришел от LLM, не снимаем его только из-за эвристик "досугового" текста.
  // Это защищает от ложных срабатываний вроде "курс доллара" -> "курс" -> "образование".
  if (hasModelOffTopic) {
    const hasModelCounterIntent = inputIntents.some((intent) => {
      if (!isModelIntent(intent)) {
        return false;
      }
      if (intent?.name === OFF_TOPIC_INTENT_NAME || intent?.name === SMALLTALK_INTENT_NAME) {
        return false;
      }
      return typeof intent.confidence !== 'number' || intent.confidence >= 0.7;
    });

    if (!hasModelCounterIntent) {
      return false;
    }
  }

  if (looksLikeLeisureRequestText(text) || looksLikeShowMoreRequestText(text)) {
    return true;
  }

  if (looksLikeStandaloneCityReplyText(text, slots)) {
    return true;
  }

  const hasStrongNonOffTopic = inputIntents.some(
    (slot) =>
      slot &&
      typeof slot.name === 'string' &&
      slot.name !== OFF_TOPIC_INTENT_NAME &&
      slot.name !== RECOMMENDATIONS_INTENT_NAME &&
      slot.name !== SMALLTALK_INTENT_NAME
  );
  if (hasStrongNonOffTopic) return true;

  const hasRecommendations = inputIntents.some(
    (intent) => intent?.name === RECOMMENDATIONS_INTENT_NAME
  );
  if (hasRecommendations && looksLikeLeisureRequestText(text)) return true;

  if (hasArtistSignal(text, slots)) return true;

  // Не убираем off_topic только из-за наличия не городских слотов:
  // а то слот может быть галлюцинацией извлечения.
  if (hasNonCitySlots(slots) && !looksLikeLeisureRequestText(text)) return false;

  return false;
}

export function applyIntentHeuristics(text, intents = [], slots = []) {
  const input = Array.isArray(intents) ? intents.filter(Boolean) : [];
  const inputWithoutInvalidBuyTicket = looksLikeBuyTicketText(text)
    ? input
    : input.filter((intent) => intent?.name !== BUY_TICKET_INTENT_NAME);
  const sanitizedBase = shouldDropOffTopicIntent(inputWithoutInvalidBuyTicket, slots, text)
    ? inputWithoutInvalidBuyTicket.filter((intent) => intent?.name !== OFF_TOPIC_INTENT_NAME)
    : inputWithoutInvalidBuyTicket;
  const sanitized = sanitizedBase.map((intent) => enrichCriticismIntent(intent, text));
  const slashCommand = extractSlashCommand(text);

  if (slashCommand) {
    return [
      {
        name: OFF_TOPIC_INTENT_NAME,
        confidence: 0.99,
        trigger: slashCommand,
        source: 'slash_command',
      },
    ];
  }

  if (looksLikeStandaloneCityReplyText(text, slots)) {
    return sanitized.filter((intent) => intent?.name !== OFF_TOPIC_INTENT_NAME);
  }

  if (
    hasAuthoritativeModelOffTopicIntent(sanitized) &&
    !hasAuthoritativeModelCounterIntent(sanitized) &&
    !looksLikeClarificationActionText(text) &&
    !looksLikeNegativeEventFeedbackText(text) &&
    !looksLikeRecommendationComplaintText(text) &&
    !looksLikeAssistantDirectedHostilityText(text) &&
    !looksLikeEventFollowUpQuestionText(text)
  ) {
    return sanitized.filter((intent) => intent?.name !== RECOMMENDATIONS_INTENT_NAME);
  }

  if (looksLikeGenericNonEventPurchaseText(text)) {
    const withoutPurchaseNoise = sanitized.filter(
      (intent) =>
        intent?.name !== BUY_TICKET_INTENT_NAME &&
        intent?.name !== RECOMMENDATIONS_INTENT_NAME &&
        intent?.name !== OFF_TOPIC_INTENT_NAME
    );

    if (hasMeaningfulExtractedSlots(slots)) {
      return withoutPurchaseNoise;
    }

    return [
      ...withoutPurchaseNoise,
      {
        name: OFF_TOPIC_INTENT_NAME,
        confidence: 0.95,
        trigger: String(text || '').trim(),
        source: 'heuristic',
      },
    ];
  }

  const hasGenericDesireNoise =
    sanitized.some(
      (intent) =>
        intent?.name === RECOMMENDATIONS_INTENT_NAME || intent?.name === OFF_TOPIC_INTENT_NAME
    ) || slots.some((slot) => slot?.name === 'поисковый_запрос');
  const hasOnlyGenericDesireNoise = sanitized.every((intent) => {
    const intentName = intent?.name;
    return (
      intentName === RECOMMENDATIONS_INTENT_NAME ||
      intentName === OFF_TOPIC_INTENT_NAME ||
      intentName === SMALLTALK_INTENT_NAME ||
      intentName === BUY_TICKET_INTENT_NAME
    );
  });

  if (
    hasGenericDesireNoise &&
    hasOnlyGenericDesireNoise &&
    (looksLikeGenericNonEventDesireText(text, slots) ||
      looksLikeGenericNonEventLookupText(text, slots))
  ) {
    const withoutDesireNoise = sanitized.filter(
      (intent) =>
        intent?.name !== BUY_TICKET_INTENT_NAME &&
        intent?.name !== RECOMMENDATIONS_INTENT_NAME &&
        intent?.name !== OFF_TOPIC_INTENT_NAME
    );

    if (hasMeaningfulExtractedSlots(slots)) {
      return withoutDesireNoise;
    }

    return [
      ...withoutDesireNoise,
      {
        name: OFF_TOPIC_INTENT_NAME,
        confidence: 0.95,
        trigger: String(text || '').trim(),
        source: 'heuristic',
      },
    ];
  }

  if (sanitized.some((intent) => intent?.name === NEGATIVE_EVENT_FEEDBACK_INTENT_NAME)) {
    if (looksLikeMoodStateStatementText(text)) {
      const withoutNegativeFeedback = sanitized.filter(
        (intent) =>
          intent?.name !== NEGATIVE_EVENT_FEEDBACK_INTENT_NAME &&
          intent?.name !== OFF_TOPIC_INTENT_NAME
      );
      const hasRecommendationsIntent = withoutNegativeFeedback.some(
        (intent) => intent?.name === RECOMMENDATIONS_INTENT_NAME
      );

      return hasRecommendationsIntent
        ? withoutNegativeFeedback
        : [
            ...withoutNegativeFeedback,
            {
              name: RECOMMENDATIONS_INTENT_NAME,
              confidence: 0.93,
              trigger: String(text || '').trim(),
              source: 'heuristic_mood_state',
            },
          ];
    }
    return sanitized.filter((intent) => intent?.name !== OFF_TOPIC_INTENT_NAME);
  }

  if (sanitized.some((intent) => intent?.name === RECOMMENDATION_COMPLAINT_INTENT_NAME)) {
    return sanitized.filter((intent) => intent?.name !== OFF_TOPIC_INTENT_NAME);
  }

  if (sanitized.some((intent) => intent?.name === ASSISTANT_CRITICISM_INTENT_NAME)) {
    return sanitized.filter((intent) => intent?.name !== OFF_TOPIC_INTENT_NAME);
  }

  if (hasSeniorCompanionSignalText(text) && looksLikeLeisureRequestText(text)) {
    const filteredIntents = sanitized.filter((intent) => {
      const intentName = String(intent?.name || '').trim();
      if (!intentName) return false;

      if (
        intentName === 'change_city' ||
        intentName === 'change_date' ||
        intentName === 'change_preferences'
      ) {
        return false;
      }

      if (intentName === 'контекст_события' || intentName === 'возрастное_ограничение') {
        return false;
      }

      return true;
    });

    const hasRecommendationsIntent = filteredIntents.some(
      (intent) => intent?.name === RECOMMENDATIONS_INTENT_NAME
    );

    return [
      ...filteredIntents,
      {
        name: 'контекст_события',
        value: 'семейный',
        confidence: 0.98,
        trigger: String(text || '').trim(),
        source: 'heuristic',
      },
      {
        name: 'возрастное_ограничение',
        value: 'взрослые',
        confidence: 0.98,
        trigger: String(text || '').trim(),
        source: 'heuristic',
      },
      ...(hasRecommendationsIntent
        ? []
        : [
            {
              name: RECOMMENDATIONS_INTENT_NAME,
              confidence: 0.94,
              trigger: String(text || '').trim(),
              source: 'heuristic',
            },
          ]),
    ];
  }

  if (looksLikeEventFollowUpQuestionText(text)) {
    const withoutNoise = sanitized.filter(
      (intent) =>
        intent?.name !== OFF_TOPIC_INTENT_NAME &&
        intent?.name !== RECOMMENDATIONS_INTENT_NAME &&
        intent?.name !== SMALLTALK_INTENT_NAME
    );
    const alreadyHasEventDetails = withoutNoise.some(
      (intent) => intent?.name === EVENT_DETAILS_INTENT_NAME
    );
    if (!alreadyHasEventDetails) {
      return [
        ...withoutNoise,
        {
          name: EVENT_DETAILS_INTENT_NAME,
          confidence: 0.95,
          trigger: String(text || '').trim(),
          source: 'heuristic',
        },
      ];
    }
    return withoutNoise;
  }

  if (looksLikeBudgetSelectionText(text)) {
    return sanitized.filter((intent) => intent?.name !== OFF_TOPIC_INTENT_NAME);
  }

  if (looksLikeUnknownArtistDiscoveryText(text)) {
    const withoutNoise = sanitized.filter(
      (intent) => intent?.name !== OFF_TOPIC_INTENT_NAME && intent?.name !== SMALLTALK_INTENT_NAME
    );
    const hasRecommendationsIntent = withoutNoise.some(
      (intent) => intent?.name === RECOMMENDATIONS_INTENT_NAME
    );

    if (hasRecommendationsIntent) {
      return withoutNoise;
    }

    return [
      ...withoutNoise,
      {
        name: RECOMMENDATIONS_INTENT_NAME,
        confidence: 0.95,
        trigger: String(text || '').trim(),
        source: 'heuristic',
      },
    ];
  }

  if (looksLikeClarificationActionText(text)) {
    return sanitized.filter((intent) => intent?.name !== OFF_TOPIC_INTENT_NAME);
  }

  if (looksLikeTimeSelectionText(text)) {
    return sanitized.filter((intent) => intent?.name !== OFF_TOPIC_INTENT_NAME);
  }

  if (looksLikeDateSelectionText(text)) {
    return sanitized.filter((intent) => intent?.name !== OFF_TOPIC_INTENT_NAME);
  }

  const softClosureKind = detectSoftClosureSmalltalkKind(text);
  if (softClosureKind) {
    const cleanedIntents = sanitized.filter(
      (intent) =>
        intent?.name !== OFF_TOPIC_INTENT_NAME &&
        intent?.name !== RECOMMENDATIONS_INTENT_NAME &&
        intent?.name !== 'show_more_results'
    );
    const existingSmalltalkIntent = cleanedIntents.find(
      (intent) => intent?.name === SMALLTALK_INTENT_NAME
    );

    if (existingSmalltalkIntent) {
      return cleanedIntents.map((intent) => {
        if (intent?.name !== SMALLTALK_INTENT_NAME) {
          return intent;
        }

        const currentConfidence = typeof intent.confidence === 'number' ? intent.confidence : 0;
        return {
          ...intent,
          kind: intent.kind || softClosureKind,
          confidence: Math.max(currentConfidence, 0.96),
        };
      });
    }

    return [
      ...cleanedIntents,
      {
        name: SMALLTALK_INTENT_NAME,
        kind: softClosureKind,
        confidence: 0.96,
        trigger: String(text || '').trim(),
        source: 'heuristic',
      },
    ];
  }

  // BUY_TICKET: Если пользователь явно хочет купить билет — добавляем интент с высоким приоритетом.
  // Делаем это в первую очередь, чтобы он не был перекрыт off_topic или recommendations.
  if (looksLikeBuyTicketText(text)) {
    const alreadyHasBuyTicket = sanitized.some((intent) => intent?.name === BUY_TICKET_INTENT_NAME);
    if (!alreadyHasBuyTicket) {
      return [
        ...sanitized.filter((intent) => intent?.name !== OFF_TOPIC_INTENT_NAME),
        {
          name: BUY_TICKET_INTENT_NAME,
          confidence: 0.95,
          trigger: String(text || '').trim(),
          source: 'heuristic',
        },
      ];
    }
  }

  if (looksLikeRecommendationComplaintText(text)) {
    const withoutHealthComplaint = sanitized.filter(
      (intent) => intent?.name !== HEALTH_COMPLAINT_INTENT_NAME
    );
    const withoutOffTopic = withoutHealthComplaint.filter(
      (intent) => intent?.name !== OFF_TOPIC_INTENT_NAME
    );
    const hasRecommendationComplaint = withoutOffTopic.some(
      (intent) => intent?.name === RECOMMENDATION_COMPLAINT_INTENT_NAME
    );
    if (hasRecommendationComplaint) {
      return withoutOffTopic;
    }
    return [
      ...withoutOffTopic,
      {
        name: RECOMMENDATION_COMPLAINT_INTENT_NAME,
        confidence: 0.92,
        trigger: String(text || '').trim(),
        source: 'heuristic',
        ...buildRecommendationComplaintMetadata(text),
      },
    ];
  }

  if (looksLikeNegativeEventFeedbackText(text)) {
    return sanitized.filter((intent) => intent?.name !== OFF_TOPIC_INTENT_NAME);
  }

  if (looksLikeAssistantDirectedHostilityText(text)) {
    const hadHealthComplaint = sanitized.some(
      (intent) => intent?.name === HEALTH_COMPLAINT_INTENT_NAME
    );
    const withoutHealthComplaint = sanitized.filter(
      (intent) => intent?.name !== HEALTH_COMPLAINT_INTENT_NAME
    );
    const withoutOffTopic = withoutHealthComplaint.filter(
      (intent) => intent?.name !== OFF_TOPIC_INTENT_NAME
    );
    const hasAssistantCriticism = withoutOffTopic.some(
      (intent) => intent?.name === ASSISTANT_CRITICISM_INTENT_NAME
    );
    if (hasAssistantCriticism) {
      return withoutOffTopic;
    }
    if (hadHealthComplaint) {
      return [
        ...withoutOffTopic,
        {
          name: OFF_TOPIC_INTENT_NAME,
          confidence: 0.96,
          trigger: String(text || '').trim(),
          source: 'heuristic',
        },
      ];
    }
    if (shouldSuppressHeuristicAssistantCriticism(sanitized, slots)) {
      return withoutOffTopic;
    }
    return [
      ...withoutOffTopic,
      {
        name: ASSISTANT_CRITICISM_INTENT_NAME,
        confidence: 0.96,
        trigger: String(text || '').trim(),
        source: 'heuristic',
        ...buildAssistantCriticismMetadata(text),
      },
    ];
  }

  if (looksLikeAssistantLivenessQuestionText(text)) {
    const withoutSmalltalkAndHealth = sanitized.filter(
      (intent) =>
        intent?.name !== SMALLTALK_INTENT_NAME && intent?.name !== HEALTH_COMPLAINT_INTENT_NAME
    );
    const hasOffTopic = withoutSmalltalkAndHealth.some(
      (intent) => intent?.name === OFF_TOPIC_INTENT_NAME
    );
    if (hasOffTopic) {
      return withoutSmalltalkAndHealth;
    }
    return [
      ...withoutSmalltalkAndHealth,
      {
        name: OFF_TOPIC_INTENT_NAME,
        confidence: 0.96,
        trigger: String(text || '').trim(),
        source: 'heuristic',
      },
    ];
  }

  if (looksLikeSoftMoodWithLeisureIntentText(text)) {
    const withoutHealthComplaint = sanitized.filter(
      (intent) => intent?.name !== HEALTH_COMPLAINT_INTENT_NAME
    );
    const hasRecommendationsIntent = withoutHealthComplaint.some(
      (intent) => intent?.name === RECOMMENDATIONS_INTENT_NAME
    );

    if (hasRecommendationsIntent) {
      return withoutHealthComplaint;
    }

    return [
      ...withoutHealthComplaint.filter((intent) => intent?.name !== SMALLTALK_INTENT_NAME),
      {
        name: RECOMMENDATIONS_INTENT_NAME,
        confidence: 0.95,
        trigger: String(text || '').trim(),
        source: 'heuristic',
      },
    ];
  }

  const hasTechnicalMeta = sanitized.some((intent) => intent?.name === TECHNICAL_META_INTENT_NAME);
  if (hasTechnicalMeta) {
    return sanitized.filter((intent) => intent?.name !== OFF_TOPIC_INTENT_NAME);
  }
  if (!hasTechnicalMeta && looksLikeTechnicalMetaQuestionText(text)) {
    const hasNonOffTopic = sanitized.some(
      (intent) => intent?.name && intent.name !== OFF_TOPIC_INTENT_NAME
    );
    if (!hasNonOffTopic) {
      const withoutOffTopic = sanitized.filter((intent) => intent?.name !== OFF_TOPIC_INTENT_NAME);
      return [
        ...withoutOffTopic,
        {
          name: TECHNICAL_META_INTENT_NAME,
          confidence: 0.95,
          trigger: String(text || '').trim(),
          source: 'heuristic',
        },
      ];
    }
  }

  if (looksLikeBudgetConstrainedLeisureRequestText(text)) {
    const withoutOffTopic = sanitized.filter((intent) => intent?.name !== OFF_TOPIC_INTENT_NAME);
    const hasStrongNonOffTopic = withoutOffTopic.some(
      (intent) =>
        intent?.name &&
        intent.name !== OFF_TOPIC_INTENT_NAME &&
        intent.name !== SMALLTALK_INTENT_NAME
    );
    if (hasStrongNonOffTopic) {
      return withoutOffTopic;
    }
    const withoutSmalltalk = withoutOffTopic.filter(
      (intent) => intent?.name !== SMALLTALK_INTENT_NAME
    );
    return [
      ...withoutSmalltalk,
      {
        name: RECOMMENDATIONS_INTENT_NAME,
        confidence: 0.93,
        trigger: String(text || '').trim(),
        source: 'heuristic',
      },
    ];
  }

  if (looksLikeLeisureRequestText(text) && !looksLikeShowMoreRequestText(text)) {
    const withoutNoise = sanitized.filter(
      (intent) => intent?.name !== OFF_TOPIC_INTENT_NAME && intent?.name !== SMALLTALK_INTENT_NAME
    );
    const hasRecommendationsIntent = withoutNoise.some(
      (intent) => intent?.name === RECOMMENDATIONS_INTENT_NAME
    );
    const hasStrongNonOffTopicIntent = withoutNoise.some(
      (intent) =>
        intent?.name &&
        intent.name !== RECOMMENDATIONS_INTENT_NAME &&
        intent.name !== SMALLTALK_INTENT_NAME
    );

    if (!hasStrongNonOffTopicIntent && !hasRecommendationsIntent) {
      return [
        ...withoutNoise,
        {
          name: RECOMMENDATIONS_INTENT_NAME,
          confidence: 0.94,
          trigger: String(text || '').trim(),
          source: 'heuristic',
        },
      ];
    }

    if (hasRecommendationsIntent) {
      return withoutNoise;
    }
  }

  const hasRecommendations = sanitized.some(
    (intent) => intent?.name === RECOMMENDATIONS_INTENT_NAME
  );
  const hasOffTopic = sanitized.some((intent) => intent?.name === OFF_TOPIC_INTENT_NAME);
  const hasSmalltalk = sanitized.some((intent) => intent?.name === SMALLTALK_INTENT_NAME);
  const hasStrongNonOffTopic = sanitized.some(
    (intent) =>
      intent &&
      intent.name &&
      intent.name !== OFF_TOPIC_INTENT_NAME &&
      intent.name !== RECOMMENDATIONS_INTENT_NAME &&
      intent.name !== SMALLTALK_INTENT_NAME
  );
  const hasNonCitySlot = hasNonCitySlots(slots);
  const hasLeisureSignal = looksLikeLeisureRequestText(text) || looksLikeShowMoreRequestText(text);

  if (!hasLeisureSignal && !hasSmalltalk && !hasStrongNonOffTopic) {
    if (hasRecommendations && !hasNonCitySlot) {
      const withoutRecommendations = sanitized.filter(
        (intent) =>
          intent?.name !== RECOMMENDATIONS_INTENT_NAME && intent?.name !== OFF_TOPIC_INTENT_NAME
      );
      return [
        ...withoutRecommendations,
        {
          name: OFF_TOPIC_INTENT_NAME,
          confidence: 0.95,
          trigger: String(text || '').trim(),
          source: 'heuristic',
        },
      ];
    }

    if (
      !hasRecommendations &&
      !hasOffTopic &&
      !hasNonCitySlot &&
      looksLikeLikelyOffTopicText(text)
    ) {
      return [
        ...sanitized,
        {
          name: OFF_TOPIC_INTENT_NAME,
          confidence: 0.95,
          trigger: String(text || '').trim(),
          source: 'heuristic',
        },
      ];
    }
  }

  const hasShowMore = sanitized.some((intent) => intent?.name === 'show_more_results');
  if (hasShowMore) return sanitized;

  const hasNonOffTopic = sanitized.some(
    (intent) => intent?.name && intent.name !== OFF_TOPIC_INTENT_NAME
  );
  const hasOffTopicForShowMore = sanitized.some((intent) => intent?.name === OFF_TOPIC_INTENT_NAME);

  if (!looksLikeShowMoreRequestText(text)) {
    return sanitized;
  }

  if (hasNonOffTopic) return sanitized;
  if (!hasOffTopicForShowMore && sanitized.length > 0) return sanitized;

  return [
    {
      name: 'show_more_results',
      confidence: 0.95,
      trigger: String(text || '').trim(),
      source: 'heuristic',
    },
  ];
}
