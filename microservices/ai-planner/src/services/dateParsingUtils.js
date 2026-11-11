/**
 * Утилиты для парсинга дат из слотов
 * Дублирует логику из ai-slots для использования в ai-planner
 */

import { extractDateHintFromText } from './naturalLanguageHints.js';

const MONTH_NAMES = {
  январь: 0,
  февраль: 1,
  март: 2,
  апрель: 3,
  май: 4,
  июнь: 5,
  июль: 6,
  август: 7,
  сентябрь: 8,
  октябрь: 9,
  ноябрь: 10,
  декабрь: 11,
  января: 0,
  февраля: 1,
  марта: 2,
  апреля: 3,
  мая: 4,
  июня: 5,
  июля: 6,
  августа: 7,
  сентября: 8,
  октября: 9,
  ноября: 10,
  декабря: 11,
  январе: 0,
  феврале: 1,
  марте: 2,
  апреле: 3,
  мае: 4,
  июне: 5,
  июле: 6,
  августе: 7,
  сентябре: 8,
  октябре: 9,
  ноябре: 10,
  декабре: 11,
};

const DAY_OF_WEEK_PATTERNS = [
  { day: 1, patterns: [/понедельн/iu] },
  { day: 2, patterns: [/вторн/iu] },
  { day: 3, patterns: [/сред/iu] },
  { day: 4, patterns: [/четверг/iu, /четвер/iu] },
  {
    day: 5,
    patterns: [
      /пятниц/iu,
      /пятн(?![A-Za-zА-Яа-яЁё0-9_])/iu,
      /(?<![A-Za-zА-Яа-яЁё0-9_])пт(?![A-Za-zА-Яа-яЁё0-9_])/iu,
    ],
  },
  { day: 6, patterns: [/суббот/iu, /(?<![A-Za-zА-Яа-яЁё0-9_])сб(?![A-Za-zА-Яа-яЁё0-9_])/iu] },
  { day: 0, patterns: [/воскрес/iu, /(?<![A-Za-zА-Яа-яЁё0-9_])вс(?![A-Za-zА-Яа-яЁё0-9_])/iu] },
];

const RELATIVE_NUMBER_WORDS = {
  ноль: 0,
  один: 1,
  одна: 1,
  одну: 1,
  первый: 1,
  первую: 1,
  два: 2,
  две: 2,
  пару: 2,
  пара: 2,
  три: 3,
  четыре: 4,
  пять: 5,
  шесть: 6,
  семь: 7,
  восемь: 8,
  девять: 9,
  десять: 10,
  одиннадцать: 11,
  двенадцать: 12,
};

const MONTH_PATTERN_SOURCE = Object.keys(MONTH_NAMES)
  .sort((a, b) => b.length - a.length)
  .map(escapeRegExp)
  .join('|');

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseWeekend(today) {
  const dayOfWeek = today.getDay();
  const saturday = new Date(today);

  const daysUntilSaturday = (6 - dayOfWeek + 7) % 7 || 7;
  saturday.setDate(today.getDate() + daysUntilSaturday);
  saturday.setHours(0, 0, 0, 0);

  const sunday = new Date(saturday);
  sunday.setDate(saturday.getDate() + 1);
  sunday.setHours(23, 59, 59, 999);

  return {
    dateRange: {
      startDate: saturday,
      endDate: sunday,
    },
  };
}

function parseThisWeek(today) {
  const dayOfWeek = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1));
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return {
    dateRange: {
      startDate: monday,
      endDate: sunday,
    },
  };
}

function parseNextWeek(today) {
  const currentWeek = parseThisWeek(today);
  const startDate = new Date(currentWeek.dateRange.startDate);
  const endDate = new Date(currentWeek.dateRange.endDate);
  startDate.setDate(startDate.getDate() + 7);
  endDate.setDate(endDate.getDate() + 7);

  return {
    dateRange: {
      startDate,
      endDate,
    },
  };
}

function parseNextWeekend(today) {
  const nextWeek = parseNextWeek(today);
  const monday = new Date(nextWeek.dateRange.startDate);
  monday.setHours(0, 0, 0, 0);

  const saturday = new Date(monday);
  saturday.setDate(monday.getDate() + 5);
  saturday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return {
    dateRange: {
      startDate: saturday,
      endDate: sunday,
    },
  };
}

function getMonthRange(year, monthNumber) {
  const startDate = new Date(year, monthNumber, 1);
  startDate.setHours(0, 0, 0, 0);

  const endDate = new Date(year, monthNumber + 1, 0);
  endDate.setHours(23, 59, 59, 999);

  return { startDate, endDate };
}

function buildExplicitDateRange(startYear, startMonth, startDay, endYear, endMonth, endDay) {
  if (
    !isValidDateParts(startYear, startMonth, startDay) ||
    !isValidDateParts(endYear, endMonth, endDay)
  ) {
    return null;
  }

  const startDate = new Date(startYear, startMonth, startDay);
  startDate.setHours(0, 0, 0, 0);

  const endDate = new Date(endYear, endMonth, endDay);
  endDate.setHours(23, 59, 59, 999);

  if (endDate < startDate) {
    return null;
  }

  return {
    parsedDate: new Date(startDate),
    dateRange: {
      startDate,
      endDate,
    },
  };
}

