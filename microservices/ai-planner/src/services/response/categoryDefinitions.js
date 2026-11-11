import { CATEGORY_NORMALIZATION } from './categoryAliases.js';
import { normalizeComparableSlotValue } from './slotUtils.js';
import { EVENT_TAXONOMY } from '../../../../../shared/eventTaxonomy.js';

function normalizeComparableCategoryValue(value) {
  const normalizedCategory = normalizeCategory(String(value || ''));
  return normalizeComparableSlotValue(normalizedCategory || value);
}

function escapeRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const CONCERT_TEXT_GENRE_VALUES = new Set([
  'творческий вечер',
  'клубы',
  'юмористический',
  'юмор',
  'танцевальный',
  'танец',
  'шоу',
  'другое',
]);

function resolveTaxonomyGenreSlotName(category, genreSlot, genre) {
  if (genreSlot !== 'жанр_музыки/жанр') {
    return genreSlot || 'жанр';
  }

  const normalizedGenre = normalizeComparableSlotValue(genre);
  return CONCERT_TEXT_GENRE_VALUES.has(normalizedGenre) ? 'жанр' : 'жанр_музыки';
}

function buildTaxonomyGenreAliases(genre) {
  const aliases = new Set();
  const normalizedGenre = normalizeComparableSlotValue(genre);
  if (normalizedGenre) {
    aliases.add(normalizedGenre);
  }

  String(genre || '')
    .split('/')
    .map((part) => normalizeComparableSlotValue(part))
    .filter(Boolean)
    .forEach((alias) => aliases.add(alias));

  return aliases;
}

// Category names are compared with "э" folded to "е": the taxonomy spells the category
// "стэндап" while users and genre lists write "стендап".
function foldCategoryNameSpelling(value) {
  return String(value || '').replace(/э/gu, 'е');
}

const TAXONOMY_CATEGORY_NAMES = new Set(
  EVENT_TAXONOMY.map(({ category }) =>
    foldCategoryNameSpelling(normalizeComparableCategoryValue(category))
  ).filter(Boolean)
);

const TAXONOMY_GENRE_ENTRIES = EVENT_TAXONOMY.flatMap(({ category, genreSlot, genres = [] }) =>
  genres.map((genre) => ({
    category,
    normalizedCategory: normalizeComparableCategoryValue(category),
    slotName: resolveTaxonomyGenreSlotName(category, genreSlot, genre),
    genre,
    aliases: buildTaxonomyGenreAliases(genre),
  }))
).sort((left, right) => {
  const leftLongest = Math.max(...Array.from(left.aliases).map((alias) => alias.length), 0);
  const rightLongest = Math.max(...Array.from(right.aliases).map((alias) => alias.length), 0);
  return rightLongest - leftLongest;
});

const CATEGORY_BUTTON_LABELS = new Map([
  ['концерты', 'Концерты'],
  ['театры', 'Театры'],
  ['шоу', 'Шоу'],
  ['выставки', 'Выставки'],
  ['музеи', 'Музеи'],
  ['детям', 'Детям'],
  ['туристам', 'Туристам'],
  ['экскурсии', 'Экскурсии'],
  ['образование', 'Образование'],
  ['фестивали', 'Фестивали'],
  ['кино', 'Кино'],
  ['квесты', 'Квесты'],
  ['квизы', 'Квизы'],
  ['праздники', 'Праздники'],
  ['стендап', 'Стендап'],
  ['стэндап', 'Стендап'],
  ['спорт', 'Спорт'],
]);

function resolveTaxonomyGenreEntryByValue(value, { preferredCategory = '' } = {}) {
  const normalizedValue = normalizeComparableSlotValue(value);
  if (!normalizedValue) {
    return null;
  }

  const normalizedPreferredCategory = normalizeComparableCategoryValue(preferredCategory);
  const matches = TAXONOMY_GENRE_ENTRIES.filter((entry) => entry.aliases.has(normalizedValue));

  if (normalizedPreferredCategory) {
    return (
      matches.find((entry) => entry.normalizedCategory === normalizedPreferredCategory) || null
    );
  }

  if (TAXONOMY_CATEGORY_NAMES.has(foldCategoryNameSpelling(normalizedValue))) {
    return null;
  }

  return matches.length === 1 ? matches[0] : null;
}

