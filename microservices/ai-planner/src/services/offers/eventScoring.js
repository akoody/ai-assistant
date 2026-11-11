import {
  THEATER_REQUEST_MARKERS,
  THEATER_NON_PERFORMANCE_NEGATIVE_MARKERS,
  THEATER_PERFORMANCE_POSITIVE_MARKERS,
} from './dateScoring.js';
import { toPriceNumber } from './budgetPolicy.js';
import { findMoodSearchProfile } from './searchRouting.js';

function isTheaterPerformanceRequestValue(value = '') {
  const normalized = String(value || '')
    .toLowerCase()
    .trim();
  if (!normalized) {
    return false;
  }
  return THEATER_REQUEST_MARKERS.some((marker) => normalized.includes(marker));
}

function isTheaterPerformanceCandidate(event) {
  if (!event || typeof event !== 'object') {
    return true;
  }

  const titleLower = (event.title || '').toLowerCase();
  const descriptionLower = (event.description || '').toLowerCase();
  const venueLower = (event.venue || '').toLowerCase();
  const categoryLower = (event.category || '').toLowerCase();
  const extraCategoriesLower = Array.isArray(event.extraCategories)
    ? event.extraCategories.join(' ').toLowerCase()
    : '';
  const categoriesText = Array.isArray(event.categories)
    ? event.categories.join(' ').toLowerCase()
    : '';

  const allText = `${titleLower} ${descriptionLower} ${venueLower} ${categoryLower} ${extraCategoriesLower} ${categoriesText}`;
  const hasNonPerformanceMarkers = THEATER_NON_PERFORMANCE_NEGATIVE_MARKERS.some((marker) =>
    allText.includes(marker)
  );

  if (!hasNonPerformanceMarkers) {
    return true;
  }

  return THEATER_PERFORMANCE_POSITIVE_MARKERS.some((marker) => allText.includes(marker));
}

function scoreGenreTypeMatch(event, searchTerm, options = {}) {
  if (!searchTerm || !event) return 0;

  const { matchVenue = false, matchCategory = true } = options;

  const searchLower = searchTerm.toLowerCase().trim();
  const titleLower = (event.title || '').toLowerCase();
  const descriptionLower = (event.description || '').toLowerCase();
  const categoryLower = (event.category || '').toLowerCase();
  const extraCategoriesLower = Array.isArray(event.extraCategories)
    ? event.extraCategories.join(' ').toLowerCase()
    : '';
  const venueLower = (event.venue || '').toLowerCase();
  const words = searchLower.split(/\s+/).filter((w) => w.length > 2);

  if (matchCategory) {
    if (extraCategoriesLower.includes(searchLower)) {
      return 30;
    }

    if (categoryLower.includes(searchLower)) {
      return 27;
    }

    if (words.length > 0) {
      const allWordsInExtraCategories = words.every((word) => extraCategoriesLower.includes(word));
      if (allWordsInExtraCategories) {
        return 25;
      }

      const allWordsInCategory = words.every((word) => categoryLower.includes(word));
      if (allWordsInCategory) {
        return 22;
      }
    }
  }

  // Точное совпадение в названии - максимальный балл
  if (titleLower.includes(searchLower)) {
    return 28;
  }

  // Частичное совпадение в названии (все слова присутствуют)
  if (words.length > 0) {
    const allWordsMatch = words.every((word) => titleLower.includes(word));
    if (allWordsMatch) {
      return 24;
    }

    // Большинство слов совпадает
    const matchedWords = words.filter((word) => titleLower.includes(word)).length;
    const matchRatio = matchedWords / words.length;
    if (matchRatio >= 0.7) {
      return 20;
    }
  }

  // Совпадение в описании
  if (descriptionLower.includes(searchLower)) {
    return 15;
  }

  // Частичное совпадение в описании
  if (words.length > 0) {
    const someWordsMatch = words.some((word) => descriptionLower.includes(word));
    if (someWordsMatch) {
      return 10;
    }
  }

  if (matchVenue) {
    if (venueLower.includes(searchLower)) {
      return 14;
    }

    if (words.length > 0) {
      const allWordsMatch = words.every((word) => venueLower.includes(word));
      if (allWordsMatch) {
        return 11;
      }
    }
  }

  // Если есть явное несоответствие (например, ищем "рок", а в названии "джаз")
  // Это сложно определить автоматически, поэтому просто возвращаем 0
  // События без совпадений получат низкий общий балл из-за отсутствия бонусов

  return 0;
}

