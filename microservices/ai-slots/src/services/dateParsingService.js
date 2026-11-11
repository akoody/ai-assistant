/**
 * Сервис для преобразования относительных дат в реальные даты
 */

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

/**
 * Парсит относительную дату в реальную дату или диапазон дат
 * @param {string} value - Текст со слотом даты/времени
 * @param {string} slotName - Название слота (например, "концерт_дата", "концерт_время")
 * @returns {Object|null} - { parsedDate: Date, dateRange: {startDate: Date, endDate: Date} } или null
 */
export function parseDate(value, slotName) {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const normalizedValue = value.toLowerCase().replace(/ё/g, 'е').trim();
  const now = new Date();

  // Определяем базовую дату (сегодня)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Для времени определяем текущее время

  try {
    // === ОБРАБОТКА ДАТ ===
    if (slotName === 'концерт_дата' || slotName.includes('дата')) {
      return parseDateValue(normalizedValue, today);
    }

    // === ОБРАБОТКА ВРЕМЕНИ ===
    if (slotName === 'концерт_время' || slotName.includes('время')) {
      return parseTimeValue(normalizedValue, now, today);
    }

    // === КОМБИНИРОВАННАЯ ОБРАБОТКА (дата + время в одном слоте) ===
    // Если слот содержит и дату, и время
    if (
      normalizedValue.includes('завтра') ||
      normalizedValue.includes('послезавтра') ||
      normalizedValue.includes('сегодня') ||
      normalizedValue.includes('вчера')
    ) {
      return parseDateTimeCombined(normalizedValue, today);
    }

    return null;
  } catch (error) {
    console.error('Ошибка парсинга даты:', error);
    return null;
  }
}

/**
 * Парсит значение даты
 */