function hasTaxonomyAliasInText(normalizedText, alias) {
  if (!normalizedText || !alias) {
    return false;
  }

  if (normalizedText === alias) {
    return true;
  }

  const pattern = new RegExp(`(^| )${escapeRegex(alias).replace(/\s+/g, '\\s+')}(?=$| )`, 'u');
  return pattern.test(normalizedText);
}

function resolveTaxonomyGenreEntryFromText(text, { preferredCategory = '' } = {}) {
  const normalizedText = normalizeComparableSlotValue(text);
  if (!normalizedText) {
    return null;
  }

  const normalizedPreferredCategory = normalizeComparableCategoryValue(preferredCategory);
  const matches = TAXONOMY_GENRE_ENTRIES.filter((entry) => {
    if (normalizedPreferredCategory && entry.normalizedCategory !== normalizedPreferredCategory) {
      return false;
    }

    return Array.from(entry.aliases).some((alias) => hasTaxonomyAliasInText(normalizedText, alias));
  });

  if (normalizedPreferredCategory) {
    return matches[0] || null;
  }

  if (TAXONOMY_CATEGORY_NAMES.has(foldCategoryNameSpelling(normalizedText))) {
    return null;
  }

  if (matches.length === 1) {
    return matches[0];
  }

  const uniqueCategories = new Set(matches.map((entry) => entry.normalizedCategory));
  return uniqueCategories.size === 1 ? matches[0] : null;
}