function scoreContextMatch(event, context) {
  if (!context || !event) return 0;

  const titleLower = (event.title || '').toLowerCase();
  const descriptionLower = (event.description || '').toLowerCase();
  const venueLower = (event.venue || '').toLowerCase();
  const categoriesText = Array.isArray(event.categories)
    ? event.categories.join(' ').toLowerCase()
    : '';
  const allText = `${titleLower} ${descriptionLower} ${venueLower} ${categoriesText}`;

  // Детские маркеры
  const childrenMarkers = [
    'детям',
    'детский',
    'для детей',
    'детская',
    'ребёнок',
    'ребенок',
    'школьник',
    'малыш',
    'мультфильм',
    'сказка',
    'для малышей',
    '0+',
    '3+',
    '6+',
    'детский театр',
    'кукольный',
    'детский спектакль',
    'утренник',
    'фея',
    'принцесса',
    'колёсики',
    'колесики',
  ];
  const isChildrenEvent = childrenMarkers.some((marker) => allText.includes(marker));

  // Библиотечные/образовательные маркеры (обычно не подходят для свидания)
  const libraryMarkers = [
    'библиотека',
    'библиотечн',
    'образовательн',
    'урок',
    'лекция для школьников',
    'сельская библиотека',
    'детская библиотека',
  ];
  const isLibraryEvent = libraryMarkers.some((marker) => allText.includes(marker));

  // Романтические маркеры
  const romanticMarkers = [
    'романтик',
    'романтичн',
    'джаз',
    'классическ',
    'симфонич',
    'балет',
    'опера',
    'вечерний',
    'камерный',
    'фортепиано',
    'скрипка',
    'оркестр',
    'ария',
    'неокласс',
    'при свеч',
    'свеч',
    'орган',
    'органн',
    'струнн',
    'квартет',
    'дуэт',
    'арфа',
    'серенада',
    'танго',
    'вальс',
    'лаунж',
    'lounge',
    'босса',
    'bossa',
  ];
  const isRomanticEvent = romanticMarkers.some((marker) => allText.includes(marker));

  // Развлекательные маркеры (для друзей)
  const funMarkers = [
    'стендап',
    'комеди',
    'юмор',
    'рок',
    'поп',
    'электронн',
    'танцевальн',
    'дискотека',
    'вечеринка',
    'фестиваль',
    'квиз',
    'бар',
    'паб',
  ];
  const isFunEvent = funMarkers.some((marker) => allText.includes(marker));

  // Театральные маркеры
  const theaterMarkers = ['театр', 'спектакль', 'постановка', 'драма', 'комедия', 'мюзикл'];
  const isTheaterEvent = theaterMarkers.some((marker) => allText.includes(marker));

  switch (context) {
    case 'свидание':
      // Для свидания: большой штраф за детские и библиотечные мероприятия
      if (isChildrenEvent) {
        return -50; // Детские мероприятия совсем не подходят для свидания
      }
      if (isLibraryEvent) {
        return -40; // Библиотечные мероприятия обычно не подходят
      }
      // Бонус за романтические мероприятия
      if (isRomanticEvent) {
        return 30;
      }
      // Штраф за явно "тусовочный" формат, если нет романтических/театральных маркеров
      if (isFunEvent && !isTheaterEvent) {
        return -10;
      }
      // Бонус за театр (но не детский)
      if (isTheaterEvent && !isChildrenEvent) {
        return 20;
      }
      // Небольшой бонус за вечерние концерты
      const eventTime = event.time || '';
      if (eventTime && parseInt(eventTime) >= 18) {
        return 10;
      }
      return 0;

    case 'с_друзьями':
      // Для друзей: штраф за детские мероприятия, бонус за развлекательные
      if (isChildrenEvent) {
        return -30;
      }
      if (isFunEvent) {
        return 25;
      }
      if (allText.includes('концерт') || allText.includes('шоу')) {
        return 15;
      }
      return 0;

    case 'семейный':
      // Для семьи: нейтрально к детским, бонус за семейные мероприятия
      if (
        allText.includes('семейн') ||
        allText.includes('всей семьёй') ||
        allText.includes('для всей семьи')
      ) {
        return 25;
      }
      if (isTheaterEvent || allText.includes('цирк') || allText.includes('шоу')) {
        return 15;
      }
      // Детские мероприятия допустимы для семейного контекста
      if (isChildrenEvent) {
        return 5;
      }
      return 0;

    case 'один':
      // Для одного: нейтрально, небольшой бонус за лекции, выставки
      if (allText.includes('выставка') || allText.includes('музей') || allText.includes('лекция')) {
        return 15;
      }
      if (allText.includes('концерт')) {
        return 10;
      }
      return 0;

    case 'корпоратив':
      // Для корпоратива: бонус за шоу, концерты, командные мероприятия
      if (allText.includes('корпоратив') || allText.includes('тимбилдинг')) {
        return 30;
      }
      if (allText.includes('шоу') || allText.includes('концерт') || allText.includes('квест')) {
        return 20;
      }
      if (isChildrenEvent) {
        return -30;
      }
      return 0;

    default:
      return 0;
  }
}