function parseDateValue(value, today) {
  const relativeMonthReference = parseRelativeMonthReference(value, today);
  if (relativeMonthReference) {
    return relativeMonthReference;
  }

  const relativeDuration = parseRelativeDuration(value, today);
  if (relativeDuration) {
    return relativeDuration;
  }

  // Сегодня
  if (value === 'сегодня' || value.includes('сегодня')) {
    return { parsedDate: new Date(today) };
  }

  // Послезавтра
  if (value === 'послезавтра' || value.includes('послезавтра')) {
    const dayAfterTomorrow = new Date(today);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
    return { parsedDate: dayAfterTomorrow };
  }

  // Завтра
  if (value === 'завтра' || value.includes('завтра')) {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return { parsedDate: tomorrow };
  }

  // Вчера
  if (value === 'вчера' || value.includes('вчера')) {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return { parsedDate: yesterday };
  }

  const qualifiedWeekday = parseQualifiedWeekday(value, today);
  if (qualifiedWeekday) {
    return qualifiedWeekday;
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

  if (hasWeekend && hasNextWeek) {
    return parseNextWeekend(today);
  }

  if (hasWeekend && /следующ(?:ие|их|им)\s+выходн/u.test(value) && !value.includes('недел')) {
    return parseWeekend(today);
  }

  // На выходных
  if (value.includes('выходн') || value.includes('выходные')) {
    return parseWeekend(today);
  }

  // На этой неделе
  if (
    value.includes('этой неделе') ||
    value.includes('на этой неделе') ||
    value.includes('эта неделя') ||
    value.includes('эту неделю')
  ) {
    return parseThisWeek(today);
  }

  // На следующей неделе
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

  const crossMonthDateRange = parseCrossMonthDateRange(value, today);
  if (crossMonthDateRange) {
    return crossMonthDateRange;
  }

  const explicitDateRange = parseSpecificDateRange(value, today);
  if (explicitDateRange) {
    return explicitDateRange;
  }

  // День недели (понедельник, вторник и т.д.)
  const dayOfWeek = parseDayOfWeek(value, today);
  if (dayOfWeek !== null) {
    return dayOfWeek;
  }

  // Конкретная дата в формате "1 января", "15 марта" и т.д.
  const specificDate = parseSpecificDate(value, today);
  if (specificDate) {
    return specificDate;
  }

  const monthPart = parseMonthPartRange(value, today);
  if (monthPart) {
    return monthPart;
  }

  // Только месяц без дня (например, "ноябрь", "декабрь")
  const monthOnly = parseMonthOnly(value, today);
  if (monthOnly) {
    return monthOnly;
  }

  return null;
}

function getStartOfWeek(date) {
  const base = new Date(date);
  const dayOfWeek = base.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  base.setDate(base.getDate() + mondayOffset);
  base.setHours(0, 0, 0, 0);
  return base;
}

function buildMonthRange(year, monthNumber) {
  const startDate = new Date(year, monthNumber, 1);
  startDate.setHours(0, 0, 0, 0);

  const endDate = new Date(year, monthNumber + 1, 0);
  endDate.setHours(23, 59, 59, 999);

  return { dateRange: { startDate, endDate } };
}

function parseRelativeMonthReference(value, today) {
  const normalized = String(value || '')
    .toLowerCase()
    .trim();
  if (!normalized) {
    return null;
  }

  if (
    /(?:^|[\s,.:;!?()"«»-])(?:(?:в|на)\s+)?(?:следующ(?:ем|ий)|будущ(?:ем|ий))\s+месяц(?:е)?(?=$|[\s,.:;!?()"«»-])/u.test(
      normalized
    )
  ) {
    return buildMonthRange(today.getFullYear(), today.getMonth() + 1);
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
    if (/(?:^|[\s,.:;!?()"«»-])(?:через|спустя)\s+неделю(?=$|[\s,.:;!?()"«»-])/u.test(normalized)) {
      const startDate = getStartOfWeek(today);
      startDate.setDate(startDate.getDate() + 7);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 6);
      endDate.setHours(23, 59, 59, 999);
      return { dateRange: { startDate, endDate } };
    }

    if (/(?:^|[\s,.:;!?()"«»-])(?:через|спустя)\s+месяц(?=$|[\s,.:;!?()"«»-])/u.test(normalized)) {
      return buildMonthRange(today.getFullYear(), today.getMonth() + 1);
    }

    if (/(?:^|[\s,.:;!?()"«»-])(?:через|спустя)\s+год(?=$|[\s,.:;!?()"«»-])/u.test(normalized)) {
      const startDate = new Date(today.getFullYear() + 1, 0, 1);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(today.getFullYear() + 1, 11, 31);
      endDate.setHours(23, 59, 59, 999);
      return { dateRange: { startDate, endDate } };
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
    const startDate = getStartOfWeek(today);
    startDate.setDate(startDate.getDate() + amount * 7);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 6);
    endDate.setHours(23, 59, 59, 999);
    return { dateRange: { startDate, endDate } };
  }

  if (/месяц/u.test(unit)) {
    const targetMonthDate = new Date(today.getFullYear(), today.getMonth() + amount, 1);
    targetMonthDate.setHours(0, 0, 0, 0);
    const startDate = new Date(targetMonthDate);
    const endDate = new Date(targetMonthDate.getFullYear(), targetMonthDate.getMonth() + 1, 0);
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

function resolveTargetYear(today, monthNumber, day) {
  const currentYear = today.getFullYear();
  const candidate = new Date(currentYear, monthNumber, day);
  candidate.setHours(0, 0, 0, 0);
  return candidate < today ? currentYear + 1 : currentYear;
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

    if (!Number.isInteger(startDay) || !Number.isInteger(endDay) || startDay > endDay) {
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

/**
 * Парсит значение времени
 */
function parseTimeValue(value, now, today) {
  // Утро
  if (value.includes('утро') || value.includes('утром')) {
    return {
      timeRange: {
        startHour: 6,
        startMinute: 0,
        endHour: 11,
        endMinute: 59,
      },
    };
  }

  // День
  if (
    value.includes('днем') ||
    value.includes('дневное время') ||
    value.includes('дневной сеанс') ||
    value === 'день'
  ) {
    return {
      timeRange: {
        startHour: 12,
        startMinute: 0,
        endHour: 16,
        endMinute: 59,
      },
    };
  }

  // Вечер
  if (value.includes('вечер') || value.includes('вечером')) {
    return {
      timeRange: {
        startHour: 17,
        startMinute: 0,
        endHour: 21,
        endMinute: 59,
      },
    };
  }

  // Ночь
  if (value.includes('ночь') || value.includes('ночью')) {
    return {
      timeRange: {
        startHour: 22,
        startMinute: 0,
        endHour: 23,
        endMinute: 59,
      },
    };
  }

  // После конкретного времени (например, "после 17:00", "после 17", "после 18 00", "после 5 вечера")
  // Ищем паттерн "после" за которым следует время в формате HH:MM, HH MM или просто число
  // Учитываем, что может быть "после работы, после 17:00" - берем последнее упоминание с конкретным временем
  // ВАЖНО: Проверяем конкретное время ПЕРЕД "после работы", чтобы приоритет был у конкретного времени
  // Поддерживаем форматы: "после 18:00", "после 18 00", "после 18"
  // Регулярное выражение ищет "после" за которым следует число (часы), затем опционально пробел или двоеточие и минуты
  // Паттерн: "после" + пробел + число (часы) + (пробел ИЛИ двоеточие) + опционально число (минуты)
  const afterTimeMatches = Array.from(value.matchAll(/после\s+(\d{1,2})(?:\s+|:)(\d{2})?/g));
  if (afterTimeMatches.length > 0) {
    // Фильтруем совпадения, оставляя только те, где есть конкретное время (не просто "после работы")
    // Берем последнее совпадение с конкретным временем (самое конкретное)
    const validMatches = afterTimeMatches.filter((match) => {
      const hours = parseInt(match[1], 10);
      return hours >= 0 && hours < 24; // Проверяем, что это валидные часы
    });

    if (validMatches.length > 0) {
      const afterTimeMatch = validMatches[validMatches.length - 1];
      const hours = parseInt(afterTimeMatch[1], 10);
      // Если есть минуты в совпадении, используем их, иначе 0
      const minutes = afterTimeMatch[2] ? parseInt(afterTimeMatch[2], 10) : 0;
      if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
        // ВАЖНО: Храним время как простые числа (часы и минуты), а не как Date объекты
        // Это позволяет избежать проблем с часовыми поясами при сохранении в БД
        // Date объекты конвертируются в UTC при сохранении, что сдвигает время
        console.log(
          `[parseTimeValue] Найдено "после ${hours}:${String(minutes).padStart(2, '0')}" - создан timeRange: ${hours}:${String(minutes).padStart(2, '0')} - 23:59`
        );
        return {
          timeRange: {
            startHour: hours,
            startMinute: minutes,
            endHour: 23,
            endMinute: 59,
          },
        };
      }
    }
  }

  // После работы (только если не найдено конкретное время)
  if (value.includes('после работы')) {
    const afterWork = new Date(today);
    afterWork.setHours(19, 0, 0, 0);
    return { parsedDate: afterWork };
  }

  // До конкретного времени (например, "до 17:00", "до 17")
  const beforeTimeMatch = value.match(/до\s+(\d{1,2})(?::(\d{2}))?/);
  if (beforeTimeMatch) {
    const hours = parseInt(beforeTimeMatch[1], 10);
    const minutes = parseInt(beforeTimeMatch[2] || '0', 10);
    if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
      // ВАЖНО: Храним время как простые числа (часы и минуты), а не как Date объекты
      console.log(
        `[parseTimeValue] Найдено "до ${hours}:${String(minutes).padStart(2, '0')}" - создан timeRange: 00:00 - ${hours}:${String(minutes).padStart(2, '0')}`
      );
      return {
        timeRange: {
          startHour: 0,
          startMinute: 0,
          endHour: hours,
          endMinute: minutes,
        },
      };
    }
  }

  // Время в формате HH:MM
  const timeMatch = value.match(/(\d{1,2}):(\d{2})/);
  if (timeMatch) {
    const hours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2], 10);
    if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
      const specificTime = new Date(today);
      specificTime.setHours(hours, minutes, 0, 0);
      return { parsedDate: specificTime };
    }
  }

  return null;
}