function resolveTargetYearsForRange(
  today,
  startMonthNumber,
  startDay,
  endMonthNumber = startMonthNumber,
  endDay = startDay
) {
  const currentYear = today.getFullYear();
  let startYear = currentYear;
  let endYear = currentYear;

  if (endMonthNumber < startMonthNumber) {
    endYear += 1;
  }

  const candidateEnd = new Date(endYear, endMonthNumber, endDay);
  candidateEnd.setHours(23, 59, 59, 999);

  if (candidateEnd < today) {
    startYear += 1;
    endYear += 1;
  }

  return { startYear, endYear };
}

function extractWeekday(value) {
  for (const { day, patterns } of DAY_OF_WEEK_PATTERNS) {
    if (patterns.some((pattern) => pattern.test(value))) {
      return day;
    }
  }

  return null;
}

function resolveWeekdayInRange(weekRange, targetDay) {
  if (!weekRange?.dateRange?.startDate || typeof targetDay !== 'number') {
    return null;
  }

  const targetDate = new Date(weekRange.dateRange.startDate);
  while (targetDate.getDay() !== targetDay) {
    targetDate.setDate(targetDate.getDate() + 1);
  }
  targetDate.setHours(0, 0, 0, 0);
  return targetDate;
}

function parseQualifiedWeekday(value, today) {
  const normalizedValue = String(value || '')
    .toLowerCase()
    .trim();
  if (!normalizedValue) {
    return null;
  }

  const targetDay = extractWeekday(normalizedValue);
  if (targetDay === null) {
    return null;
  }

  let weekRange = null;
  if (
    normalizedValue.includes('будущей неделе') ||
    normalizedValue.includes('на будущей неделе') ||
    normalizedValue.includes('будущая неделя') ||
    normalizedValue.includes('будущую неделю') ||
    normalizedValue.includes('на будущую неделю') ||
    normalizedValue.includes('следующей неделе') ||
    normalizedValue.includes('на следующей неделе')
  ) {
    weekRange = parseNextWeek(today);
  } else if (
    normalizedValue.includes('этой неделе') ||
    normalizedValue.includes('на этой неделе')
  ) {
    weekRange = parseThisWeek(today);
  }

  if (!weekRange) {
    return null;
  }

  const targetDate = resolveWeekdayInRange(weekRange, targetDay);
  if (!targetDate) {
    return null;
  }

  return { parsedDate: targetDate };
}

function parseRelativeDateValue(value, today) {
  const relativeMonthReference = parseRelativeMonthReference(value, today);
  if (relativeMonthReference) {
    return relativeMonthReference;
  }

  const hasWeekend = value.includes('выходн') || value.includes('уикенд');
  const hasNextWeek =
    value.includes('следующей неделе') ||
    value.includes('на следующей неделе') ||
    value.includes('будущей неделе') ||
    value.includes('на будущей неделе') ||
    value.includes('будущая неделя') ||
    value.includes('будущую неделю') ||
    value.includes('на будущую неделю') ||
    value.includes('следующая неделя') ||
    value.includes('следующую неделю');

  // ВАЖНО: комбинация "выходные на следующей неделе" должна иметь приоритет
  // над обычным "в выходные", иначе всегда берутся ближайшие выходные.
  if (hasWeekend && hasNextWeek) {
    return parseNextWeekend(today);
  }

  // «следующие выходные» / «на следующих выходных» — ближайшие upcoming выходные
  // относительно текущего дня. Явная формулировка со словом «неделя»
  // ("выходные на следующей неделе") обрабатывается выше и уводит поиск на +7 дней.
  // Не используем \b: для кириллицы в JS границы «слова» ненадёжны.
  if (
    (value.includes('выходн') || value.includes('уикенд')) &&
    /следующ(?:ие|их|им)\s+выходн/u.test(value) &&
    !value.includes('недел')
  ) {
    return parseWeekend(today);
  }

  const relativeDuration = parseRelativeDuration(value, today);
  if (relativeDuration) {
    return relativeDuration;
  }

  if (value === 'сегодня' || value.includes('сегодня')) {
    return { parsedDate: new Date(today) };
  }

  if (value === 'послезавтра' || value.includes('послезавтра')) {
    const dayAfterTomorrow = new Date(today);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
    return { parsedDate: dayAfterTomorrow };
  }

  if (value === 'завтра' || value.includes('завтра')) {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return { parsedDate: tomorrow };
  }

  if (value === 'вчера' || value.includes('вчера')) {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return { parsedDate: yesterday };
  }

  if (value.includes('выходн')) {
    return parseWeekend(today);
  }

  if (
    value.includes('этой неделе') ||
    value.includes('на этой неделе') ||
    value.includes('эта неделя') ||
    value.includes('эту неделю')
  ) {
    return parseThisWeek(today);
  }

  if (
    value.includes('следующей неделе') ||
    value.includes('на следующей неделе') ||
    value.includes('будущей неделе') ||
    value.includes('на будущей неделе') ||
    value.includes('будущая неделя') ||
    value.includes('будущую неделю') ||
    value.includes('на будущую неделю') ||
    value.includes('следующая неделя') ||
    value.includes('следующую неделю')
  ) {
    return parseNextWeek(today);
  }

  return null;
}

