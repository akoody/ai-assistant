const EVENT_TYPE_SLOT_NAMES = new Set(['тип_мероприятия', 'тип_события']);
const GENRE_SLOT_NAMES = new Set(['жанр', 'жанр_музыки', 'предпочтения_жанры']);
const TEXT_NORMALIZATION_RULES = [
  { pattern: /репчик(?:а|у|ом|е|и)?/gu, replacement: 'рэп' },
  { pattern: /(?<![\p{L}\p{N}_])реп(?![\p{L}\p{N}_])/gu, replacement: 'рэп' },
  { pattern: /рэпчик(?:а|у|ом|е|и)?/gu, replacement: 'рэп' },
  { pattern: /хип[\s-]*хопчик(?:а|у|ом|е|и)?/gu, replacement: 'хип-хоп' },
  { pattern: /джазик(?:а|у|ом|е|и)?/gu, replacement: 'джаз' },
  { pattern: /джазок(?:а|у|ом|е|и)?/gu, replacement: 'джаз' },
  { pattern: /рокчик(?:а|у|ом|е|и)?/gu, replacement: 'рок' },
  { pattern: /рокешник(?:а|у|ом|е|и)?/gu, replacement: 'рок' },
  { pattern: /шансончик(?:а|у|ом|е|и)?/gu, replacement: 'шансон' },
  { pattern: /электронк(?:а|у|ой|е|и)?/gu, replacement: 'электроника' },
  { pattern: /танцевалк(?:а|у|ой|е|и)?/gu, replacement: 'танцевальный' },
  { pattern: /инструментал(?:а|у|ом|е)?/gu, replacement: 'инструментальная музыка' },
  { pattern: /хэви[\s-]*метал(?:а|у|ом|е)?/gu, replacement: 'металл' },
  { pattern: /металкор(?:а|у|ом|е)?/gu, replacement: 'металл' },
];

const CONCERT_GENRE_RULES = [
  {
    name: 'жанр',
    value: 'творческий вечер',
    confidence: 0.94,
    pattern: /творческ.*(?:вечер|встреч)/u,
  },
  { name: 'жанр', value: 'клубы', confidence: 0.9, pattern: /клуб(?:н|ы|ах|ам|ами|е|ов)?/u },
  {
    name: 'жанр',
    value: 'шоу',
    confidence: 0.91,
    pattern: /(^|[^\p{L}\p{N}_])(?:show|шоу)(?=$|[^\p{L}\p{N}_])|шоу.*программ/u,
  },
  {
    name: 'жанр',
    value: 'юмористический',
    confidence: 0.91,
    pattern: /(юморист|юмор|комеди|смешн)/u,
  },
  { name: 'жанр', value: 'танцевальный', confidence: 0.93, pattern: /(танцев|dance)/u },
  {
    name: 'жанр_музыки',
    value: 'классика',
    confidence: 0.91,
    pattern: /(классик|симфон|академическ)/u,
  },
  {
    name: 'жанр_музыки',
    value: 'рок',
    confidence: 0.91,
    pattern: /(^|[^\p{L}\p{N}_])(?:rock|рок)(?=$|[^\p{L}\p{N}_])|рок[-\s]?н[-\s]?рол/u,
  },
  {
    name: 'жанр_музыки',
    value: 'поп',
    confidence: 0.91,
    pattern: /(^|[^\p{L}\p{N}_])(?:pop|поп)(?=$|[^\p{L}\p{N}_])|попс|эстрад/u,
  },
  {
    name: 'жанр_музыки',
    value: 'джаз',
    confidence: 0.91,
    pattern: /(^|[^\p{L}\p{N}_])(?:jazz|джаз)(?=$|[^\p{L}\p{N}_])/u,
  },
  { name: 'жанр_музыки', value: 'фолк', confidence: 0.9, pattern: /(folk|фолк|народн|этно)/u },
  {
    name: 'жанр_музыки',
    value: 'шансон',
    confidence: 0.9,
    pattern: /(шансон|романс|авторск|бард)/u,
  },
  {
    name: 'жанр_музыки',
    value: 'рэп',
    confidence: 0.92,
    pattern: /(рэп|хип[\s-]?хоп|hip[\s-]?hop|трэп|trap)/u,
  },
  {
    name: 'жанр_музыки',
    value: 'электронная музыка',
    confidence: 0.9,
    pattern:
      /(электрон|электроник|(^|[^\p{L}\p{N}_])электро(?=$|[^\p{L}\p{N}_])|edm|техно|techno|house|хаус)/u,
  },
  {
    name: 'жанр_музыки',
    value: 'металл',
    confidence: 0.9,
    pattern: /(металл?|metal|хэви|heavy|death|thrash)/u,
  },
  {
    name: 'жанр_музыки',
    value: 'инструментальная музыка',
    confidence: 0.9,
    pattern: /(инструментальн|instrumental|без\s+слов)/u,
  },
];