/**
 * Парсит комбинацию даты и времени
 */
function parseDateTimeCombined(value, today) {
  let date = new Date(today);
  let time = { hours: 20, minutes: 0 }; // По умолчанию вечер

  // Определяем дату
  if (value.includes('послезавтра')) {
    date.setDate(date.getDate() + 2);
  } else if (value.includes('завтра')) {
    date.setDate(date.getDate() + 1);
  } else if (value.includes('вчера')) {
    date.setDate(date.getDate() - 1);
  }

  // Определяем время
  if (value.includes('утро') || value.includes('утром')) {
    time = { hours: 9, minutes: 0 };
  } else if (
    value.includes('днем') ||
    value.includes('дневное время') ||
    value.includes('дневной сеанс') ||
    value === 'день'
  ) {
    time = { hours: 14, minutes: 0 };
  } else if (value.includes('вечер') || value.includes('вечером')) {
    time = { hours: 20, minutes: 0 };
  } else if (value.includes('ночь') || value.includes('ночью')) {
    time = { hours: 23, minutes: 0 };
  }

  // Проверяем конкретное время
  const timeMatch = value.match(/(\d{1,2}):(\d{2})/);
  if (timeMatch) {
    time.hours = parseInt(timeMatch[1], 10);
    time.minutes = parseInt(timeMatch[2], 10);
  }

  date.setHours(time.hours, time.minutes, 0, 0);
  return { parsedDate: date };
}

/**
 * Парсит выходные
 */
