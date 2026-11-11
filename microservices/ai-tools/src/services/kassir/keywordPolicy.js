const TRIVIAL_KEYWORDS = new Set([
  '',
  'привет',
  'здравствуйте',
  'спасибо',
  'пожалуйста',
  'ничего',
  'что-нибудь',
  'чё-нибудь',
  'че-нибудь',
  'чтонить',
  'чо-нибудь',
  'куда',
  'сходить',
  'подскажи',
  'можно',
  'нельзя',
  'нужно',
  'надо',
  'лет',
  'года',
  'подскажи что-нибудь',
  'посоветуй',
  'посоветуешь',
  'посоветуйте',
  'советуй',
  'советуешь',
  'советуйте',
  'найди',
  'найдите',
  'найди что-нибудь',
  'найдите что-нибудь',
  'что посоветуешь',
  'что-нибудь',
  'что то',
  'что-то',
  'чтото',
  'подбери',
  'подбери что-нибудь',
  'покажи',
  'покажи что-нибудь',
  'покажи что-то',
  'покажи что то',
  'помоги',
  'помоги найти',
  'помоги подобрать',
  'давай',
  'давай что-нибудь',
  'давай что-то',
  'хочу',
  'хочу что-нибудь',
  'хочу что-то',
  'хотелось',
  'хотелось бы',
  'интересует',
  'интересуют',
  'любые',
  'любое',
  'любая',
  'ещё',
  'еще',
  'какие-либо',
  'какие либо',
  'какиелибо',
  'либо',
]);

const TRIVIAL_PATTERNS = [
  /привет(ик|ики)?/i,
  /что[-\s]?нибудь/i,
  /какое[-\s]?нибудь/i,
  /найд[ие][тё]?\s*(что[-\s]?нибудь|что-то)?/i,
  /куда\s+сходить/i,
  /подскажи/i,
  /помоги/i,
  /посовету[йешьй]?/i,
  /совету[йешьй]?/i,
  /что\s+посоветуешь/i,
  /что\s+посоветуй/i,
  /что\s+посоветуйте/i,
  /подбери/i,
  /покажи/i,
  /давай/i,
  /хочу\s+(что[-\s]?нибудь|что-то)?/i,
  /хотелось\s+бы/i,
  /интересует/i,
  /интересуют/i,
  /люб[ыеоеая]/i,
  /^в\s+(пятницу|субботу|воскресенье|понедельник|вторник|среду|четверг)$/i,
  /ещё\s*(есть|какие|что|варианты|есть\s*какие|есть\s*что)?/i,
  /еще\s*(есть|какие|что|варианты|есть\s*какие|есть\s*что)?/i,
  /какие[-\s]?либо/i,
  /какиелибо/i,
  /^ещё$/i,
  /^еще$/i,
  /^либо$/i,
  /а\s+ещё/i,
  /а\s+еще/i,
];

const SHORT_MUSIC_GENRES = new Set([
  'поп',
  'рок',
  'джаз',
  'рэп',
  'реп',
  'rap',
  'хип-хоп',
  'хипхоп',
  'hip-hop',
  'hip hop',
  'блюз',
  'фолк',
  'метал',
  'металл',
  'инди',
  'регги',
  'соул',
  'фанк',
]);

const RAP_EQUIVALENTS = new Set(['рэп', 'реп', 'rap', 'хип-хоп', 'хипхоп', 'hip-hop', 'hip hop']);

const RAP_POSITIVE_MARKERS = [
  'рэп',
  'реп',
  'rap',
  'хип-хоп',
  'хипхоп',
  'hip-hop',
  'hip hop',
  'urban',
  'trap',
  'трэп',
  'drill',
  'grime',
  'r&b',
  'rnb',
  'afrobeat',
  'reggaeton',
  'dj',
];

const RAP_NEGATIVE_MARKERS = [
  'джаз',
  'jazz',
  'джаз-клуб',
  'jazz club',
  'brass',
  'brass band',
  'брасс',
  'оркестр',
  'симфони',
  'камерн',
  'струнн',
  'саксофон',
  'вибрафон',
  'органн',
  'органа',
  'опера',
  'балет',
  'театр',
  'спектакл',
  'мюзикл',
  'оперет',
  'постановк',
];