function scoreSeniorFriendlyMatch(event) {
  if (!event) return 0;

  const titleLower = (event.title || '').toLowerCase();
  const descriptionLower = (event.description || '').toLowerCase();
  const venueLower = (event.venue || '').toLowerCase();
  const categoriesText = Array.isArray(event.categories)
    ? event.categories.join(' ').toLowerCase()
    : '';
  const allText = `${titleLower} ${descriptionLower} ${venueLower} ${categoriesText}`;

  const calmMarkers = [
    'театр',
    'спектакль',
    'опера',
    'балет',
    'выставк',
    'музе',
    'галере',
    'экскурс',
    'классик',
    'симфон',
    'оркестр',
    'джаз',
    'орган',
    'фортепиано',
    'струнн',
    'романс',
    'хор',
    'хоров',
    'творческ',
    'инструментальн',
  ];
  const loudMarkers = [
    'рок',
    'метал',
    'metal',
    'панк',
    'электронн',
    'техно',
    'рейв',
    'rave',
    'клуб',
    'club',
    'дискотек',
    'танцпол',
    'хип-хоп',
    'хип хоп',
    'рэп',
    'слэм',
    'hard rock',
    'стендап',
    'standup',
    'stand-up',
    'stand up',
    'комеди',
    'юмор',
    'поп концерт',
    'поп-концерт',
    'эстрад',
  ];

  const hasCalmSignal = calmMarkers.some((marker) => allText.includes(marker));
  const hasLoudSignal = loudMarkers.some((marker) => allText.includes(marker));

  if (hasCalmSignal && hasLoudSignal) return -4;
  if (hasCalmSignal) return 18;
  if (hasLoudSignal) return -22;
  return 0;
}

function scorePriceMatch(event, budget) {
  const eventPriceMin = toPriceNumber(event?.priceMin);
  const eventPriceMax = toPriceNumber(event?.priceMax) ?? eventPriceMin;
  if (!budget || budget <= 0 || eventPriceMin === null) return 0;

  // ВАЖНО: Если максимальная цена превышает бюджет, событие не подходит
  // Пользователь указал конкретный бюджет, и мы должны строго его соблюдать
  if (eventPriceMax > budget) {
    // Максимальная цена превышает бюджет - очень большой штраф
    // Это событие не должно попасть в результат
    const excess = eventPriceMax - budget;
    const excessRatio = excess / budget;
    // Чем больше превышение, тем больше штраф
    return -100 - excessRatio * 50; // От -100 до -500+ в зависимости от превышения
  }

  // Если максимальная цена в пределах бюджета, проверяем минимальную цену
  // Цена в пределах бюджета - максимальный балл
  if (eventPriceMin <= budget) {
    // Чем ближе к бюджету (но не превышает), тем лучше
    const ratio = eventPriceMin / budget;
    return 20 - (1 - ratio) * 5; // От 15 до 20
  }

  // Минимальная цена превышает бюджет (но max не превышает - странный случай, но возможен)
  // Это тоже не подходит
  const excess = eventPriceMin - budget;
  const excessRatio = excess / budget;

  if (excessRatio <= 0.1) {
    // Превышение до 10% - небольшой штраф
    return -5;
  } else if (excessRatio <= 0.2) {
    // Превышение до 20% - средний штраф
    return -15;
  } else {
    // Превышение более 20% - большой штраф
    return -30;
  }
}

function scoreMoodMatch(event, moodValue) {
  if (!event || !moodValue) {
    return 0;
  }

  const profile = findMoodSearchProfile(moodValue);
  if (!profile) {
    return 0;
  }

  const titleLower = (event.title || '').toLowerCase().replace(/ё/g, 'е');
  const descriptionLower = (event.description || '').toLowerCase().replace(/ё/g, 'е');
  const venueLower = (event.venue || '').toLowerCase().replace(/ё/g, 'е');
  const categoriesText = Array.isArray(event.categories)
    ? event.categories.join(' ').toLowerCase().replace(/ё/g, 'е')
    : '';
  const allText = `${titleLower} ${descriptionLower} ${venueLower} ${categoriesText}`;

  const positiveMatches = Array.isArray(profile.positiveMarkers)
    ? profile.positiveMarkers.filter((marker) => marker && allText.includes(marker)).length
    : 0;
  const negativeMatches = Array.isArray(profile.negativeMarkers)
    ? profile.negativeMarkers.filter((marker) => marker && allText.includes(marker)).length
    : 0;

  if (positiveMatches === 0 && negativeMatches === 0) {
    return 0;
  }

  let score = Math.min(positiveMatches * 7, 28) - Math.min(negativeMatches * 9, 27);

  if (positiveMatches > 0 && negativeMatches === 0) {
    score += 6;
  }

  return score;
}

export {
  isTheaterPerformanceRequestValue,
  isTheaterPerformanceCandidate,
  scoreGenreTypeMatch,
  scoreContextMatch,
  scoreSeniorFriendlyMatch,
  scorePriceMatch,
  scoreMoodMatch,
};
