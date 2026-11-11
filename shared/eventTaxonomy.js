export const EVENT_TAXONOMY = Object.freeze([
  {
    category: 'концерты',
    genreSlot: 'жанр_музыки/жанр',
    genres: [
      'классика',
      'рок',
      'поп',
      'эстрада',
      'джаз',
      'фолк',
      'народная музыка',
      'шансон',
      'авторская песня',
      'романсы',
      'рэп',
      'хип-хоп',
      'электронная музыка',
      'металл',
      'инструментальная музыка',
      'творческий вечер',
      'клубы',
      'юмористический',
      'юмор',
      'танцевальный',
      'танец',
      'шоу',
      'другое',
    ],
  },
  {
    category: 'театры',
    genreSlot: 'жанр',
    genres: [
      'комедия',
      'драма',
      'опера',
      'балет',
      'мюзикл',
      'кукольный театр',
      'спектакли',
      'гастроли',
      'мелодрама',
      'сказка',
      'трагикомедия',
      'иммерсивный спектакль',
      'танец',
      'цирк / клоунада',
      'моноспектакли',
    ],
  },
  {
    category: 'шоу',
    genreSlot: 'жанр',
    genres: ['цирк / клоунада', 'спортивное шоу', 'юмор', 'танец', 'стендап', 'другое'],
  },
  {
    category: 'выставки',
    genreSlot: 'жанр',
    genres: ['архитектурные', 'исторические', 'технические', 'фотографии', 'искусствоведческие'],
  },
  {
    category: 'музеи',
    genreSlot: 'жанр',
    genres: [
      'детские',
      'заповедники',
      'мемориальные',
      'квартиры исторические',
      'археологические',
      'естественнонаучные',
      'краеведческие',
      'литературные',
      'отраслевые',
      'художественные',
      'выставки',
      'архитектурные',
      'исторические',
      'комплексные',
      'технические',
      'искусствоведческие',
      'фотографии',
    ],
  },
  {
    category: 'стэндап',
    genreSlot: 'жанр',
    genres: ['сольный', 'женский'],
  },
  {
    category: 'спорт',
    genreSlot: 'жанр',
    genres: ['футбол', 'единоборства', 'баскетбол', 'автоспорт'],
  },
  {
    category: 'экскурсии',
    genreSlot: 'жанр',
    genres: [
      'пешеходные',
      'автобусные',
      'необычные',
      'обзорные',
      'детям',
      'театрализованная экскурсия',
      'экскурсия в особняк',
    ],
  },
  {
    category: 'образование',
    genreSlot: 'жанр',
    genres: ['дополнительное образование', 'вебинары', 'лекции', 'конференции', 'мастер-классы'],
  },
  {
    category: 'фестивали',
    genreSlot: 'жанр',
    genres: ['музыкальные фестивали', 'опен эйр'],
  },
  {
    category: 'туристам',
    genreSlot: 'жанр',
    genres: ['экскурсии', 'выставки', 'активный отдых'],
  },
  {
    category: 'детям',
    genreSlot: 'жанр',
    genres: [
      'детские спектакли',
      'детские концерты',
      'детские мюзиклы',
      'цирк / клоунада',
      'детские шоу',
    ],
  },
  {
    category: 'кино',
    genreSlot: 'жанр',
    genres: ['фильм', 'сеанс', 'премьера'],
  },
  {
    category: 'квесты',
    genreSlot: 'жанр',
    genres: ['escape room'],
  },
  {
    category: 'распродажа',
    genreSlot: '',
    genres: ['распродажа', 'скидки', 'акции'],
  },
]);

