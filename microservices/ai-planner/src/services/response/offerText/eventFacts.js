import { normalizeForMatch } from './eventMatching.js';
import { hashToIndex } from '../textUtils.js';

function formatPriceRange(event) {
  const hasPriceMin = event?.priceMin !== null && event?.priceMin !== undefined;
  const hasPriceMax = event?.priceMax !== null && event?.priceMax !== undefined;

  if (
    hasPriceMin &&
    Number(event.priceMin) === 0 &&
    (!hasPriceMax || Number(event.priceMax) === 0)
  ) {
    return 'бесплатно';
  }
  if (hasPriceMin && hasPriceMax) {
    return event.priceMin === event.priceMax
      ? `${event.priceMin} ₽`
      : `от ${event.priceMin} до ${event.priceMax} ₽`;
  }
  if (hasPriceMin) return `от ${event.priceMin} ₽`;
  if (hasPriceMax) return `до ${event.priceMax} ₽`;
  return '';
}

function formatRussianCount(value, forms) {
  const abs = Math.abs(Number(value));
  const mod10 = abs % 10;
  const mod100 = abs % 100;

  if (mod10 === 1 && mod100 !== 11) return `${value} ${forms[0]}`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${value} ${forms[1]}`;
  return `${value} ${forms[2]}`;
}

function formatDurationMinutes(durationMinutes) {
  const totalMinutes = Number(durationMinutes);
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return '';

  const roundedMinutes = Math.round(totalMinutes);
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;
  const parts = [];

  if (hours > 0) {
    parts.push(formatRussianCount(hours, ['час', 'часа', 'часов']));
  }
  if (minutes > 0 || hours === 0) {
    parts.push(formatRussianCount(minutes || roundedMinutes, ['минута', 'минуты', 'минут']));
  }

  return parts.join(' ');
}

function getIsoCalendarDate(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/u);
  return match ? match[1] : null;
}

function hasMultiDayRawDateRange(event) {
  const startDate = getIsoCalendarDate(event?.rawDate);
  const endDate = getIsoCalendarDate(event?.rawEndDate);
  return Boolean(startDate && endDate && startDate !== endDate);
}

function getEventDurationMinutes(event) {
  if (hasMultiDayRawDateRange(event)) {
    return null;
  }

  if (
    typeof event?.durationMinutes === 'number' &&
    event.durationMinutes > 0 &&
    event.durationMinutes <= 12 * 60
  ) {
    return event.durationMinutes;
  }

  return null;
}

function getDurationSubjectLabel(event) {
  const values = [
    event?.category,
    ...(Array.isArray(event?.extraCategories) ? event.extraCategories : []),
    event?.title,
  ]
    .filter(Boolean)
    .map((value) => normalizeForMatch(value));

  const joined = values.join(' ');
  if (/театр|спектакл|опера|балет|представлен/u.test(joined)) return 'представления';
  if (/концерт|групп|исполнитель|артист/u.test(joined)) return 'концерта';
  if (/фестивал/u.test(joined)) return 'фестиваля';
  if (/выстав/u.test(joined)) return 'выставки';
  if (/шоу/u.test(joined)) return 'шоу';
  return 'мероприятия';
}

function getApproximateDurationText(event) {
  const subject = getDurationSubjectLabel(event);
  const title = String(event?.title || '').trim();
  const seed = normalizeForMatch(`${title}|${event?.category || ''}|${subject}`);

  if (subject === 'представления') {
    const variants = [
      'Обычно такие представления длятся около 2-3 часов.',
      'Как правило, на такое представление стоит закладывать примерно 2-3 часа.',
      'Ориентировочно похожие постановки идут в районе 2-3 часов.',
    ];
    return variants[hashToIndex(seed || subject, variants.length)];
  }
  if (subject === 'концерта') {
    const variants = [
      'Обычно концерты длятся около 2 часов.',
      'Чаще всего на концерт стоит закладывать примерно 2 часа.',
      'Ориентировочно похожие концерты идут около 2 часов.',
    ];
    return variants[hashToIndex(seed || subject, variants.length)];
  }
  if (subject === 'шоу') {
    return 'Обычно такие шоу длятся около 1,5-2 часов.';
  }
  if (subject === 'фестиваля') {
    return 'У фестивалей длительность сильно зависит от программы.';
  }
  if (subject === 'выставки') {
    return 'Обычно на выставку закладывают около 1-2 часов.';
  }

  return 'Обычно такие мероприятия длятся около 1,5-2 часов.';
}

function buildUnknownDurationDetailsText(event) {
  const subject = getDurationSubjectLabel(event);
  return `Точная длительность ${subject} не указана.\n${getApproximateDurationText(event)}\n\nУточните бюджет или время, чтобы я мог предложить ещё варианты.`;
}

function isEventDurationQuestionText(text) {
  const normalized = normalizeForMatch(text);
  if (!normalized) return false;

  return (
    /(?:длит|длил|длилась|длился|длились|длитель|длят)/u.test(normalized) ||
    /продолж/u.test(normalized) ||
    /как\s+долго/u.test(normalized) ||
    /по\s+времени/u.test(normalized) ||
    /скольк\S*\s+(?:ид[её]т|длят|длит)/u.test(normalized)
  );
}

function isFreeEvent(event) {
  const hasPriceMin = event?.priceMin !== null && event?.priceMin !== undefined;
  const hasPriceMax = event?.priceMax !== null && event?.priceMax !== undefined;

  return (
    (hasPriceMin &&
      Number(event.priceMin) === 0 &&
      (!hasPriceMax || Number(event.priceMax) === 0)) ||
    (!hasPriceMin && hasPriceMax && Number(event.priceMax) === 0)
  );
}

function textClaimsFreePrice(text) {
  const normalized = normalizeForMatch(text);
  if (!normalized) return false;
  return /(^|\s)бесплат(но|н(ый|ая|ое|ые|ых))(?=\s|$)/u.test(normalized);
}

function hasFreePriceMismatch(text, event) {
  if (!text || !event) return false;
  return textClaimsFreePrice(text) && !isFreeEvent(event);
}

export {
  formatPriceRange,
  formatDurationMinutes,
  getEventDurationMinutes,
  buildUnknownDurationDetailsText,
  isEventDurationQuestionText,
  textClaimsFreePrice,
  hasFreePriceMismatch,
};
