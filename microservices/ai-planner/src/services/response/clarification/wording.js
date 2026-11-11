import { normalizeClarificationTextForMatch } from '../textUtils.js';
import {
  resolveAmbiguousGenreCategoryChoice,
  getAmbiguousGenreContextSlot,
} from '../categoryRouting.js';
import {
  MOOD_TYPE_CLARIFICATION_BUTTONS,
  BUDGET_CLARIFICATION_BUTTONS,
  TIME_CLARIFICATION_BUTTONS,
  DATE_CLARIFICATION_BUTTONS,
  getCategoryClarificationButtons,
  getGenreClarificationButtons,
  canOfferMoodGenreClarification,
} from './buttons.js';

const MONTH_TO_PREPOSITIONAL = new Map([
  ['январь', 'январе'],
  ['января', 'январе'],
  ['январе', 'январе'],
  ['февраль', 'феврале'],
  ['февраля', 'феврале'],
  ['феврале', 'феврале'],
  ['март', 'марте'],
  ['марта', 'марте'],
  ['марте', 'марте'],
  ['апрель', 'апреле'],
  ['апреля', 'апреле'],
  ['апреле', 'апреле'],
  ['май', 'мае'],
  ['мая', 'мае'],
  ['мае', 'мае'],
  ['июнь', 'июне'],
  ['июня', 'июне'],
  ['июне', 'июне'],
  ['июль', 'июле'],
  ['июля', 'июле'],
  ['июле', 'июле'],
  ['август', 'августе'],
  ['августа', 'августе'],
  ['августе', 'августе'],
  ['сентябрь', 'сентябре'],
  ['сентября', 'сентябре'],
  ['сентябре', 'сентябре'],
  ['октябрь', 'октябре'],
  ['октября', 'октябре'],
  ['октябре', 'октябре'],
  ['ноябрь', 'ноябре'],
  ['ноября', 'ноябре'],
  ['ноябре', 'ноябре'],
  ['декабрь', 'декабре'],
  ['декабря', 'декабре'],
  ['декабре', 'декабре'],
]);

const WEEKDAY_TO_ACCUSATIVE = new Map([
  ['понедельник', 'понедельник'],
  ['вторник', 'вторник'],
  ['среда', 'среду'],
  ['среду', 'среду'],
  ['четверг', 'четверг'],
  ['пятница', 'пятницу'],
  ['пятницу', 'пятницу'],
  ['суббота', 'субботу'],
  ['субботу', 'субботу'],
  ['воскресенье', 'воскресенье'],
]);

function formatKnownDateForClarification(knownDate = '') {
  const value = String(knownDate || '').trim();
  if (!value) {
    return '';
  }

  const normalized = normalizeClarificationTextForMatch(value);
  if (!normalized) {
    return '';
  }

  if (/^(сегодня|завтра|послезавтра)(?![A-Za-zА-Яа-яЁё0-9_])/u.test(normalized)) {
    return value;
  }

  if (/^(следующ(?:ий|ем)|будущ(?:ий|ем))\s+месяц(?:е)?$/u.test(normalized)) {
    return normalized.includes('будущ') ? 'в будущем месяце' : 'в следующем месяце';
  }

  if (/^(следующ(?:ая|ую|ей)|будущ(?:ая|ую|ей))\s+недел(?:я|ю|е)$/u.test(normalized)) {
    return normalized.includes('будущ') ? 'на будущей неделе' : 'на следующей неделе';
  }

  if (/^(эт(?:а|у|ой)|текущ(?:ая|ую|ей))\s+недел(?:я|ю|е)$/u.test(normalized)) {
    return 'на этой неделе';
  }

  if (/^следующ(?:ие|их|им)\s+выходн/u.test(normalized)) {
    return 'на следующих выходных';
  }

  if (/^ближайш(?:ие|их|им)\s+выходн/u.test(normalized)) {
    return 'в ближайшие выходные';
  }

  if (/^выходн/u.test(normalized)) {
    return 'на выходных';
  }

  const normalizedWeekday = WEEKDAY_TO_ACCUSATIVE.get(normalized);
  if (normalizedWeekday) {
    return `на ${normalizedWeekday}`;
  }

  if (/^(на|в|во|к|ко|с|со|до|после)(?![A-Za-zА-Яа-яЁё0-9_])/u.test(normalized)) {
    return value;
  }

  const normalizedMonthWord = MONTH_TO_PREPOSITIONAL.get(normalized);
  if (normalizedMonthWord) {
    return `в ${normalizedMonthWord}`;
  }

  if (
    /(понедельник|вторник|среда|среду|четверг|пятница|пятницу|суббота|субботу|воскресенье|выходные|неделе|неделя)/u.test(
      normalized
    ) ||
    /\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?/u.test(normalized)
  ) {
    return `на ${value}`;
  }

  return value;
}