function parseRelativeMonthReference(value, today) {
  const normalizedValue = String(value || '')
    .toLowerCase()
    .trim();
  if (!normalizedValue) {
    return null;
  }

  if (
    /(?:^|[\s,.:;!?()"«»-])(?:(?:в|на)\s+)?(?:следующ(?:ем|ий)|будущ(?:ем|ий))\s+месяц(?:е)?(?=$|[\s,.:;!?()"«»-])/u.test(
      normalizedValue
    )
  ) {
    return { dateRange: getMonthRange(today.getFullYear(), today.getMonth() + 1) };
  }

  return null;
}

function parseRelativeDuration(value, today) {
  const normalized = String(value || '')
    .toLowerCase()
    .trim();
  if (!normalized) {
    return null;
  }

  const numericMatch = normalized.match(
    /(?:через|спустя)\s+(\d+)\s*(дн(?:я|ей|ь)?|сут(?:ки|ок)?|недел(?:ю|и|ь)|месяц(?:а|ев)?|год(?:а|ов)?|лет|час(?:а|ов)?)/u
  );
  const wordMatch = normalized.match(
    /(?:через|спустя)\s+(ноль|один|одна|одну|первый|первую|два|две|пара|пару|три|четыре|пять|шесть|семь|восемь|девять|десять|одиннадцать|двенадцать)\s+(день|дня|дней|сутки|суток|неделю|недели|недель|месяц|месяца|месяцев|год|года|лет|час|часа|часов)/u
  );

  const rawAmount = numericMatch ? numericMatch[1] : wordMatch ? wordMatch[1] : null;
  const rawUnit = numericMatch ? numericMatch[2] : wordMatch ? wordMatch[2] : null;

  if (!rawAmount || !rawUnit) {
    if (normalized.includes('через неделю')) {
      return parseNextWeek(today);
    }
    return null;
  }

  const amount = numericMatch
    ? Number.parseInt(rawAmount, 10)
    : (RELATIVE_NUMBER_WORDS[rawAmount] ?? Number.NaN);
  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }

  const unit = String(rawUnit).toLowerCase();
  if (/дн|сут/u.test(unit)) {
    const parsedDate = new Date(today);
    parsedDate.setDate(parsedDate.getDate() + amount);
    parsedDate.setHours(0, 0, 0, 0);
    return { parsedDate };
  }

  if (/недел/u.test(unit)) {
    const baseWeek = parseThisWeek(today);
    const startDate = new Date(baseWeek.dateRange.startDate);
    startDate.setDate(startDate.getDate() + amount * 7);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 6);
    endDate.setHours(23, 59, 59, 999);
    return { dateRange: { startDate, endDate } };
  }

  if (/месяц/u.test(unit)) {
    const startDate = new Date(today.getFullYear(), today.getMonth() + amount, 1);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0);
    endDate.setHours(23, 59, 59, 999);
    return { dateRange: { startDate, endDate } };
  }

  if (/год|лет/u.test(unit)) {
    const startDate = new Date(today.getFullYear() + amount, 0, 1);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(today.getFullYear() + amount, 11, 31);
    endDate.setHours(23, 59, 59, 999);
    return { dateRange: { startDate, endDate } };
  }

  if (/час/u.test(unit)) {
    const parsedDate = new Date(today);
    parsedDate.setHours(parsedDate.getHours() + amount, 0, 0, 0);
    return { parsedDate };
  }

  return null;
}

function isValidDateParts(year, monthNumber, day) {
  const candidate = new Date(year, monthNumber, day);
  return (
    candidate.getFullYear() === year &&
    candidate.getMonth() === monthNumber &&
    candidate.getDate() === day
  );
}

function resolveTargetYear(today, monthNumber, day) {
  const currentYear = today.getFullYear();
  const candidate = new Date(currentYear, monthNumber, day);
  candidate.setHours(0, 0, 0, 0);
  return candidate < today ? currentYear + 1 : currentYear;
}

function parseCrossMonthDateRange(value, today) {
  const normalizedValue = String(value || '')
    .toLowerCase()
    .replace(/[–—−]/gu, '-')
    .replace(/\s+/gu, ' ')
    .trim();

  const pattern = new RegExp(
    `(?:с\\s*)?(\\d{1,2})\\s*(${MONTH_PATTERN_SOURCE})(?:\\s*(\\d{4}))?\\s*(?:-|по)\\s*(\\d{1,2})\\s*(${MONTH_PATTERN_SOURCE})(?:\\s*(\\d{4}))?`,
    'iu'
  );

  const match = normalizedValue.match(pattern);
  if (!match) {
    return null;
  }

  const startDay = Number.parseInt(match[1], 10);
  const startMonth = MONTH_NAMES[match[2].toLowerCase()];
  const explicitStartYear = match[3] ? Number.parseInt(match[3], 10) : null;
  const endDay = Number.parseInt(match[4], 10);
  const endMonth = MONTH_NAMES[match[5].toLowerCase()];
  const explicitEndYear = match[6] ? Number.parseInt(match[6], 10) : null;

  if (
    !Number.isInteger(startDay) ||
    !Number.isInteger(endDay) ||
    startMonth === undefined ||
    endMonth === undefined
  ) {
    return null;
  }

  if (explicitStartYear || explicitEndYear) {
    const startYear = explicitStartYear || explicitEndYear;
    const endYear = explicitEndYear || explicitStartYear || startYear;
    return buildExplicitDateRange(startYear, startMonth, startDay, endYear, endMonth, endDay);
  }

  const { startYear, endYear } = resolveTargetYearsForRange(
    today,
    startMonth,
    startDay,
    endMonth,
    endDay
  );
  return buildExplicitDateRange(startYear, startMonth, startDay, endYear, endMonth, endDay);
}