const MUSIC_NON_CONCERT_NEGATIVE_MARKERS = [
  'театр',
  'спектакл',
  'постановк',
  'мюзикл',
  'опера',
  'оперет',
  'балет',
  'цирк',
  // Концерты != стендап-концерты: вычищаем комедийные форматы из музыкальной выдачи.
  'стендап',
  'стэндап',
  'standup',
  'stand-up',
  'stand up',
  'комик',
  'комеди',
  'юмор',
  'comedy',
  'сказк',
  'кукольн',
  'выставк',
  'музей',
  'экскурс',
  'лекци',
  'мастер-класс',
  'мастеркласс',
  'квиз',
  'ярмарк',
  'дегустац',
  'зоопарк',
];

const THEATER_REQUEST_MARKERS = [
  'театр',
  'театры',
  'спектакл',
  'постановк',
  'пьес',
  'драма',
  'комед',
  'трагед',
  'фарс',
  'мюзикл',
  'опера',
  'балет',
  'моноспект',
  'иммерсив',
  'кукольн',
];

const THEATER_EXPLICIT_NON_PERFORMANCE_REQUEST_MARKERS = [
  'лекци',
  'мастер-класс',
  'мастеркласс',
  'экскурс',
  'выставк',
  'музей',
  'образовательн',
  'семинар',
  'тренинг',
  'конференц',
  'форум',
  'практикум',
  'урок',
  'заняти',
  'встреча',
  'презентац',
];

const THEATER_NON_PERFORMANCE_NEGATIVE_MARKERS = [
  'лекци',
  'мастер-класс',
  'мастеркласс',
  'экскурс',
  'выставк',
  'музей',
  'образовательн',
  'семинар',
  'тренинг',
  'конференц',
  'форум',
  'практикум',
  'урок',
  'заняти',
  'встреча',
  'презентац',
  'квиз',
];

const THEATER_PERFORMANCE_POSITIVE_MARKERS = [
  'спектакл',
  'постановк',
  'пьес',
  'комед',
  'трагед',
  'фарс',
  'мюзикл',
  'опера',
  'балет',
  'моноспект',
  'иммерсив',
  'кукольн',
  'режиссер',
  'режиссёр',
  'сценическ',
  'театральная постановка',
  'театральный сезон',
];

const MUSIC_EVENT_TYPE_TOKENS = new Set([
  'концерт',
  'концерты',
  'фестиваль',
  'фестивали',
  'вечеринка',
  'вечеринки',
  'party',
  'dj',
  'диджей',
  'диджеи',
  'сет',
  'сеты',
  'set',
]);

const STANDUP_NEGATIVE_MARKERS = [
  'стендап',
  'стэндап',
  'standup',
  'stand-up',
  'stand up',
  'комик',
  'комеди',
  'юмор',
  'comedy',
];

const SHORT_GENRE_TOKEN_MAP = {
  поп: ['поп', 'pop', 'k-pop', 'kpop', 'k pop'],
  рок: ['рок', 'rock', 'rock-n-roll', 'rock n roll', 'рок-н-рол', 'рокнрол'],
  джаз: ['джаз', 'jazz'],
  рэп: ['рэп', 'реп', 'rap', 'hip-hop', 'hip hop', 'хип-хоп', 'хипхоп'],
  блюз: ['блюз', 'blues'],
  фолк: ['фолк', 'folk'],
  метал: ['метал', 'металл', 'metal'],
  инди: ['инди', 'indie'],
  регги: ['регги', 'reggae'],
  соул: ['соул', 'soul'],
  фанк: ['фанк', 'funk'],
};

const SHORT_GENRE_CANONICAL_BY_TOKEN = (() => {
  const map = new Map();
  Object.entries(SHORT_GENRE_TOKEN_MAP).forEach(([canonical, tokens]) => {
    [canonical, ...(tokens || [])].forEach((token) => {
      const normalized = normalizeGenreToken(token);
      if (normalized) {
        map.set(normalized, canonical);
      }
    });
  });
  return map;
})();

