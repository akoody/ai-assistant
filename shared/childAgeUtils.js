const CHILD_MARKER_REGEX =
  /(ребен|ребенок|ребён|ребёнок|дет(?:и|ям|ей|ский|ская|ское|ские)|малыш|дочк|сын)/u;
const CHILD_REFERENCE_REGEX =
  /(?:ребен[\p{L}]*|ребён[\p{L}]*|дет[\p{L}]*|дочк[\p{L}]*|сын[\p{L}]*|малыш[\p{L}]*)/iu;
const AGE_VALUE_PATTERN = '(\\d{1,2}|[а-яё-]+)';

const WORD_AGE_VALUE_PATTERNS = [
  { value: 0, pattern: /^нул(?:ь|ев\p{L}*)?$/u },
  { value: 1, pattern: /^одн(?:а|ин|о|ого|ому|им|ом|у|е)?$/u },
  { value: 2, pattern: /^дв(?:а|е|ух|ум|умя)?$/u },
  { value: 3, pattern: /^тр(?:и|ех|ем|емя)?$/u },
  { value: 4, pattern: /^четыр(?:е|ех|ем|ьмя)?$/u },
  { value: 5, pattern: /^пят(?:ь|и|ью)?$/u },
  { value: 6, pattern: /^шест(?:ь|и|ью)?$/u },
  { value: 7, pattern: /^сем(?:ь|и|ью)?$/u },
  { value: 8, pattern: /^восем(?:ь|и|ью)?$/u },
  { value: 9, pattern: /^девят(?:ь|и|ью)?$/u },
  { value: 10, pattern: /^десят(?:ь|и|ью)?$/u },
  { value: 11, pattern: /^одиннадцат(?:ь|и|ью)?$/u },
  { value: 12, pattern: /^двенадцат(?:ь|и|ью)?$/u },
  { value: 13, pattern: /^тринадцат(?:ь|и|ью)?$/u },
  { value: 14, pattern: /^четырнадцат(?:ь|и|ью)?$/u },
  { value: 15, pattern: /^пятнадцат(?:ь|и|ью)?$/u },
  { value: 16, pattern: /^шестнадцат(?:ь|и|ью)?$/u },
  { value: 17, pattern: /^семнадцат(?:ь|и|ью)?$/u },
];

function normalizeChildAgeText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .trim();
}

function parseRussianChildAgeWord(word = '') {
  const normalizedWord = normalizeChildAgeText(word).replace(/[\s-]/g, '');
  if (!normalizedWord) {
    return null;
  }

  for (const { value, pattern } of WORD_AGE_VALUE_PATTERNS) {
    if (pattern.test(normalizedWord)) {
      return value;
    }
  }

  return null;
}

function parseAgeMatch(matchValue) {
  const parsedDigit = Number.parseInt(String(matchValue || '').trim(), 10);
  if (Number.isFinite(parsedDigit) && parsedDigit >= 0 && parsedDigit <= 17) {
    return parsedDigit;
  }

  const parsedWord = parseRussianChildAgeWord(matchValue);
  if (Number.isFinite(parsedWord) && parsedWord >= 0 && parsedWord <= 17) {
    return parsedWord;
  }

  return null;
}

export function extractChildAgeFromText(text = '') {
  const source = String(text || '').trim();
  if (!source) {
    return null;
  }

  const normalized = normalizeChildAgeText(source);
  if (!CHILD_MARKER_REGEX.test(normalized)) {
    return null;
  }

  const explicitAgeRestrictionPatterns = [
    new RegExp(
      `(?:^|[^\\p{L}\\p{N}])${AGE_VALUE_PATTERN}\\s*(?:\\+|плюс)(?=$|[^\\p{L}\\p{N}])`,
      'iu'
    ),
    new RegExp(
      `(?:от|с|старше|начиная\\s+с)\\s+${AGE_VALUE_PATTERN}\\s*(?:\\+|плюс|лет|года|год|годиков)?`,
      'iu'
    ),
    new RegExp(
      `(?:до|по|младше|не\\s+старше)\\s+${AGE_VALUE_PATTERN}\\s*(?:лет|года|год|годиков)?`,
      'iu'
    ),
  ];

  for (const pattern of explicitAgeRestrictionPatterns) {
    const parsed = parseAgeMatch(source.match(pattern)?.[1] || '');
    if (parsed !== null) {
      return parsed;
    }
  }

  const numericPatterns = [
    /(?:с\s+)?(?:ребен[\p{L}]*|ребён[\p{L}]*|дет[\p{L}]*|дочк[\p{L}]*|сын[\p{L}]*|малыш[\p{L}]*)\s+(\d{1,2})\s*(?:\+|плюс|лет|года|год)/iu,
    /(\d{1,2})\s*(?:\+|плюс|лет|года|год)\s*(?:ребен[\p{L}]*|ребён[\p{L}]*|дет[\p{L}]*|дочк[\p{L}]*|сын[\p{L}]*|малыш[\p{L}]*)/iu,
    /(\d{1,2})\s*[- ]?летн(?:ий|яя|ее|ему|ей|его|им|их)/iu,
  ];

  for (const pattern of numericPatterns) {
    const parsed = parseAgeMatch(source.match(pattern)?.[1] || '');
    if (parsed !== null) {
      return parsed;
    }
  }

  const wordPatterns = [
    new RegExp(
      `${CHILD_REFERENCE_REGEX.source}(?:\\s+\\p{L}+){0,2}\\s+(?:с\\s+)?([\\p{L}-]+)\\s*(?:лет|года|год)`,
      'iu'
    ),
    new RegExp(
      `([\\p{L}-]+)\\s*(?:лет|года|год)(?:\\s+\\p{L}+){0,2}\\s+${CHILD_REFERENCE_REGEX.source}`,
      'iu'
    ),
    /([а-яё-]+)\s*[- ]?летн(?:ий|яя|ее|ему|ей|его|им|их)/iu,
  ];

  for (const pattern of wordPatterns) {
    const parsed = parseAgeMatch(source.match(pattern)?.[1] || '');
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}
