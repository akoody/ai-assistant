import { enrichSlotWithDate, enrichSlotWithDateConsideringSlots } from '../dateParsingUtils.js';

function parseEventDates(event) {
  if (!event) return null;

  let startDate = null;
  let endDate = null;

  // Сначала пробуем rawDate (ISO строка) для даты начала
  if (event.rawDate) {
    const parsed = new Date(event.rawDate);
    if (!Number.isNaN(parsed.getTime())) {
      startDate = parsed;
    }
  }

  // Пробуем rawEndDate для даты окончания
  if (event.rawEndDate) {
    const parsed = new Date(event.rawEndDate);
    if (!Number.isNaN(parsed.getTime())) {
      endDate = parsed;
    }
  }

  // Если не удалось получить из rawDate, пробуем парсить из отформатированной строки date
  if (!startDate && event.date) {
    // Формат: "16 ноября 2025"
    const months = {
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
    };

    const match = event.date.match(/(\d+)\s+(\w+)\s+(\d+)/);
    if (match) {
      const day = parseInt(match[1], 10);
      const monthName = match[2].toLowerCase();
      const year = parseInt(match[3], 10);
      const month = months[monthName];

      if (month !== undefined) {
        startDate = new Date(year, month, day);
      }
    }
  }

  if (!startDate) {
    return null;
  }

  return { startDate, endDate };
}

function scoreDateMatch(eventDates, dateSlot, allSlots = null, dateContextText = '') {
  if (!eventDates || !eventDates.startDate || !dateSlot) return 0;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const eventStart = eventDates.startDate;
  const eventEnd = eventDates.endDate;

  // Нормализуем даты события (только день, без времени)
  const eventStartOnly = new Date(
    eventStart.getFullYear(),
    eventStart.getMonth(),
    eventStart.getDate()
  );
  const eventEndOnly = eventEnd
    ? new Date(eventEnd.getFullYear(), eventEnd.getMonth(), eventEnd.getDate())
    : null;

  const effectiveEventEndOnly = eventEndOnly || eventStartOnly;

  // Проверяем, началось ли событие и еще идет
  const hasStarted = eventStartOnly <= today;
  const isStillOngoing = effectiveEventEndOnly >= today;
  const isCurrentlyOngoing = hasStarted && isStillOngoing;

  let targetStart = null;
  let targetEnd = null;

  const slotsList = Array.isArray(allSlots) ? allSlots : [];
  const hasContext = typeof dateContextText === 'string' && dateContextText.trim().length > 0;
  const normalizedDateSlot =
    slotsList.length > 0 || hasContext
      ? enrichSlotWithDateConsideringSlots(dateSlot, slotsList, dateContextText)
      : enrichSlotWithDate(dateSlot);

  // Определяем целевой диапазон дат
  if (normalizedDateSlot.dateRange) {
    targetStart =
      normalizedDateSlot.dateRange.startDate instanceof Date
        ? normalizedDateSlot.dateRange.startDate
        : new Date(normalizedDateSlot.dateRange.startDate);
    targetEnd =
      normalizedDateSlot.dateRange.endDate instanceof Date
        ? normalizedDateSlot.dateRange.endDate
        : new Date(normalizedDateSlot.dateRange.endDate);
    // Добавляем день к endDate, чтобы включить весь последний день
    targetEnd = new Date(targetEnd);
    targetEnd.setDate(targetEnd.getDate() + 1);
  } else if (normalizedDateSlot.parsedDate) {
    const targetDate =
      normalizedDateSlot.parsedDate instanceof Date
        ? normalizedDateSlot.parsedDate
        : new Date(normalizedDateSlot.parsedDate);
    targetStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
    targetEnd = new Date(targetStart);
    targetEnd.setDate(targetEnd.getDate() + 1); // До конца дня
  } else {
    return 0;
  }

  // Если событие уже началось и еще идет, и запрошенная дата включает сегодня или будущее
  if (isCurrentlyOngoing && targetStart <= today) {
    // Событие идет прямо сейчас - это очень релевантно!
    // Проверяем, попадает ли период события в запрошенный диапазон
    if (effectiveEventEndOnly < targetEnd) {
      // Событие еще идет и попадает в запрошенный диапазон - максимальный балл
      return 35; // Даже больше, чем обычное событие в диапазоне
    }
  }

  // Проверяем, попадает ли дата начала события в диапазон
  if (eventStartOnly >= targetStart && eventStartOnly < targetEnd) {
    // Событие в диапазоне - максимальный балл
    const daysDiff = Math.floor((eventStartOnly - targetStart) / (1000 * 60 * 60 * 24));
    // Ближайшие события получают больше баллов
    return Math.max(30 - daysDiff * 2, 20);
  }

  // Проверяем, если событие уже началось, но еще идет, и запрошенная дата в будущем
  if (isCurrentlyOngoing && targetStart > today) {
    // Событие идет сейчас, но пользователь ищет в будущем
    // Это менее релевантно, но все равно лучше, чем событие в прошлом
    const daysUntilTarget = Math.floor((targetStart - today) / (1000 * 60 * 60 * 24));
    if (daysUntilTarget <= 7) {
      // Если целевая дата близко, событие все еще может быть релевантным
      return 15;
    }
    // Если целевая дата далеко, небольшой штраф
    return -10;
  }

  // Событие вне диапазона - штраф
  const daysBefore = Math.floor((targetStart - eventStartOnly) / (1000 * 60 * 60 * 24));
  const daysAfter = Math.floor((eventStartOnly - targetEnd) / (1000 * 60 * 60 * 24));

  if (daysBefore > 0) {
    // Событие раньше запрошенной даты
    if (isCurrentlyOngoing) {
      // Событие идет сейчас, но началось раньше запрошенной даты
      // Это может быть релевантно, если событие еще продолжается
      if (effectiveEventEndOnly >= targetStart) {
        // Событие еще идет и захватывает запрошенную дату - это хорошо!
        return 25;
      }
      // Событие идет, но закончится до запрошенной даты
      return -20;
    }
    // Событие в прошлом и уже закончилось - очень большой штраф
    return -100 - daysBefore * 10;
  }

  if (daysAfter > 0) {
    // Событие позже запрошенной даты - большой штраф
    // Особенно важно для запросов типа "до 20 ноября" - события после должны быть внизу
    return -80 - daysAfter * 5;
  }

  return 0;
}

