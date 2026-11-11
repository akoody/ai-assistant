import { parseEventDates } from './dateScoring.js';
import { enrichSlotWithDate, enrichSlotWithDateConsideringSlots } from '../dateParsingUtils.js';

function formatEventDateTime(dateTimeString) {
  if (!dateTimeString) {
    return { date: null, time: null };
  }

  try {
    let dateTimeStr = String(dateTimeString);

    const isoMatch = dateTimeStr.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})/);
    if (!isoMatch) {
      const fallbackDate = new Date(dateTimeString);
      if (Number.isNaN(fallbackDate.getTime())) {
        console.warn(`⚠️ [Timezone] Не удалось распарсить дату: ${dateTimeString}`);
        return { date: null, time: null };
      }

      const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });

      const timeFormatter = new Intl.DateTimeFormat('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });

      return {
        date: dateFormatter.format(fallbackDate),
        time: timeFormatter.format(fallbackDate),
      };
    }

    // Извлекаем компоненты даты и времени
    const [, datePart, hour, minute] = isoMatch;
    const [year, month, day] = datePart.split('-').map(Number);
    const hourNum = Number(hour);
    const minuteNum = Number(minute);

    // API возвращает время, которое УЖЕ в локальном часовом поясе города
    // Поэтому используем компоненты напрямую без конвертации и без маппинга часовых поясов

    // Форматируем время напрямую из компонентов
    const time = `${String(hourNum).padStart(2, '0')}:${String(minuteNum).padStart(2, '0')}`;

    // Для даты создаем Date объект, интерпретируя компоненты как локальное время
    // Используем локальное время системы (не UTC), чтобы избежать конвертации
    const dateObj = new Date(year, month - 1, day, hourNum, minuteNum, 0);

    // Форматируем дату
    const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    const date = dateFormatter.format(dateObj);

    return { date, time };
  } catch (error) {
    console.error(`❌ [Timezone] Ошибка форматирования даты/времени:`, error);
    console.error(`   Дата: ${dateTimeString}`);
    return { date: null, time: null };
  }
}

function getTimestampFromDateEntry(entry) {
  if (!entry) {
    return null;
  }

  const parsed = parseEventDates({
    date: entry.date,
    time: entry.time,
    rawDate: entry.rawDate,
    rawEndDate: entry.rawEndDate,
  });

  return parsed?.startDate ? parsed.startDate.getTime() : null;
}

function selectPrimaryDateEntry(entries = []) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return null;
  }

  let bestEntry = entries[0];
  let bestTs = getTimestampFromDateEntry(bestEntry);

  for (let i = 1; i < entries.length; i += 1) {
    const current = entries[i];
    const currentTs = getTimestampFromDateEntry(current);

    if (currentTs === null) {
      continue;
    }

    if (bestTs === null || currentTs < bestTs) {
      bestEntry = current;
      bestTs = currentTs;
    }
  }

  return bestEntry;
}

function mergeEventDates(target, source) {
  if (!target || !source) {
    return;
  }

  if (!Array.isArray(target.dates)) {
    target.dates = [];
  }

  const candidate = {
    date: source.date || null,
    time: source.time || null,
    rawDate: source.rawDate || null,
    rawEndDate: source.rawEndDate || null,
  };

  const hasCandidateData = candidate.date || candidate.time || candidate.rawDate;
  const alreadyExists = target.dates.some(
    (entry) => entry.date === candidate.date && entry.time === candidate.time
  );

  if (hasCandidateData && !alreadyExists) {
    target.dates.push(candidate);
  }

  const primary = selectPrimaryDateEntry(target.dates);
  if (primary) {
    target.date = primary.date;
    target.time = primary.time;
    target.rawDate = primary.rawDate;
    target.rawEndDate = primary.rawEndDate;
  }
}