function parseSpecificDateRange(value, today) {
  const normalizedValue = String(value || '')
    .toLowerCase()
    .replace(/[–—−]/gu, '-')
    .replace(/\s+/gu, ' ')
    .trim();

  for (const [monthName, monthNumber] of Object.entries(MONTH_NAMES)) {
    if (!normalizedValue.includes(monthName)) {
      continue;
    }

    const rangePattern = new RegExp(
      `(?:с\\s*)?(\\d{1,2})\\s*(?:-|по)\\s*(\\d{1,2})\\s*${monthName}(?:\\s*(\\d{4}))?`,
      'iu'
    );
    const match = normalizedValue.match(rangePattern);

    if (!match) {
      continue;
    }

    const startDay = Number.parseInt(match[1], 10);
    const endDay = Number.parseInt(match[2], 10);
    const explicitYear = match[3] ? Number.parseInt(match[3], 10) : null;
    const targetYear =
      explicitYear ||
      resolveTargetYearsForRange(today, monthNumber, startDay, monthNumber, endDay).startYear;

    if (
      !Number.isInteger(startDay) ||
      !Number.isInteger(endDay) ||
      startDay > endDay ||
      !isValidDateParts(targetYear, monthNumber, startDay) ||
      !isValidDateParts(targetYear, monthNumber, endDay)
    ) {
      return null;
    }

    return buildExplicitDateRange(
      targetYear,
      monthNumber,
      startDay,
      targetYear,
      monthNumber,
      endDay
    );
  }

  return null;
}

function parseDayOfWeek(value, today) {
  const targetDay = extractWeekday(String(value || '').toLowerCase());
  if (targetDay === null) {
    return null;
  }

  const targetDate = new Date(today);
  let daysToAdd = (targetDay - today.getDay() + 7) % 7;
  if (daysToAdd === 0) {
    daysToAdd = 7;
  }

  targetDate.setDate(today.getDate() + daysToAdd);
  targetDate.setHours(0, 0, 0, 0);

  return { parsedDate: targetDate };
}

function parseSpecificDate(value, today) {
  const normalizedValue = String(value || '')
    .toLowerCase()
    .trim();

  for (const [monthName, monthNumber] of Object.entries(MONTH_NAMES)) {
    if (!normalizedValue.includes(monthName)) {
      continue;
    }

    const singleDatePattern = new RegExp(
      `(?:^|\\s)(\\d{1,2})\\s*${monthName}(?:\\s*(\\d{4}))?(?:\\s|$)`,
      'iu'
    );
    const match = normalizedValue.match(singleDatePattern);

    if (!match) {
      continue;
    }

    const day = Number.parseInt(match[1], 10);
    const explicitYear = match[2] ? Number.parseInt(match[2], 10) : null;
    const targetYear = explicitYear || resolveTargetYear(today, monthNumber, day);

    if (!Number.isInteger(day) || !isValidDateParts(targetYear, monthNumber, day)) {
      return null;
    }

    const parsedDate = new Date(targetYear, monthNumber, day);
    parsedDate.setHours(0, 0, 0, 0);
    return { parsedDate };
  }

  return null;
}

function parseMonthPartRange(value, today) {
  const normalizedValue = String(value || '')
    .toLowerCase()
    .trim();
  if (!/(?:начал|середин|конц)/u.test(normalizedValue)) {
    return null;
  }

  let part = null;
  if (normalizedValue.includes('начал')) {
    part = 'start';
  } else if (normalizedValue.includes('середин')) {
    part = 'middle';
  } else if (normalizedValue.includes('конц')) {
    part = 'end';
  }

  if (!part) {
    return null;
  }

  for (const [monthName, monthNumber] of Object.entries(MONTH_NAMES)) {
    if (!normalizedValue.includes(monthName)) {
      continue;
    }

    const { endDate: lastDayDate } = getMonthRange(today.getFullYear(), monthNumber);
    const lastDay = lastDayDate.getDate();

    let startDay = 1;
    let endDay = lastDay;

    if (part === 'start') {
      startDay = 1;
      endDay = Math.min(10, lastDay);
    } else if (part === 'middle') {
      startDay = Math.min(11, lastDay);
      endDay = Math.min(20, lastDay);
    } else if (part === 'end') {
      startDay = Math.min(21, lastDay);
      endDay = lastDay;
    }

    const { startYear } = resolveTargetYearsForRange(
      today,
      monthNumber,
      startDay,
      monthNumber,
      endDay
    );
    return buildExplicitDateRange(startYear, monthNumber, startDay, startYear, monthNumber, endDay);
  }

  return null;
}

/**
 * Парсит только месяц без дня (например, "ноябрь", "декабрь", "в декабре", "в ноябре")
 * Создает диапазон дат с 1 по последний день месяца
 */