const CATEGORY_KEYWORD_MAP = [
  {
    regex:
      /(?:^|[^\p{L}\p{N}_])(?:концерт[\p{L}\p{N}_]*|коцнерт[\p{L}\p{N}_]*|конерт[\p{L}\p{N}_]*|джаз[\p{L}\p{N}_]*|jazz|рок[\p{L}\p{N}_]*|pop|поп|попс[\p{L}\p{N}_]*|рэп[\p{L}\p{N}_]*|реп[\p{L}\p{N}_]*|хип[\s-]?хоп|trap|трэп[\p{L}\p{N}_]*|классик[\p{L}\p{N}_]*|симфон[\p{L}\p{N}_]*|академическ[\p{L}\p{N}_]*|шансон[\p{L}\p{N}_]*|романс[\p{L}\p{N}_]*|фолк[\p{L}\p{N}_]*|этно[\p{L}\p{N}_]*|электрон[\p{L}\p{N}_]*|электроник[\p{L}\p{N}_]*|edm|техно|techno|house|хаус|метал[\p{L}\p{N}_]*|metal|хэви|heavy|instrumental|инструментальн[\p{L}\p{N}_]*|творческ[\p{L}\p{N}_]*\s+вечер[\p{L}\p{N}_]*|эстрад[\p{L}\p{N}_]*)(?=$|[^\p{L}\p{N}_])|рок[-\s]?н[-\s]?рол/iu,
    value: 'концерты',
  },
  {
    regex:
      /(?:^|[^\p{L}\p{N}_])(?:театр[\p{L}\p{N}_]*|спектакл[\p{L}\p{N}_]*|опер(?:а|ы|у|е|ой|ою|ный|ная|ное|ные|ного|ному|ным|ных)|балет[\p{L}\p{N}_]*|мюзикл[\p{L}\p{N}_]*|драм[\p{L}\p{N}_]*|мелодрам[\p{L}\p{N}_]*|трагикомед[\p{L}\p{N}_]*|сказк[\p{L}\p{N}_]*|иммерсив[\p{L}\p{N}_]*|моноспект[\p{L}\p{N}_]*|кукольн[\p{L}\p{N}_]*|гастрол[\p{L}\p{N}_]*)(?=$|[^\p{L}\p{N}_])/iu,
    value: 'театры',
  },
  { regex: /(выставк\w*)/i, value: 'выставки' },
  { regex: /(фестиваль\w*)/i, value: 'фестивали' },
  { regex: /(кино|фильм\w*)/i, value: 'кино' },
  {
    regex:
      /(музе\w*|заповедник\w*|мемориальн\w*|археологич\w*|краеведческ\w*|литературн\w*|художественн\w*)/i,
    value: 'музеи',
  },
  { regex: /(галере\w*|арт[-\s]?центр\w*|центр\w*\s+искусств)/i, value: 'музеи' },
  {
    regex:
      /(?:с\s+ребенк|с\s+ребенком|с\s+ребенку|для\s+детей|ребенк[\p{L}\p{N}_]*|ребенок|детск[\p{L}\p{N}_]*)/iu,
    value: 'детям',
  },
  { regex: /(ст[эе]ндап\w*|standup\w*|stand-up\w*)/i, value: 'стэндап' },
  { regex: /(шоу\w*|перформанс\w*|представлен\w*|цирк\w*|клоунад\w*)/i, value: 'шоу' },
  {
    regex:
      /(спорт\w*|спортивн\w*|матч\w*|соревн\w*|турнир\w*|футбол\w*|баскетбол\w*|единоборств\w*|автоспорт\w*)/i,
    value: 'спорт',
  },
  { regex: /(квест\w*|escape\s*room)/i, value: 'квесты' },
  { regex: /(квиз\w*)/i, value: 'квизы' },
  // Более точное регулярное выражение для детской категории
  // Исключаем ложные срабатывания на слова типа "бабушкой", "дедушкой"
  {
    regex:
      /(?<![A-Za-zА-Яа-яЁё0-9_])(детск\w+|детям|для\s*детей|реб[её]н\w+|малыш\w+)(?![A-Za-zА-Яа-яЁё0-9_])/i,
    value: 'детям',
  },
  {
    regex: /(образован\w*|обучен\w*|лекци\w*|семинар\w*|мастер[-\s]?класс\w*|тренинг\w*|курс\w*)/i,
    value: 'образование',
  },
  {
    regex: /(экскурси\w*|путешеств\w*|прогулк\w*|обзорн\w*|пешеходн\w*|автобусн\w*|тур\w*)/i,
    value: 'экскурсии',
  },
  { regex: /(турист\w*|для\s*туристов|активн\w*\s+отдых\w*)/i, value: 'туристам' },
  { regex: /(праздник\w*|праздничн\w*)/i, value: 'праздники' },
  { regex: /(распродаж\w*|скидк\w*|акци\w*)/i, value: 'распродажа' },
];

function normalizeCategory(category) {
  if (!category || typeof category !== 'string') {
    return null;
  }
  const normalized = category.toLowerCase().trim();
  return CATEGORY_NORMALIZATION[normalized] || normalized;
}

function detectCategoryFromText(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }

  const normalizedText = String(text).replace(/ё/g, 'е');
  const taxonomyGenreEntry = resolveTaxonomyGenreEntryFromText(normalizedText);
  if (taxonomyGenreEntry) {
    return taxonomyGenreEntry.category;
  }

  for (const { regex, value } of CATEGORY_KEYWORD_MAP) {
    if (regex.test(normalizedText)) {
      return value;
    }
  }

  return null;
}

export {
  CATEGORY_NORMALIZATION,
  normalizeComparableCategoryValue,
  TAXONOMY_GENRE_ENTRIES,
  CATEGORY_BUTTON_LABELS,
  resolveTaxonomyGenreEntryByValue,
  resolveTaxonomyGenreEntryFromText,
  CATEGORY_KEYWORD_MAP,
  normalizeCategory,
  detectCategoryFromText,
};