function sortAndFinalizeDates(event) {
  if (!event || !Array.isArray(event.dates)) {
    return;
  }

  const seen = new Set();
  const unique = [];

  event.dates.forEach((entry) => {
    if (!entry) return;
    const key = `${entry.date || ''}#${entry.time || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(entry);
  });

  unique.sort((a, b) => {
    const ta = getTimestampFromDateEntry(a);
    const tb = getTimestampFromDateEntry(b);
    if (ta === null && tb === null) return 0;
    if (ta === null) return 1;
    if (tb === null) return -1;
    return ta - tb;
  });

  if (unique.length === 0) {
    return;
  }

  event.dates = unique;

  const primary = unique[0];
  event.date = primary.date;
  event.time = primary.time;
  event.rawDate = primary.rawDate;
  event.rawEndDate = primary.rawEndDate;

  event.datesText = unique
    .map((entry) => {
      const parts = [];
      if (entry.date) parts.push(entry.date);
      if (entry.time) parts.push(entry.time);
      return parts.join(' ').trim();
    })
    .filter(Boolean)
    .join(' · ');
}

function formatRuDateForDisplay(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function buildEventDateRangeDisplay(event) {
  const parsed = parseEventDates(event);
  if (!parsed?.startDate || !parsed?.endDate) {
    return '';
  }

  const startDay = normalizeToDayStart(parsed.startDate);
  const endDay = normalizeToDayStart(parsed.endDate);
  if (!startDay || !endDay || startDay.getTime() === endDay.getTime()) {
    return '';
  }

  const startText = formatRuDateForDisplay(startDay);
  const endText = formatRuDateForDisplay(endDay);
  if (!startText || !endText) {
    return '';
  }

  return `${startText} – ${endText}`;
}

function decorateDisplayDates(events = []) {
  if (!Array.isArray(events)) {
    return events;
  }
  return events.map((event) => {
    if (!event || typeof event !== 'object') {
      return event;
    }
    const rangeDisplay = buildEventDateRangeDisplay(event);
    const display =
      rangeDisplay ||
      (Array.isArray(event.dates) && event.dates.length > 1
        ? event.datesText || event.date
        : event.date);
    return {
      ...event,
      dateDisplay: display || event.date,
      // Для фронта дублируем дату, если хотим показать все сеансы одной строкой
      date: display || event.date,
      time: rangeDisplay ? null : event.time,
    };
  });
}

function normalizeToDayStart(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatLocalDayKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDateSlotDayKeys(dateSlot, maxDays = 7, allSlots = null, dateContextText = '') {
  if (!dateSlot || typeof dateSlot !== 'object' || !Number.isFinite(maxDays) || maxDays <= 0) {
    return [];
  }

  const slotsList = Array.isArray(allSlots) ? allSlots : [];
  const hasContext = typeof dateContextText === 'string' && dateContextText.trim().length > 0;
  const normalizedDateSlot =
    slotsList.length > 0 || hasContext
      ? enrichSlotWithDateConsideringSlots(dateSlot, slotsList, dateContextText)
      : enrichSlotWithDate(dateSlot);

  if (normalizedDateSlot.dateRange) {
    const startCandidate =
      normalizedDateSlot.dateRange.startDate instanceof Date
        ? normalizedDateSlot.dateRange.startDate
        : new Date(normalizedDateSlot.dateRange.startDate);
    const endCandidate =
      normalizedDateSlot.dateRange.endDate instanceof Date
        ? normalizedDateSlot.dateRange.endDate
        : new Date(normalizedDateSlot.dateRange.endDate);
    const startDate = normalizeToDayStart(startCandidate);
    const endDate = normalizeToDayStart(endCandidate);

    if (!startDate || !endDate || endDate < startDate) {
      return [];
    }

    const result = [];
    const cursor = new Date(startDate);

    while (cursor <= endDate && result.length < maxDays) {
      const dayKey = formatLocalDayKey(cursor);
      if (dayKey) {
        result.push(dayKey);
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    return result;
  }

  if (normalizedDateSlot.parsedDate) {
    const parsedDate =
      normalizedDateSlot.parsedDate instanceof Date
        ? normalizedDateSlot.parsedDate
        : new Date(normalizedDateSlot.parsedDate);
    const dayStart = normalizeToDayStart(parsedDate);
    const dayKey = formatLocalDayKey(dayStart);
    return dayKey ? [dayKey] : [];
  }

  return [];
}

function isWeekendDateSlot(dateSlot, allSlots = null, dateContextText = '') {
  if (Array.isArray(allSlots)) {
    const daySlot = allSlots.find((s) => s && s.name === 'день_недели');
    const dv = String(daySlot?.value || '').toLowerCase();
    if (/выходн|уикенд/u.test(dv)) {
      return true;
    }
  }

  if (!dateSlot || typeof dateSlot !== 'object') {
    return false;
  }

  const slotsList = Array.isArray(allSlots) ? allSlots : [];
  const hasContext = typeof dateContextText === 'string' && dateContextText.trim().length > 0;
  const normalizedDateSlot =
    slotsList.length > 0 || hasContext
      ? enrichSlotWithDateConsideringSlots(dateSlot, slotsList, dateContextText)
      : enrichSlotWithDate(dateSlot);

  const value = String(normalizedDateSlot.value || '').toLowerCase();
  if (/выходн|уикенд/u.test(value)) {
    return true;
  }

  if (!normalizedDateSlot.dateRange) {
    return false;
  }

  const start =
    normalizedDateSlot.dateRange.startDate instanceof Date
      ? normalizedDateSlot.dateRange.startDate
      : new Date(normalizedDateSlot.dateRange.startDate);
  const end =
    normalizedDateSlot.dateRange.endDate instanceof Date
      ? normalizedDateSlot.dateRange.endDate
      : new Date(normalizedDateSlot.dateRange.endDate);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return false;
  }

  const normalizedStart = normalizeToDayStart(start);
  const normalizedEnd = normalizeToDayStart(end);
  if (!normalizedStart || !normalizedEnd) {
    return false;
  }

  const diffInDays = Math.round(
    (normalizedEnd.getTime() - normalizedStart.getTime()) / (24 * 60 * 60 * 1000)
  );
  return normalizedStart.getDay() === 6 && normalizedEnd.getDay() === 0 && diffInDays === 1;
}

export {
  formatEventDateTime,
  mergeEventDates,
  sortAndFinalizeDates,
  decorateDisplayDates,
  normalizeToDayStart,
  formatLocalDayKey,
  getDateSlotDayKeys,
  isWeekendDateSlot,
};