function parseMonthOnly(value, today) {
  const normalizedValue = value
    .toLowerCase()
    .trim()
    .replace(/^в\s+/, '')
    .replace(/^на\s+/, '')
    .trim();

  for (const [monthName, monthNumber] of Object.entries(MONTH_NAMES)) {
    const monthPattern = new RegExp(`^${monthName}$|\\b${monthName}\\b`, 'i');
    if (monthPattern.test(normalizedValue)) {
      const hasDayNumber = /\d{1,2}/.test(normalizedValue);
      if (!hasDayNumber) {
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth();

        let targetYear = currentYear;
        if (monthNumber < currentMonth) {
          targetYear = currentYear + 1;
        } else if (monthNumber === currentMonth) {
          targetYear = currentYear;
        }

        const startDate = new Date(targetYear, monthNumber, 1);
        startDate.setHours(0, 0, 0, 0);

        const endDate = new Date(targetYear, monthNumber + 1, 0);
        endDate.setHours(23, 59, 59, 999);

        return {
          dateRange: {
            startDate,
            endDate,
          },
        };
      }
    }
  }

  return null;
}

/**
 * Парсит дату из значения слота
 */
function parseDate(value, slotName) {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const normalizedValue = value.toLowerCase().trim();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  try {
    if (slotName === 'концерт_дата' || slotName.includes('дата')) {
      const qualifiedWeekday = parseQualifiedWeekday(normalizedValue, today);
      if (qualifiedWeekday) {
        return qualifiedWeekday;
      }

      const relativeDate = parseRelativeDateValue(normalizedValue, today);
      if (relativeDate) {
        return relativeDate;
      }

      const crossMonthDateRange = parseCrossMonthDateRange(normalizedValue, today);
      if (crossMonthDateRange) {
        return crossMonthDateRange;
      }

      const explicitDateRange = parseSpecificDateRange(normalizedValue, today);
      if (explicitDateRange) {
        return explicitDateRange;
      }

      const weekdayDate = parseDayOfWeek(normalizedValue, today);
      if (weekdayDate) {
        return weekdayDate;
      }

      const explicitDate = parseSpecificDate(normalizedValue, today);
      if (explicitDate) {
        return explicitDate;
      }

      const monthPart = parseMonthPartRange(normalizedValue, today);
      if (monthPart) {
        return monthPart;
      }

      const monthOnly = parseMonthOnly(normalizedValue, today);
      if (monthOnly) {
        return monthOnly;
      }
    }

    return null;
  } catch (error) {
    console.error('Ошибка парсинга даты:', error);
    return null;
  }
}

/**
 * Обогащает слот информацией о парсированных датах
 * @param {Object} slot - Слот {name, value, confidence}
 * @returns {Object} - Обогащенный слот с полями parsedDate или dateRange
 */
export function enrichSlotWithDate(slot) {
  if (!slot || !slot.name || !slot.value) {
    return slot;
  }

  const dateInfo = parseDate(slot.value, slot.name);

  if (dateInfo) {
    const enrichedSlot = {
      ...slot,
      ...(slot.parsedDate ? {} : dateInfo.parsedDate ? { parsedDate: dateInfo.parsedDate } : {}),
      ...(dateInfo.dateRange ? { dateRange: dateInfo.dateRange } : {}),
      ...(dateInfo.timeRange ? { timeRange: dateInfo.timeRange } : {}),
    };

    const hasNewStructuredDate =
      (!slot.parsedDate && !!enrichedSlot.parsedDate) ||
      (!slot.dateRange && !!enrichedSlot.dateRange) ||
      (!slot.timeRange && !!enrichedSlot.timeRange);

    if (hasNewStructuredDate) {
      console.log(`[ai-planner] Обогащен слот ${slot.name}="${slot.value}":`, dateInfo);
    }

    return enrichedSlot;
  }

  return slot;
}

function plannerNormalizeToDayStart(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  date.setHours(0, 0, 0, 0);
  return date;
}

function plannerNormalizeToDayEnd(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  date.setHours(23, 59, 59, 999);
  return date;
}