function parseWeekend(today) {
  const dayOfWeek = today.getDay(); // 0 = воскресенье, 6 = суббота
  const saturday = new Date(today);

  // Вычисляем ближайшую субботу
  const daysUntilSaturday = (6 - dayOfWeek + 7) % 7 || 7;
  saturday.setDate(today.getDate() + daysUntilSaturday);
  saturday.setHours(0, 0, 0, 0);

  // Воскресенье на следующий день после субботы
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

function parseNextWeekend(today) {
  const weekend = parseWeekend(today);
  if (!weekend?.dateRange?.startDate || !weekend?.dateRange?.endDate) {
    return weekend;
  }

  const saturday = new Date(weekend.dateRange.startDate);
  const sunday = new Date(weekend.dateRange.endDate);
  saturday.setDate(saturday.getDate() + 7);
  sunday.setDate(sunday.getDate() + 7);

  return {
    dateRange: {
      startDate: saturday,
      endDate: sunday,
    },
  };
}

/**
 * Парсит эту неделю
 */
function parseThisWeek(today) {
  const dayOfWeek = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1)); // Первый день недели (понедельник)
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

/**
 * Парсит следующую неделю
 */
function parseNextWeek(today) {
  const dayOfWeek = today.getDay();
  const nextMonday = new Date(today);
  nextMonday.setDate(today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1) + 7);
  nextMonday.setHours(0, 0, 0, 0);

  const nextSunday = new Date(nextMonday);
  nextSunday.setDate(nextMonday.getDate() + 6);
  nextSunday.setHours(23, 59, 59, 999);

  return {
    dateRange: {
      startDate: nextMonday,
      endDate: nextSunday,
    },
  };
}

/**
 * Парсит день недели
 */
function parseDayOfWeek(value, today) {
  const targetDay = extractWeekday(String(value || '').toLowerCase());
  if (targetDay !== null) {
    const currentDay = today.getDay();
    let daysToAdd = (targetDay - currentDay + 7) % 7;
    if (daysToAdd === 0) {
      daysToAdd = 7;
    }

    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + daysToAdd);
    targetDate.setHours(0, 0, 0, 0);

    return { parsedDate: targetDate };
  }

  return null;
}

/**
 * Парсит конкретную дату (например, "1 января", "15 марта")
 */
function parseSpecificDate(value, today) {
  for (const [monthName, monthNumber] of Object.entries(MONTH_NAMES)) {
    if (value.includes(monthName)) {
      const dayMatch = value.match(/(\d{1,2})\s*/);
      if (dayMatch) {
        const day = parseInt(dayMatch[1], 10);
        const targetYear = resolveTargetYear(today, monthNumber, day);
        if (day >= 1 && day <= 31 && isValidDateParts(targetYear, monthNumber, day)) {
          const date = new Date(targetYear, monthNumber, day);
          date.setHours(0, 0, 0, 0);
          return { parsedDate: date };
        }
      }
    }
  }

  return null;
}

/**
 * Парсит только месяц без дня (например, "ноябрь", "декабрь", "в декабре", "в ноябре")
 * Создает диапазон дат с 1 по последний день месяца
 */
function parseMonthOnly(value, today) {
  // Нормализуем значение: убираем предлоги "в", "на" и лишние пробелы
  const normalizedValue = value
    .toLowerCase()
    .trim()
    .replace(/^в\s+/, '') // Убираем "в " в начале
    .replace(/^на\s+/, '') // Убираем "на " в начале
    .trim();

  for (const [monthName, monthNumber] of Object.entries(MONTH_NAMES)) {
    // Проверяем точное совпадение или что месяц упоминается без цифр перед ним
    // Учитываем, что месяц может быть с предлогом или без
    const monthPattern = new RegExp(`^${monthName}$|\\b${monthName}\\b`, 'i');
    if (monthPattern.test(normalizedValue)) {
      // Проверяем, что нет цифр дня в значении
      const hasDayNumber = /\d{1,2}/.test(normalizedValue);
      if (!hasDayNumber) {
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth();

        // Определяем год: если запрошенный месяц уже прошел в этом году, берем следующий год
        let targetYear = currentYear;
        if (monthNumber < currentMonth) {
          // Месяц уже прошел в этом году, берем следующий год
          targetYear = currentYear + 1;
        } else if (monthNumber === currentMonth) {
          // Текущий месяц - можно оставить текущий год или следующий, в зависимости от дня
          // Но для простоты, если это текущий месяц и он уже начался, оставляем текущий год
          targetYear = currentYear;
        }
        // Если monthNumber > currentMonth, то это будущий месяц в текущем году - оставляем currentYear

        // Создаем начало месяца (1 число)
        const startDate = new Date(targetYear, monthNumber, 1);
        // Устанавливаем время на начало дня (00:00:00) в локальном времени
        startDate.setHours(0, 0, 0, 0);

        // Создаем конец месяца (последний день месяца)
        const endDate = new Date(targetYear, monthNumber + 1, 0); // 0 день следующего месяца = последний день текущего
        // Устанавливаем время на конец дня (23:59:59) в локальном времени
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
    console.log(`Обогащен слот ${slot.name}="${slot.value}":`, dateInfo);
    return {
      ...slot,
      ...dateInfo,
    };
  }

  return slot;
}