function formatKnownCityForClarification(knownCity = '') {
  const value = String(knownCity || '').trim();
  if (!value) {
    return '';
  }

  const overrides = new Map([
    ['Москва', 'в Москве'],
    ['Санкт-Петербург', 'в Санкт-Петербурге'],
    ['Нижний Новгород', 'в Нижнем Новгороде'],
  ]);

  if (overrides.has(value)) {
    return overrides.get(value);
  }

  const normalized = normalizeClarificationTextForMatch(value);
  if (!normalized) {
    return `в городе ${value}`;
  }

  if (/^(в|во)\s+/u.test(normalized)) {
    return value;
  }

  if (/[ая]$/u.test(value)) {
    return `в ${value.slice(0, -1)}е`;
  }

  if (/ь$/u.test(value)) {
    return `в ${value.slice(0, -1)}и`;
  }

  if (/[еиюоуы]$/u.test(value)) {
    return `в ${value}`;
  }

  return `в ${value}е`;
}

function buildClarificationContextTail({ target = '', knownCity = '', knownDate = '' } = {}) {
  const parts = [];

  if (target !== 'date') {
    const formattedDate = formatKnownDateForClarification(knownDate);
    if (formattedDate) {
      parts.push(formattedDate);
    }
  }

  if (knownCity) {
    parts.push(formatKnownCityForClarification(knownCity));
  }

  return parts.join(' ').trim();
}

function resolveGenreClarificationSubject(knownEventType = '') {
  const normalizedEventType = normalizeClarificationTextForMatch(knownEventType);
  if (!normalizedEventType) {
    return '';
  }

  if (normalizedEventType.includes('фестив')) {
    return 'фестивалей';
  }
  if (normalizedEventType.includes('концерт') || normalizedEventType.includes('музык')) {
    return 'концертов';
  }
  if (normalizedEventType.includes('театр') || normalizedEventType.includes('спектак')) {
    return 'спектаклей';
  }
  if (normalizedEventType.includes('выстав')) {
    return 'выставок';
  }
  if (normalizedEventType.includes('музе')) {
    return 'экспозиций';
  }
  if (normalizedEventType.includes('кино') || normalizedEventType.includes('фильм')) {
    return 'фильмов';
  }
  if (normalizedEventType.includes('стендап') || normalizedEventType.includes('стэндап')) {
    return 'стендап-шоу';
  }
  if (normalizedEventType.includes('шоу')) {
    return 'шоу';
  }

  return 'мероприятий';
}

function resolveTimeClarificationSubject(knownEventType = '') {
  const normalizedEventType = normalizeClarificationTextForMatch(knownEventType);
  if (!normalizedEventType) {
    return 'мероприятие';
  }

  if (normalizedEventType.includes('концерт') || normalizedEventType.includes('музык')) {
    return 'концерт';
  }
  if (normalizedEventType.includes('театр') || normalizedEventType.includes('спектак')) {
    return 'спектакль';
  }
  if (normalizedEventType.includes('выстав')) {
    return 'выставку';
  }
  if (normalizedEventType.includes('музе')) {
    return 'музей';
  }
  if (normalizedEventType.includes('кино') || normalizedEventType.includes('фильм')) {
    return 'кино';
  }
  if (normalizedEventType.includes('стендап') || normalizedEventType.includes('стэндап')) {
    return 'стендап';
  }
  if (normalizedEventType.includes('шоу')) {
    return 'шоу';
  }

  return 'мероприятие';
}