function isTrivialKeyword(value) {
  if (!value) {
    return true;
  }
  const normalized = value.toLowerCase().trim();
  if (!normalized) {
    return true;
  }
  if (normalized.length <= 2) {
    return true;
  }
  if (TRIVIAL_KEYWORDS.has(normalized)) {
    return true;
  }
  return TRIVIAL_PATTERNS.some((pattern) => pattern.test(normalized));
}

function normalizeGenreToken(token) {
  const value = String(token || '')
    .toLowerCase()
    .trim();
  if (!value) {
    return '';
  }
  if (value === 'k-pop' || value === 'kpop') {
    return 'k-pop';
  }
  if (value === 'реп' || value === 'rap') {
    return 'рэп';
  }
  if (value === 'хип-хоп' || value === 'хипхоп' || value === 'hip-hop' || value === 'hip hop') {
    return 'хип-хоп';
  }
  return value;
}

function detectShortMusicGenre(value) {
  const normalized = String(value || '').toLowerCase();
  if (!normalized) {
    return null;
  }

  const tokens = normalized
    .split(/[\s,.:;!?()\[\]{}"'«»<>\/\\|]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  for (const token of tokens) {
    const normalizedToken = normalizeGenreToken(token);
    const canonical = SHORT_GENRE_CANONICAL_BY_TOKEN.get(normalizedToken);
    if (canonical) {
      return canonical;
    }
    if (SHORT_MUSIC_GENRES.has(normalizedToken)) {
      return normalizedToken;
    }
  }

  if (normalized.includes('hip-hop') || normalized.includes('hip hop')) {
    return 'рэп';
  }

  return null;
}

function normalizeMusicEventTypeToken(value) {
  const normalized = String(value || '')
    .toLowerCase()
    .trim();
  if (!normalized) {
    return '';
  }
  if (normalized.startsWith('концерт')) {
    return 'концерт';
  }
  if (normalized.startsWith('фестивал')) {
    return 'фестиваль';
  }
  if (normalized.startsWith('вечерин')) {
    return 'вечеринка';
  }
  if (normalized === 'dj' || normalized === 'диджей' || normalized.startsWith('дидже')) {
    return 'dj';
  }
  if (normalized === 'party') {
    return 'party';
  }
  return normalized;
}

function findMusicEventTypeHint({ parts = [], slots = [] }) {
  const partHit = Array.isArray(parts)
    ? parts.find((part) => MUSIC_EVENT_TYPE_TOKENS.has(String(part || '').toLowerCase()))
    : null;
  if (partHit) {
    return normalizeMusicEventTypeToken(partHit);
  }

  const slotNames = new Set(['тип_мероприятия', 'тип_события', 'категория']);
  const slotHit = Array.isArray(slots)
    ? slots.find((slot) => slot && slotNames.has(slot.name) && slot.value)
    : null;
  if (slotHit) {
    const normalized = normalizeMusicEventTypeToken(slotHit.value);
    if (normalized && MUSIC_EVENT_TYPE_TOKENS.has(normalized)) {
      return normalized;
    }
  }

  return '';
}

export {
  RAP_EQUIVALENTS,
  RAP_POSITIVE_MARKERS,
  RAP_NEGATIVE_MARKERS,
  MUSIC_NON_CONCERT_NEGATIVE_MARKERS,
  THEATER_REQUEST_MARKERS,
  THEATER_EXPLICIT_NON_PERFORMANCE_REQUEST_MARKERS,
  THEATER_NON_PERFORMANCE_NEGATIVE_MARKERS,
  THEATER_PERFORMANCE_POSITIVE_MARKERS,
  STANDUP_NEGATIVE_MARKERS,
  SHORT_GENRE_TOKEN_MAP,
  isTrivialKeyword,
  detectShortMusicGenre,
  findMusicEventTypeHint,
};