const THEATER_GENRE_RULES = [
  {
    name: 'жанр',
    value: 'опера',
    confidence: 0.94,
    pattern:
      /(^|[^\p{L}\p{N}_])опер(?:а|ы|у|е|ой|ою|ный|ная|ное|ные|ного|ному|ным|ных)(?=$|[^\p{L}\p{N}_])/u,
  },
  {
    name: 'жанр',
    value: 'балет',
    confidence: 0.94,
    pattern:
      /(^|[^\p{L}\p{N}_])балет(?:а|у|ом|е|ы|ный|ная|ное|ные|ного|ному|ным|ных)?(?=$|[^\p{L}\p{N}_])/u,
  },
  {
    name: 'жанр',
    value: 'мюзикл',
    confidence: 0.94,
    pattern:
      /(^|[^\p{L}\p{N}_])мюзикл(?:а|у|ом|е|ы|ный|ная|ное|ные|ного|ному|ным|ных)?(?=$|[^\p{L}\p{N}_])/u,
  },
  { name: 'жанр', value: 'кукольный театр', confidence: 0.93, pattern: /кукольн/u },
  { name: 'жанр', value: 'иммерсивный спектакль', confidence: 0.93, pattern: /иммерсив/u },
  { name: 'жанр', value: 'моноспектакли', confidence: 0.93, pattern: /моноспект/u },
  { name: 'жанр', value: 'трагикомедия', confidence: 0.92, pattern: /трагикомед/u },
  { name: 'жанр', value: 'мелодрама', confidence: 0.92, pattern: /мелодрам/u },
  { name: 'жанр', value: 'сказка', confidence: 0.92, pattern: /сказк/u },
  { name: 'жанр', value: 'драма', confidence: 0.92, pattern: /драм/u },
  { name: 'жанр', value: 'комедия', confidence: 0.92, pattern: /комед/u },
  { name: 'жанр', value: 'гастроли', confidence: 0.91, pattern: /гастрол/u },
  { name: 'жанр', value: 'танец', confidence: 0.91, pattern: /танц|балет.*танец/u },
  {
    name: 'жанр',
    value: 'спектакли',
    confidence: 0.9,
    pattern: /(^|[^\p{L}\p{N}_])спектакл[\p{L}]*(?=$|[^\p{L}\p{N}_])/u,
  },
];

function normalizeGuardText(value) {
  let normalized = String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .trim();
  if (!normalized) {
    return normalized;
  }

  TEXT_NORMALIZATION_RULES.forEach(({ pattern, replacement }) => {
    normalized = normalized.replace(pattern, replacement);
  });

  return normalized.replace(/\s+/g, ' ').trim();
}

function hasGenreSlot(slots = []) {
  const list = Array.isArray(slots) ? slots : [];
  return list.some((slot) => slot && GENRE_SLOT_NAMES.has(String(slot.name || '').trim()));
}

function collectNormalizedEventTypeValues(slots = []) {
  const list = Array.isArray(slots) ? slots : [];
  return list
    .filter((slot) => slot && EVENT_TYPE_SLOT_NAMES.has(String(slot.name || '').trim()))
    .map((slot) => normalizeGuardText(slot.value))
    .filter(Boolean);
}

function hasCategoryContext(normalizedText, eventTypeValues, pattern) {
  return pattern.test(normalizedText) || eventTypeValues.some((value) => pattern.test(value));
}

function resolvePatternGenreRule(normalizedText, rules = []) {
  const matchedRule = rules.find((rule) => rule.pattern.test(normalizedText));
  if (!matchedRule) {
    return null;
  }

  return {
    name: matchedRule.name,
    value: matchedRule.value,
    confidence: matchedRule.confidence,
    source: 'heuristic_genre',
  };
}

export function resolveHeuristicGenreSlot(text = '', slots = []) {
  const normalizedText = normalizeGuardText(text);
  if (!normalizedText || hasGenreSlot(slots)) {
    return null;
  }

  const eventTypeValues = collectNormalizedEventTypeValues(slots);
  const isConcertContext = hasCategoryContext(
    normalizedText,
    eventTypeValues,
    /(концерт|музык|выступл)/u
  );
  const isShowContext = hasCategoryContext(normalizedText, eventTypeValues, /(шоу|представлен)/u);
  const isTheaterContext = hasCategoryContext(
    normalizedText,
    eventTypeValues,
    /(театр|спектакл|опера|балет)/u
  );

  if (
    /(танцев|dance)/u.test(normalizedText) &&
    (isConcertContext || isShowContext || isTheaterContext)
  ) {
    return { name: 'жанр', value: 'танцевальный', confidence: 0.93, source: 'heuristic_genre' };
  }

  if (/(цирков|клоунад)/u.test(normalizedText) && (isShowContext || isTheaterContext)) {
    return { name: 'жанр', value: 'цирковой', confidence: 0.92, source: 'heuristic_genre' };
  }

  if (/(юморист|юмор|комеди|смешн)/u.test(normalizedText) && (isShowContext || isConcertContext)) {
    return { name: 'жанр', value: 'юмористический', confidence: 0.91, source: 'heuristic_genre' };
  }

  if (isConcertContext) {
    const concertGenreRule = resolvePatternGenreRule(normalizedText, CONCERT_GENRE_RULES);
    if (concertGenreRule) {
      return concertGenreRule;
    }
  }

  if (isTheaterContext) {
    const theaterGenreRule = resolvePatternGenreRule(normalizedText, THEATER_GENRE_RULES);
    if (theaterGenreRule) {
      return theaterGenreRule;
    }
  }

  return null;
}

export function appendHeuristicGenreSlot(slots = [], text = '') {
  const target = Array.isArray(slots) ? slots : [];
  const heuristicGenreSlot = resolveHeuristicGenreSlot(text, target);
  if (!heuristicGenreSlot) {
    return target;
  }

  target.push(heuristicGenreSlot);
  return target;
}