function buildClarificationActionResponse({
  target = '',
  knownEventType = '',
  userPreferences = null,
  slots = [],
  knownCity = '',
  knownDate = '',
  preferPopularSelectionCategories = false,
  seed = '',
} = {}) {
  const normalizedEventType = normalizeClarificationTextForMatch(knownEventType);
  const isTheater = normalizedEventType.includes('театр');
  const contextTail = buildClarificationContextTail({ target, knownCity, knownDate });
  const categoryButtons = getCategoryClarificationButtons(slots, {
    preferPopularSelectionCategories,
    seed,
  });

  if (target === 'time') {
    const timeSubject = resolveTimeClarificationSubject(knownEventType);
    return {
      message: contextTail
        ? isTheater
          ? `Когда вам удобнее начать спектакль ${contextTail}?`
          : `Когда вам удобнее посетить ${timeSubject} ${contextTail}?`
        : isTheater
          ? 'Когда вам удобнее начать спектакль?'
          : `Когда вам удобнее посетить ${timeSubject}?`,
      buttons: [...TIME_CLARIFICATION_BUTTONS],
      offer: null,
    };
  }

  if (target === 'budget') {
    return {
      message: contextTail
        ? `Какой бюджет на билет вам подходит ${contextTail}?`
        : 'Какой бюджет на билет вам подходит?',
      buttons: [...BUDGET_CLARIFICATION_BUTTONS],
      offer: null,
    };
  }

  if (target === 'date') {
    return {
      message: contextTail
        ? isTheater
          ? `На какую дату вы планируете посетить спектакль ${contextTail}?`
          : `На какую дату вы планируете посетить мероприятие ${contextTail}?`
        : isTheater
          ? 'На какую дату вы планируете посетить спектакль?'
          : 'На какую дату вы планируете посетить мероприятие?',
      buttons: [...DATE_CLARIFICATION_BUTTONS],
      offer: null,
    };
  }

  if (target === 'genre') {
    const genreSubject = normalizedEventType
      ? resolveGenreClarificationSubject(knownEventType)
      : '';
    const useMoodFormatQuestion =
      !normalizedEventType && canOfferMoodGenreClarification(slots, knownEventType);
    return {
      message: useMoodFormatQuestion
        ? contextTail
          ? `Что вам ближе по формату ${contextTail}?`
          : 'Что вам ближе по формату?'
        : contextTail
          ? genreSubject
            ? `Какой жанр ${genreSubject} вам ближе ${contextTail}?`
            : `Какой жанр вам ближе ${contextTail}?`
          : genreSubject
            ? `Какой жанр ${genreSubject} вам ближе?`
            : 'Какой жанр вам ближе?',
      buttons: getGenreClarificationButtons(knownEventType, userPreferences, slots),
      offer: null,
    };
  }

  if (target === 'category') {
    return {
      message: preferPopularSelectionCategories
        ? contextTail
          ? `Какая категория популярных событий вам интереснее ${contextTail}?`
          : 'Какая категория популярных событий вам сейчас интересна?'
        : contextTail
          ? `Что вам было бы интереснее ${contextTail}?`
          : 'Какая категория мероприятий вам сейчас интересна?',
      buttons: categoryButtons,
      offer: null,
    };
  }

  if (target === 'ambiguous_category') {
    const ambiguousGenreChoice = resolveAmbiguousGenreCategoryChoice({ slots, userMessage: '' });
    const ambiguousGenre = String(
      ambiguousGenreChoice?.genre || getAmbiguousGenreContextSlot(slots)?.value || ''
    ).trim();
    const ambiguousButtons =
      ambiguousGenreChoice?.buttons?.length > 0 ? ambiguousGenreChoice.buttons : categoryButtons;
    const citySuffix = knownCity ? ` в ${knownCity}` : '';

    return {
      message: ambiguousGenre
        ? `Жанр "${ambiguousGenre}" встречается в нескольких категориях${citySuffix}. Что вам ближе или показать все?`
        : contextTail
          ? `Что вам было бы интереснее ${contextTail}?`
          : 'Какая категория мероприятий вам сейчас интересна?',
      buttons: ambiguousButtons,
      offer: null,
    };
  }

  if (target === 'настроение') {
    return {
      message: contextTail
        ? `Какое у вас сейчас настроение ${contextTail}? Подберу подходящие мероприятия!`
        : 'Какое у вас сейчас настроение? Подберу подходящие мероприятия!',
      buttons: [...MOOD_TYPE_CLARIFICATION_BUTTONS],
      offer: null,
    };
  }

  return {
    message: 'Что именно хотите уточнить?',
    buttons: [],
    offer: null,
  };
}

export { buildClarificationActionResponse };