function normalizeEventTaxonomyValue(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[-/]+/gu, ' ')
    .replace(/[«»"'.,!?;:()[\]{}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function buildEventTaxonomyAliases(value = '') {
  const aliases = new Set();
  const normalizedValue = normalizeEventTaxonomyValue(value);
  if (normalizedValue) {
    aliases.add(normalizedValue);
  }

  String(value || '')
    .split('/')
    .map((part) => normalizeEventTaxonomyValue(part))
    .filter(Boolean)
    .forEach((alias) => aliases.add(alias));

  return aliases;
}

const EVENT_TAXONOMY_CATEGORY_VALUES = new Set(
  EVENT_TAXONOMY.map(({ category }) => normalizeEventTaxonomyValue(category)).filter(Boolean)
);

const EVENT_TAXONOMY_GENRE_VALUES = new Set(
  EVENT_TAXONOMY.flatMap(({ genres = [] }) =>
    genres.flatMap((genre) => Array.from(buildEventTaxonomyAliases(genre)))
  )
);

const EVENT_TAXONOMY_GENRE_ENTRIES = EVENT_TAXONOMY.flatMap(
  ({ category, genreSlot, genres = [] }) =>
    genres.map((genre) => ({
      category,
      genreSlot,
      genre,
      aliases: buildEventTaxonomyAliases(genre),
    }))
);

export function isKnownEventTaxonomyValue(value = '') {
  const normalizedValue = normalizeEventTaxonomyValue(value);
  if (!normalizedValue) {
    return false;
  }

  return (
    EVENT_TAXONOMY_CATEGORY_VALUES.has(normalizedValue) ||
    EVENT_TAXONOMY_GENRE_VALUES.has(normalizedValue)
  );
}

export function resolveEventTaxonomyGenreEntryByValue(value = '', { preferredCategory = '' } = {}) {
  const normalizedValue = normalizeEventTaxonomyValue(value);
  if (!normalizedValue || EVENT_TAXONOMY_CATEGORY_VALUES.has(normalizedValue)) {
    return null;
  }

  const normalizedPreferredCategory = normalizeEventTaxonomyValue(preferredCategory);
  const matches = EVENT_TAXONOMY_GENRE_ENTRIES.filter((entry) =>
    entry.aliases.has(normalizedValue)
  );
  if (matches.length === 0) {
    return null;
  }

  const matchedEntry = normalizedPreferredCategory
    ? matches.find(
        (entry) => normalizeEventTaxonomyValue(entry.category) === normalizedPreferredCategory
      ) || null
    : matches.length === 1
      ? matches[0]
      : null;
  if (!matchedEntry) {
    return null;
  }

  return {
    category: matchedEntry.category,
    slotName:
      matchedEntry.genreSlot === 'жанр_музыки/жанр' ? 'жанр' : matchedEntry.genreSlot || 'жанр',
    genre: matchedEntry.genre,
  };
}

function hasEventTaxonomyAliasInText(normalizedText = '', alias = '') {
  if (!normalizedText || !alias) {
    return false;
  }

  if (normalizedText === alias) {
    return true;
  }

  const aliasPattern = alias
    .split(/\s+/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\\s+');

  if (!aliasPattern) {
    return false;
  }

  const pattern = new RegExp(`(^| )${aliasPattern}(?=$| )`, 'u');
  return pattern.test(normalizedText);
}

export function resolveEventTaxonomyGenreEntryFromText(text = '', { preferredCategory = '' } = {}) {
  const normalizedText = normalizeEventTaxonomyValue(text);
  if (!normalizedText || EVENT_TAXONOMY_CATEGORY_VALUES.has(normalizedText)) {
    return null;
  }

  const normalizedPreferredCategory = normalizeEventTaxonomyValue(preferredCategory);
  const matches = EVENT_TAXONOMY_GENRE_ENTRIES.map((entry) => {
    if (
      normalizedPreferredCategory &&
      normalizeEventTaxonomyValue(entry.category) !== normalizedPreferredCategory
    ) {
      return null;
    }

    const matchedAliases = Array.from(entry.aliases).filter((alias) =>
      hasEventTaxonomyAliasInText(normalizedText, alias)
    );

    if (matchedAliases.length === 0) {
      return null;
    }

    const longestAliasLength = Math.max(...matchedAliases.map((alias) => alias.length), 0);
    return { entry, longestAliasLength };
  })
    .filter(Boolean)
    .sort((left, right) => right.longestAliasLength - left.longestAliasLength);

  if (matches.length === 0) {
    return null;
  }

  if (normalizedPreferredCategory) {
    const preferredMatch = matches[0]?.entry;
    return preferredMatch
      ? {
          category: preferredMatch.category,
          slotName:
            preferredMatch.genreSlot === 'жанр_музыки/жанр'
              ? 'жанр'
              : preferredMatch.genreSlot || 'жанр',
          genre: preferredMatch.genre,
        }
      : null;
  }

  const uniqueCategories = new Set(
    matches.map(({ entry }) => normalizeEventTaxonomyValue(entry.category))
  );

  if (uniqueCategories.size > 1) {
    return null;
  }

  const matchedEntry = matches[0].entry;
  return {
    category: matchedEntry.category,
    slotName:
      matchedEntry.genreSlot === 'жанр_музыки/жанр' ? 'жанр' : matchedEntry.genreSlot || 'жанр',
    genre: matchedEntry.genre,
  };
}

export function buildEventTaxonomyPrompt() {
  const categoryLines = EVENT_TAXONOMY.map(({ category, genreSlot, genres }) => {
    const slotPart = genreSlot ? `; слот жанра: ${genreSlot}` : '';
    return `- ${category}${slotPart}: ${genres.join(', ')}`;
  });

  return [
    '15. КРИТИЧЕСКИ ВАЖНО: используй следующую таксономию как источник правды для категорий и жанров.',
    '16. Если пользователь назвал ЖАНР или ПОДКАТЕГОРИЮ, ты обязан определить родительскую категорию и вернуть слот "тип_мероприятия" вместе со слотом жанра.',
    '17. Для музыкальных жанров используй слот "жанр_музыки"; для остальных жанров и подкатегорий используй слот "жанр".',
    '18. Никогда не трактуй жанры или подкатегории из этой таксономии как слот "исполнитель".',
    '19. Примеры: "хочу на оперу" => {"name":"тип_мероприятия","value":"театры"} + {"name":"жанр","value":"опера"}; "хочу на джаз" => {"name":"тип_мероприятия","value":"концерты"} + {"name":"жанр_музыки","value":"джаз"}; "хочу на мастер-класс" => {"name":"тип_мероприятия","value":"образование"} + {"name":"жанр","value":"мастер-классы"}.',
    '20. Если пользователь назвал именно категорию, а не жанр, возвращай только слот "тип_мероприятия" без выдумывания жанра.',
    'ТАКСОНОМИЯ КАТЕГОРИЙ И ЖАНРОВ:',
    ...categoryLines,
  ].join('\n');
}