function plannerIsSameCalendarDay(left, right) {
  const normalizedLeft = plannerNormalizeToDayStart(left);
  const normalizedRight = plannerNormalizeToDayStart(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  return normalizedLeft.getTime() === normalizedRight.getTime();
}

function formatDateForSyntheticRange(date, { includeYear = false } = {}) {
  const normalized = plannerNormalizeToDayStart(date);
  if (!normalized) {
    return '';
  }

  const monthNames = [
    'января',
    'февраля',
    'марта',
    'апреля',
    'мая',
    'июня',
    'июля',
    'августа',
    'сентября',
    'октября',
    'ноября',
    'декабря',
  ];

  const base = `${normalized.getDate()} ${monthNames[normalized.getMonth()]}`;
  return includeYear ? `${base} ${normalized.getFullYear()}` : base;
}

function formatSyntheticDateRangeValue(startDate, endDate) {
  const start = plannerNormalizeToDayStart(startDate);
  const end = plannerNormalizeToDayEnd(endDate);
  if (!start || !end) {
    return '';
  }

  if (plannerIsSameCalendarDay(start, end)) {
    return formatDateForSyntheticRange(start, { includeYear: false });
  }

  const sameMonth =
    start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth();
  const sameYear = start.getFullYear() === end.getFullYear();

  if (sameMonth) {
    return `с ${start.getDate()} по ${formatDateForSyntheticRange(end, { includeYear: false })}`;
  }

  if (sameYear) {
    return `с ${formatDateForSyntheticRange(start, { includeYear: false })} по ${formatDateForSyntheticRange(end, { includeYear: false })}`;
  }

  return `с ${formatDateForSyntheticRange(start, { includeYear: true })} по ${formatDateForSyntheticRange(end, { includeYear: true })}`;
}

function getStructuredDateBounds(slot, allSlots = null, contextText = '') {
  if (!slot || slot.name !== 'дата_события') {
    return null;
  }

  const enrichedSlot = enrichSlotWithDateConsideringSlots(slot, allSlots || [slot], contextText);
  if (enrichedSlot?.dateRange) {
    const startDate = plannerNormalizeToDayStart(enrichedSlot.dateRange.startDate);
    const endDate = plannerNormalizeToDayEnd(enrichedSlot.dateRange.endDate);
    if (!startDate || !endDate || endDate < startDate) {
      return null;
    }
    return { slot: enrichedSlot, startDate, endDate };
  }

  if (enrichedSlot?.parsedDate) {
    const startDate = plannerNormalizeToDayStart(enrichedSlot.parsedDate);
    const endDate = plannerNormalizeToDayEnd(enrichedSlot.parsedDate);
    if (!startDate || !endDate) {
      return null;
    }
    return { slot: enrichedSlot, startDate, endDate };
  }

  return null;
}

function getContextDateRange(contextText = '') {
  const hint = extractDateHintFromText(contextText);
  if (!hint) {
    return null;
  }

  const bounds = getStructuredDateBounds(
    {
      name: 'дата_события',
      value: hint,
      confidence: 0.88,
      source: 'context_range',
    },
    null,
    contextText
  );

  if (!bounds || plannerIsSameCalendarDay(bounds.startDate, bounds.endDate)) {
    return null;
  }

  return {
    value: hint,
    startDate: bounds.startDate,
    endDate: bounds.endDate,
  };
}

function areDateBoundsInsideRange(bounds, range) {
  if (!bounds || !range) {
    return false;
  }
  return bounds.startDate >= range.startDate && bounds.endDate <= range.endDate;
}

function dedupeDateBoundsEntries(entries = []) {
  const seen = new Set();
  const uniqueEntries = [];

  for (const entry of entries) {
    if (!entry?.startDate || !entry?.endDate) {
      continue;
    }
    const key = `${entry.startDate.getTime()}::${entry.endDate.getTime()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    uniqueEntries.push(entry);
  }

  return uniqueEntries;
}

export function coalesceDateSlotsIntoRange(slots = [], contextText = '') {
  if (!Array.isArray(slots) || slots.length === 0) {
    return slots;
  }

  const rawDateEntries = slots
    .map((slot, index) => {
      if (!slot || slot.isNegative || slot.name !== 'дата_события') {
        return null;
      }

      const bounds = getStructuredDateBounds(slot, slots, contextText);
      return bounds ? { index, ...bounds } : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.startDate - right.startDate);

  const dateEntries = dedupeDateBoundsEntries(rawDateEntries.map((entry) => ({ ...entry })));

  if (dateEntries.length < 2) {
    return slots;
  }

  const contextRange = getContextDateRange(contextText);
  const explicitRangeEntry = dateEntries.find(
    (entry) => !plannerIsSameCalendarDay(entry.startDate, entry.endDate)
  );

  let aggregateStart = dateEntries[0].startDate;
  let aggregateEnd = dateEntries[dateEntries.length - 1].endDate;
  let aggregateValue = '';
  let shouldCoalesce = false;

  if (contextRange && dateEntries.every((entry) => areDateBoundsInsideRange(entry, contextRange))) {
    aggregateStart = contextRange.startDate;
    aggregateEnd = contextRange.endDate;
    aggregateValue = contextRange.value;
    shouldCoalesce = true;
  } else if (
    explicitRangeEntry &&
    dateEntries.every((entry) => areDateBoundsInsideRange(entry, explicitRangeEntry))
  ) {
    aggregateStart = explicitRangeEntry.startDate;
    aggregateEnd = explicitRangeEntry.endDate;
    aggregateValue = String(explicitRangeEntry.slot?.value || '').trim();
    shouldCoalesce = true;
  } else {
    const isContinuousSingleDayRange = dateEntries.every((entry, index) => {
      if (!plannerIsSameCalendarDay(entry.startDate, entry.endDate)) {
        return false;
      }
      if (index === 0) {
        return true;
      }
      const previous = dateEntries[index - 1];
      const diffDays = Math.round(
        (entry.startDate.getTime() - previous.startDate.getTime()) / (24 * 60 * 60 * 1000)
      );
      return diffDays === 1;
    });

    shouldCoalesce = isContinuousSingleDayRange;
  }

  if (!shouldCoalesce) {
    return slots;
  }

  const insertionIndex = Math.min(...rawDateEntries.map((entry) => entry.index));
  const aggregateConfidence = rawDateEntries.reduce((max, entry) => {
    const confidence = Number(entry.slot?.confidence);
    return Number.isFinite(confidence) ? Math.max(max, confidence) : max;
  }, 0);
  const baseSlot = explicitRangeEntry?.slot || rawDateEntries[0].slot || slots[insertionIndex];
  const coalescedSlot = {
    ...baseSlot,
    name: 'дата_события',
    value: aggregateValue || formatSyntheticDateRangeValue(aggregateStart, aggregateEnd),
    confidence: aggregateConfidence || baseSlot?.confidence,
    parsedDate: new Date(aggregateStart),
    dateRange: {
      startDate: new Date(aggregateStart),
      endDate: new Date(aggregateEnd),
    },
  };

  const aggregatedIndexes = new Set(rawDateEntries.map((entry) => entry.index));
  return slots.flatMap((slot, index) => {
    if (!aggregatedIndexes.has(index)) {
      return [slot];
    }
    if (index !== insertionIndex) {
      return [];
    }
    return [coalescedSlot];
  });
}

/**
 * Диапазон одной календарной недели с пн по вс (как в parseThisWeek / parseNextWeek).
 */
function isCalendarWeekMondayThroughSundayRange(startDate, endDate) {
  const start = plannerNormalizeToDayStart(startDate);
  const end = plannerNormalizeToDayStart(endDate);
  if (!start || !end || end < start) {
    return false;
  }
  if (start.getDay() !== 1) {
    return false;
  }
  if (end.getDay() !== 0) {
    return false;
  }
  const diffDays = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  return diffDays === 6;
}

function hasWeekendDayOfWeekSlot(allSlots) {
  if (!Array.isArray(allSlots)) {
    return false;
  }
  const daySlot = allSlots.find((s) => s && s.name === 'день_недели');
  const v = String(daySlot?.value || '').toLowerCase();
  return /выходн|уикенд/u.test(v);
}

function hasWeekendSignal(allSlots, dateSlot) {
  const dateValue = String(dateSlot?.value || '').toLowerCase();
  if (/выходн|уикенд/u.test(dateValue)) {
    return true;
  }

  if (!Array.isArray(allSlots)) {
    return false;
  }

  return allSlots.some((slot) => {
    const v = String(slot?.value || '').toLowerCase();
    return /выходн|уикенд/u.test(v);
  });
}

function hasNextWeekSignal(allSlots) {
  if (!Array.isArray(allSlots)) {
    return false;
  }

  return allSlots.some((slot) => {
    const v = String(slot?.value || '').toLowerCase();
    return (
      v.includes('следующей неделе') ||
      v.includes('на следующей неделе') ||
      v.includes('следующая неделя') ||
      v.includes('следующую неделю') ||
      v.includes('следующей нед') ||
      v.includes('следующую нед') ||
      v.includes('будущей неделе') ||
      v.includes('на будущей неделе') ||
      v.includes('будущая неделя') ||
      v.includes('будущую неделю')
    );
  });
}

function normalizeContextText(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }
  return text.toLowerCase().replace(/ё/g, 'е');
}

function hasWeekendSignalInText(text) {
  const t = normalizeContextText(text);
  return t.length > 0 && /выходн|уикенд/u.test(t);
}

function hasNextWeekSignalInText(text) {
  const v = normalizeContextText(text);
  if (!v) {
    return false;
  }
  return (
    v.includes('следующей неделе') ||
    v.includes('на следующей неделе') ||
    v.includes('следующая неделя') ||
    v.includes('следующую неделю') ||
    v.includes('следующей нед') ||
    v.includes('следующую нед') ||
    v.includes('будущей неделе') ||
    v.includes('на будущей неделе') ||
    v.includes('будущая неделя') ||
    v.includes('будущую неделю')
  );
}

function isSaturdaySundayRange(startDate, endDate) {
  const start = plannerNormalizeToDayStart(startDate);
  const end = plannerNormalizeToDayStart(endDate);
  if (!start || !end || end < start) {
    return false;
  }

  const diffDays = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  return start.getDay() === 6 && end.getDay() === 0 && diffDays === 1;
}

/**
 * Если в запросе отдельно указаны «выходные» (день_недели) и календарная неделя (дата_события),
 * сужаем dateRange до сб–вс внутри этой недели (например «на следующей неделе» + «в выходные»).
 * contextText — исходный текст пользователя: ai-slots иногда оставляет только «следующая неделя»,
 * а «в выходные» остаётся только в сообщении.
 */
export function narrowEnrichedDateSlotToWeekendInCalendarWeek(
  enrichedDateSlot,
  allSlots,
  contextText = null
) {
  if (!enrichedDateSlot || enrichedDateSlot.name !== 'дата_события') {
    return enrichedDateSlot;
  }
  if (enrichedDateSlot.parsedDate && !enrichedDateSlot.dateRange) {
    return enrichedDateSlot;
  }
  if (!enrichedDateSlot.dateRange) {
    return enrichedDateSlot;
  }

  const startRaw =
    enrichedDateSlot.dateRange.startDate instanceof Date
      ? enrichedDateSlot.dateRange.startDate
      : new Date(enrichedDateSlot.dateRange.startDate);
  const endRaw =
    enrichedDateSlot.dateRange.endDate instanceof Date
      ? enrichedDateSlot.dateRange.endDate
      : new Date(enrichedDateSlot.dateRange.endDate);

  const weekendRequested =
    hasWeekendDayOfWeekSlot(allSlots) ||
    hasWeekendSignal(allSlots, enrichedDateSlot) ||
    hasWeekendSignalInText(contextText);
  if (!weekendRequested) {
    return enrichedDateSlot;
  }

  if (
    (hasNextWeekSignal(allSlots) || hasNextWeekSignalInText(contextText)) &&
    isSaturdaySundayRange(startRaw, endRaw)
  ) {
    const saturday = plannerNormalizeToDayStart(startRaw);
    if (!saturday) {
      return enrichedDateSlot;
    }
    saturday.setDate(saturday.getDate() + 7);
    const sunday = new Date(saturday);
    sunday.setDate(saturday.getDate() + 1);
    sunday.setHours(23, 59, 59, 999);
    return {
      ...enrichedDateSlot,
      dateRange: {
        startDate: saturday,
        endDate: sunday,
      },
    };
  }

  if (!isCalendarWeekMondayThroughSundayRange(startRaw, endRaw)) {
    return enrichedDateSlot;
  }

  const monday = plannerNormalizeToDayStart(startRaw);
  if (!monday) {
    return enrichedDateSlot;
  }

  const saturday = new Date(monday);
  saturday.setDate(monday.getDate() + 5);
  saturday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return {
    ...enrichedDateSlot,
    dateRange: {
      startDate: saturday,
      endDate: sunday,
    },
  };
}

export function enrichSlotWithDateConsideringSlots(slot, allSlots = null, contextText = null) {
  const enriched = enrichSlotWithDate(slot);
  const slotsArray = Array.isArray(allSlots) ? allSlots : [];
  const hasText = typeof contextText === 'string' && contextText.trim().length > 0;
  if (slotsArray.length === 0 && !hasText) {
    return enriched;
  }
  return narrowEnrichedDateSlotToWeekendInCalendarWeek(enriched, slotsArray, contextText);
}

/**
 * Если ai-slots не выдал дату, но в тексте есть явный временной якорь (выходные и т.д.),
 * подставляем эфемерный слот дата_события — иначе поиск идёт без date_from/date_to.
 */
function extractImplicitDatePhraseFromUserMessage(userMessage) {
  const v = normalizeContextText(userMessage);
  if (!v) {
    return null;
  }
  if (/следующ(?:ие|их|им)\s+выходн/u.test(v)) {
    return 'следующие выходные';
  }
  if (/(?:^|[\s,.:;!?()«»"'-])(?:этих|эти)\s+выходн/u.test(v)) {
    return 'в выходные';
  }
  if (/ближайш(?:ие|их)\s+выходн/u.test(v)) {
    return 'в выходные';
  }
  if (/(?:^|\s)в\s+выходн/u.test(v) && !/следующ/u.test(v)) {
    return 'в выходные';
  }
  return null;
}

export function mergeSlotsWithImplicitDateFromUserMessage(slots, userMessage) {
  const safeSlots = Array.isArray(slots) ? [...slots] : [];
  if (safeSlots.some((s) => s && s.name === 'дата_события')) {
    return safeSlots;
  }
  const phrase = extractImplicitDatePhraseFromUserMessage(userMessage);
  if (!phrase) {
    return safeSlots;
  }
  safeSlots.push({
    name: 'дата_события',
    value: phrase,
    confidence: 0.82,
    source: 'inferred_from_user_message',
  });
  return safeSlots;
}

/**
 * Одно слово — якорь календаря (день недели, выходные, «неделю»), не текстовый поиск по афише.
 * Для таких сигналов используется слот дата_события / date_from–date_to, keyword Kassir не нужен.
 */
const CALENDAR_SCHEDULING_NOISE_TOKEN_RES = [
  /^(?:по)?недельник/u,
  /^вторник/u,
  /^сред[ауеыоюя]$/u,
  /^четверг/u,
  /^пятниц/u,
  /^суббот/u,
  /^воскресень/u,
  /^выходн/u,
  /^недел[юеиья]$/u,
];

const CALENDAR_SCHEDULING_NOISE_PHRASE_RES = [
  /^ближайш(?:ие|их)?\s+выходн/u,
  /^следующ(?:ие|их)?\s+выходн/u,
];

export function isCalendarSchedulingSearchNoiseToken(rawToken) {
  const t = String(rawToken || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^а-яё0-9-]/gu, '')
    .trim();
  if (!t || t.length < 3) {
    return false;
  }
  return CALENDAR_SCHEDULING_NOISE_TOKEN_RES.some((re) => re.test(t));
}

/**
 * Строка целиком — только календарные формулировки (после нормализации пробелов).
 */
export function isCalendarSchedulingOnlySearchString(text) {
  const compact = String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[.,!?;:()[\]{}"'`«»]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!compact) {
    return false;
  }
  if (CALENDAR_SCHEDULING_NOISE_PHRASE_RES.some((re) => re.test(compact))) {
    return true;
  }
  const tokens = compact.split(' ').filter(Boolean);
  if (tokens.length === 0) {
    return false;
  }
  return tokens.every((token) => isCalendarSchedulingSearchNoiseToken(token));
}

export function applyDateSlotDayOfWeekRefinement(slots, options = null) {
  if (!Array.isArray(slots) || slots.length === 0) {
    return slots;
  }
  const userMessage = options && typeof options.userMessage === 'string' ? options.userMessage : '';
  const idx = slots.findIndex((s) => s && s.name === 'дата_события');
  if (idx < 0) {
    return slots;
  }
  const refined = enrichSlotWithDateConsideringSlots(slots[idx], slots, userMessage);
  if (refined === slots[idx]) {
    return slots;
  }
  const next = slots.slice();
  next[idx] = refined;
  return next;
}
