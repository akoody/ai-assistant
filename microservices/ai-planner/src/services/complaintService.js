import { parseBudgetValue } from '../../../../shared/moneyUtils.js';

const ROOT_COMPLAINT_BUTTONS = Object.freeze([
  'Не подошел жанр',
  'Не устроила цена',
  'Начать с чистого листа',
]);

const CATEGORY_RESTART_BUTTONS = Object.freeze([
  'Концерты',
  'Театры',
  'Выставки',
  'Музеи',
  'Покажи все',
]);

const FOLLOW_UP_BUTTONS = Object.freeze({
  genre_menu: ['Указать нежелательные жанры', 'Начать с чистого листа'],
  price_menu: ['Указать комфортный бюджет', 'Начать с чистого листа'],
  venue_menu: ['Указать нежелательные места', 'Начать с чистого листа'],
  other_menu: ['Написать подробнее', 'Начать с чистого листа'],
});

const KNOWN_GENRES = Object.freeze([
  'рок',
  'поп',
  'джаз',
  'классика',
  'рэп',
  'хип-хоп',
  'хип хоп',
  'метал',
  'шансон',
  'инди',
  'блюз',
  'электроника',
  'электронная музыка',
  'регги',
  'панк',
  'диско',
  'фолк',
]);

const GENRE_SLOT_NAMES = new Set(['жанр', 'жанр_музыки', 'предпочтения_жанры']);
const COMPLAINT_RESTART_SLOT_NAMES = Object.freeze([
  'тип_мероприятия',
  'тип_события',
  'жанр',
  'жанр_музыки',
  'предпочтения_жанры',
  'исполнитель',
  'название_мероприятия',
  'поисковый_запрос',
  'настроение',
]);

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupe(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function formatList(values = []) {
  const items = dedupe(values);
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} и ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} и ${items[items.length - 1]}`;
}

function hasNegativeSentiment(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;

  return (
    /(?:ужасн|отврат|кошмар|неудач|плох|мимо|разочаров|не\s+понрав|не\s+нрав|не\s+зашл|не\s+подош|не\s+устроил|не\s+то)/u.test(
      normalized
    ) || /(?:слишком\s+дорог|дороговато|дорого|неудобн|далеко|скучн|шумн)/u.test(normalized)
  );
}

function hasRecommendationContext(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;

  return (
    /(?:в\s+прошл(?:ый|ом)\s+раз)/u.test(normalized) ||
    /(?:ты|вы|бот|ассистент)(?:\s+мне)?\s+(?:подобрал|подобрали|предложил|предложили|посоветовал|посоветовали|советовал|советовали|порекомендовал|порекомендовали)/u.test(
      normalized
    ) ||
    /(?:подбор|подборка|рекомендац|вариант|событи|мероприят|афиш|мест)/u.test(normalized)
  );
}

function pickComplaintReason(text) {
  const normalized = normalizeText(text);
  if (!normalized) return null;

  if (normalized === normalizeText(ROOT_COMPLAINT_BUTTONS[0]) || /(?:^|\s)жанр/u.test(normalized)) {
    return 'genre';
  }
  if (
    normalized === normalizeText(ROOT_COMPLAINT_BUTTONS[1]) ||
    /(?:^|\s)(?:цен|дорог|дешев|бюджет|стоимост)/u.test(normalized)
  ) {
    return 'price';
  }
  if (
    normalized === normalizeText(ROOT_COMPLAINT_BUTTONS[2]) ||
    /(?:^|\s)(?:мест|площадк|зал|локац|район|далеко|неудобн)/u.test(normalized)
  ) {
    return 'venue';
  }
  if (
    normalized === normalizeText(ROOT_COMPLAINT_BUTTONS[3]) ||
    /(?:^|\s)друг/u.test(normalized) ||
    /^(?:все|вс[её])$/u.test(normalized) ||
    /(?:^|\s)(?:все\s+не|вообще\s+все|все\s+мимо|все\s+плохо|абсолютно\s+все)/u.test(normalized)
  ) {
    return 'other';
  }

  return null;
}

function isStartOverAction(text) {
  return normalizeText(text) === 'начать с чистого листа';
}

function isGenreDetailAction(text) {
  return normalizeText(text) === 'указать нежелательные жанры';
}

function isPriceDetailAction(text) {
  return normalizeText(text) === 'указать комфортный бюджет';
}

function isVenueDetailAction(text) {
  return normalizeText(text) === 'указать нежелательные места';
}

function isOtherDetailAction(text) {
  return normalizeText(text) === 'написать подробнее';
}

function buildRestartResponse() {
  return {
    replyKind: 'complaint_restart',
    message:
      'Начинаем с чистого листа. Сброшу прошлые предпочтения и соберем новый подбор заново. Что вам сейчас интересно?',
    buttons: [...CATEGORY_RESTART_BUTTONS],
    offer: null,
  };
}

function buildComplaintStartResponse() {
  return {
    replyKind: 'complaint_start',
    message:
      'Очень жаль, что прошлый подбор вас разочаровал. Помогите мне точнее понять, что именно не подошло, и я учту это в следующем подборе. Что было не так?',
    buttons: [...ROOT_COMPLAINT_BUTTONS],
    offer: null,
  };
}

function buildReasonMenuResponse(reason) {
  if (reason === 'genre') {
    return {
      replyKind: 'complaint_genre_menu',
      message:
        'Спасибо, это важное уточнение. Давайте соберем новый подбор точнее: какие жанры вам точно не подходят?',
      buttons: [...FOLLOW_UP_BUTTONS.genre_menu],
      offer: null,
    };
  }

  if (reason === 'price') {
    return {
      replyKind: 'complaint_price_menu',
      message:
        'Хорошо, тогда точнее настроим бюджет. Какая цена для вас комфортна, чтобы следующий подбор не был мимо?',
      buttons: [...FOLLOW_UP_BUTTONS.price_menu],
      offer: null,
    };
  }

  if (reason === 'venue') {
    return {
      replyKind: 'complaint_venue_menu',
      message:
        'Это тоже важно учесть. Тогда подскажите: какие площадки, районы или локации вам не подходят?',
      buttons: [...FOLLOW_UP_BUTTONS.venue_menu],
      offer: null,
    };
  }

  return {
    replyKind: 'complaint_other_menu',
    message:
      'Расскажите буквально в двух словах, что именно не понравилось. Так я смогу собрать следующий подбор заметно точнее.',
    buttons: [...FOLLOW_UP_BUTTONS.other_menu],
    offer: null,
  };
}

function buildGenrePromptResponse() {
  return {
    replyKind: 'complaint_genre_prompt',
    message: 'Напишите, какие жанры сразу исключить из следующих рекомендаций.',
    buttons: ['Начать с чистого листа'],
    offer: null,
  };
}

function buildPricePromptResponse() {
  return {
    replyKind: 'complaint_price_prompt',
    message: 'Напишите, какой бюджет для вас комфортен, например: "до 2000 рублей".',
    buttons: ['Начать с чистого листа'],
    offer: null,
  };
}

function buildVenuePromptResponse() {
  return {
    replyKind: 'complaint_venue_prompt',
    message: 'Напишите, какие места, площадки или районы лучше исключить из следующего подбора.',
    buttons: ['Начать с чистого листа'],
    offer: null,
  };
}

function buildOtherPromptResponse() {
  return {
    replyKind: 'complaint_other_prompt',
    message: 'Напишите в двух словах, что именно не понравилось в прошлой подборке.',
    buttons: ['Начать с чистого листа'],
    offer: null,
  };
}

function extractGenreDetails(text, slots = []) {
  const slotGenres = slots
    .filter((slot) => slot && GENRE_SLOT_NAMES.has(slot.name) && slot.value)
    .map((slot) => normalizeText(slot.value))
    .filter(Boolean);

  const normalized = normalizeText(text);
  const textGenres = normalized ? KNOWN_GENRES.filter((genre) => normalized.includes(genre)) : [];

  return dedupe([...slotGenres, ...textGenres]);
}

function extractBudgetMax(text, slots = []) {
  const budgetSlot = slots.find(
    (slot) =>
      slot &&
      (slot.name === 'цена_до' || slot.name === 'бюджет') &&
      slot.value !== undefined &&
      slot.value !== null &&
      String(slot.value).trim() !== ''
  );

  if (budgetSlot) {
    const parsed = parseBudgetValue(budgetSlot.value, { sourceText: text });
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  const normalized = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;

  const parsedFromText = parseBudgetValue(normalized, { sourceText: normalized });
  if (Number.isFinite(parsedFromText) && parsedFromText > 0) {
    return parsedFromText;
  }

  return null;
}

function buildGenreResolvedResponse(genres = []) {
  const genresText = formatList(genres);
  const prefix = genresText
    ? `Принято, жанры ${genresText} исключаю из следующего подбора.`
    : 'Принято, это замечание учту в следующем подборе.';

  return {
    replyKind: 'complaint_genre_resolved',
    replyData: { genres: [...genres] },
    message: `${prefix} Давайте теперь соберем новый вариант уже точнее. С чего начнем?`,
    buttons: [...CATEGORY_RESTART_BUTTONS],
    offer: null,
  };
}

function buildPriceResolvedResponse(maxBudget = null) {
  const budgetText = Number.isFinite(maxBudget)
    ? ` Буду ориентироваться на бюджет до ${maxBudget} ₽.`
    : '';
  return {
    replyKind: 'complaint_price_resolved',
    replyData: { maxBudget: Number.isFinite(maxBudget) ? maxBudget : null },
    message: `Принято, цену скорректируем.${budgetText} Давайте соберем новый подбор. Что вам сейчас интересно?`,
    buttons: [...CATEGORY_RESTART_BUTTONS],
    offer: null,
  };
}

function buildVenueResolvedResponse() {
  return {
    replyKind: 'complaint_venue_resolved',
    message:
      'Принято, замечание по месту учту в следующем подборе. Давайте попробуем заново и выберем вариант точнее.',
    buttons: [...CATEGORY_RESTART_BUTTONS],
    offer: null,
  };
}

function buildOtherResolvedResponse() {
  return {
    replyKind: 'complaint_other_resolved',
    message: 'Спасибо, теперь картина понятнее. Учту это и соберу новый подбор уже точнее.',
    buttons: [...CATEGORY_RESTART_BUTTONS],
    offer: null,
  };
}

function finalizeGenreComplaint(text, slots = []) {
  const genres = extractGenreDetails(text, slots);
  const preferenceUpdates = genres.map((genre) => ({
    type: 'disliked_genre',
    value: genre,
  }));

  return {
    handled: true,
    nextFlow: null,
    response: buildGenreResolvedResponse(genres),
    preferenceUpdates,
    slotResetNames: [...COMPLAINT_RESTART_SLOT_NAMES],
  };
}

function finalizePriceComplaint(text, slots = []) {
  const maxBudget = extractBudgetMax(text, slots);
  const preferenceUpdates = Number.isFinite(maxBudget)
    ? [{ type: 'price_range', value: { max: maxBudget } }]
    : [];

  return {
    handled: true,
    nextFlow: null,
    response: buildPriceResolvedResponse(maxBudget),
    preferenceUpdates,
    slotResetNames: [...COMPLAINT_RESTART_SLOT_NAMES],
  };
}

function finalizeVenueComplaint() {
  return {
    handled: true,
    nextFlow: null,
    response: buildVenueResolvedResponse(),
    preferenceUpdates: [],
    slotResetNames: [...COMPLAINT_RESTART_SLOT_NAMES],
  };
}

function finalizeOtherComplaint() {
  return {
    handled: true,
    nextFlow: null,
    response: buildOtherResolvedResponse(),
    preferenceUpdates: [],
    slotResetNames: [...COMPLAINT_RESTART_SLOT_NAMES],
  };
}

export function looksLikeRecommendationComplaint(text) {
  return hasRecommendationContext(text) && hasNegativeSentiment(text);
}

export function handleComplaintFlow({
  userMessage,
  complaintFlow = null,
  slots = [],
  forceStart = false,
} = {}) {
  const normalized = normalizeText(userMessage);
  const stage = complaintFlow?.stage || null;

  if (isStartOverAction(normalized)) {
    return {
      handled: true,
      nextFlow: null,
      response: buildRestartResponse(),
      preferenceUpdates: [],
      resetUserState: true,
      slotResetNames: [...COMPLAINT_RESTART_SLOT_NAMES],
    };
  }

  if (!stage) {
    if (!forceStart && !looksLikeRecommendationComplaint(userMessage)) {
      return { handled: false, nextFlow: complaintFlow, response: null, preferenceUpdates: [] };
    }

    return {
      handled: true,
      nextFlow: { stage: 'choose_reason', startedAt: new Date().toISOString() },
      response: buildComplaintStartResponse(),
      preferenceUpdates: [],
      slotResetNames: [],
    };
  }

  if (stage === 'choose_reason') {
    const reason = pickComplaintReason(userMessage);
    if (!reason) {
      return {
        handled: true,
        nextFlow: complaintFlow,
        response: buildComplaintStartResponse(),
        preferenceUpdates: [],
        slotResetNames: [],
      };
    }

    const nextStage = `${reason}_menu`;
    return {
      handled: true,
      nextFlow: {
        stage: nextStage,
        reason,
        startedAt: complaintFlow?.startedAt || new Date().toISOString(),
      },
      response: buildReasonMenuResponse(reason),
      preferenceUpdates: [],
      slotResetNames: [],
    };
  }

  if (stage === 'genre_menu') {
    if (isGenreDetailAction(userMessage)) {
      return {
        handled: true,
        nextFlow: {
          stage: 'await_genre_details',
          reason: 'genre',
          startedAt: complaintFlow?.startedAt,
        },
        response: buildGenrePromptResponse(),
        preferenceUpdates: [],
        slotResetNames: [],
      };
    }
    return finalizeGenreComplaint(userMessage, slots);
  }

  if (stage === 'price_menu') {
    if (isPriceDetailAction(userMessage)) {
      return {
        handled: true,
        nextFlow: {
          stage: 'await_price_details',
          reason: 'price',
          startedAt: complaintFlow?.startedAt,
        },
        response: buildPricePromptResponse(),
        preferenceUpdates: [],
        slotResetNames: [],
      };
    }
    return finalizePriceComplaint(userMessage, slots);
  }

  if (stage === 'venue_menu') {
    if (isVenueDetailAction(userMessage)) {
      return {
        handled: true,
        nextFlow: {
          stage: 'await_venue_details',
          reason: 'venue',
          startedAt: complaintFlow?.startedAt,
        },
        response: buildVenuePromptResponse(),
        preferenceUpdates: [],
        slotResetNames: [],
      };
    }
    return finalizeVenueComplaint();
  }

  if (stage === 'other_menu') {
    if (isOtherDetailAction(userMessage)) {
      return {
        handled: true,
        nextFlow: {
          stage: 'await_other_details',
          reason: 'other',
          startedAt: complaintFlow?.startedAt,
        },
        response: buildOtherPromptResponse(),
        preferenceUpdates: [],
        slotResetNames: [],
      };
    }
    return finalizeOtherComplaint();
  }

  if (stage === 'await_genre_details') {
    return finalizeGenreComplaint(userMessage, slots);
  }

  if (stage === 'await_price_details') {
    return finalizePriceComplaint(userMessage, slots);
  }

  if (stage === 'await_venue_details') {
    return finalizeVenueComplaint();
  }

  if (stage === 'await_other_details') {
    return finalizeOtherComplaint();
  }

  return {
    handled: false,
    nextFlow: complaintFlow,
    response: null,
    preferenceUpdates: [],
    slotResetNames: [],
  };
}

export const COMPLAINT_ROOT_BUTTONS = ROOT_COMPLAINT_BUTTONS;
export const COMPLAINT_RESTART_BUTTONS = CATEGORY_RESTART_BUTTONS;
export const COMPLAINT_RESET_SLOT_NAMES = COMPLAINT_RESTART_SLOT_NAMES;