function scoreDateProximity(eventDates) {
  if (!eventDates || !eventDates.startDate) return 0;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const eventStart = eventDates.startDate;
  const eventEnd = eventDates.endDate;

  // Нормализуем даты события (только день, без времени)
  const eventStartOnly = new Date(
    eventStart.getFullYear(),
    eventStart.getMonth(),
    eventStart.getDate()
  );
  const eventEndOnly = eventEnd
    ? new Date(eventEnd.getFullYear(), eventEnd.getMonth(), eventEnd.getDate())
    : null;

  const effectiveEventEndOnly = eventEndOnly || eventStartOnly;

  // Проверяем, началось ли событие и еще идет
  const hasStarted = eventStartOnly <= today;
  const isStillOngoing = effectiveEventEndOnly >= today;
  const isCurrentlyOngoing = hasStarted && isStillOngoing;

  // Если событие идет прямо сейчас - максимальный балл
  if (isCurrentlyOngoing) {
    const msPerDay = 1000 * 60 * 60 * 24;
    const daysSinceStart = Math.max(0, Math.floor((today - eventStartOnly) / msPerDay));
    const daysUntilEnd = Math.max(0, Math.floor((effectiveEventEndOnly - today) / msPerDay));
    const durationDays = Math.max(
      0,
      Math.floor((effectiveEventEndOnly - eventStartOnly) / msPerDay)
    );

    let ongoingScore;
    if (durationDays > 365) {
      ongoingScore = daysSinceStart <= 45 ? 16 : 12;
    } else if (daysSinceStart <= 7) {
      ongoingScore = 24;
    } else if (daysSinceStart <= 45) {
      ongoingScore = 21;
    } else if (daysSinceStart <= 120) {
      ongoingScore = 18;
    } else {
      ongoingScore = 15;
    }

    // Если активность скоро заканчивается, слегка снижаем приоритет.
    if (daysUntilEnd <= 3) {
      ongoingScore = Math.max(14, ongoingScore - 2);
    }

    return ongoingScore;
  }

  // Событие в будущем - чем ближе, тем выше балл
  if (eventStartOnly > today) {
    const daysUntil = Math.floor((eventStartOnly - today) / (1000 * 60 * 60 * 24));

    // Ближайшие события (сегодня-завтра) - максимальный балл
    if (daysUntil === 0) {
      return 25;
    } else if (daysUntil === 1) {
      return 24;
    } else if (daysUntil <= 3) {
      // В течение 3 дней - высокий балл
      return 23 - daysUntil;
    } else if (daysUntil <= 7) {
      // В течение недели - хороший балл
      return 20 - (daysUntil - 3) * 2;
    } else if (daysUntil <= 14) {
      // В течение 2 недель - средний балл
      return 15 - (daysUntil - 7);
    } else if (daysUntil <= 30) {
      // В течение месяца - низкий балл
      return 10 - Math.floor((daysUntil - 14) / 2);
    } else {
      // Далеко в будущем - очень низкий балл
      return Math.max(0, 5 - Math.floor((daysUntil - 30) / 7));
    }
  }

  // Событие в прошлом и уже закончилось - штраф
  if (!isStillOngoing) {
    const daysAgo = Math.floor((today - effectiveEventEndOnly) / (1000 * 60 * 60 * 24));
    return -50 - daysAgo * 5;
  }

  return 0;
}

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
];

export {
  parseEventDates,
  scoreDateMatch,
  scoreDateProximity,
  THEATER_REQUEST_MARKERS,
  THEATER_NON_PERFORMANCE_NEGATIVE_MARKERS,
  THEATER_PERFORMANCE_POSITIVE_MARKERS,
};
