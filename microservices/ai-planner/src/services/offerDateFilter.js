import { enrichSlotWithDateConsideringSlots } from './dateParsingUtils.js';

function parseEventDatesForFilter(event) {
  if (!event) return null;

  let startDate = null;
  let endDate = null;

  if (event.rawDate) {
    const parsed = new Date(event.rawDate);
    if (!Number.isNaN(parsed.getTime())) {
      startDate = parsed;
    }
  }

  if (event.rawEndDate) {
    const parsed = new Date(event.rawEndDate);
    if (!Number.isNaN(parsed.getTime())) {
      endDate = parsed;
    }
  }

  if (!startDate && event.date) {
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

    const match = String(event.date).match(/(\d+)\s+(\w+)\s+(\d+)/u);
    if (match) {
      const day = Number.parseInt(match[1], 10);
      const monthName = match[2].toLowerCase();
      const year = Number.parseInt(match[3], 10);
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

function normalizeToDayStart(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }

  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getTimestampFromDateEntry(entry) {
  const parsed = parseEventDatesForFilter(entry);
  return parsed?.startDate ? parsed.startDate.getTime() : null;
}

function sortAndFinalizeDatesForFilter(event) {
  if (!event || !Array.isArray(event.dates)) {
    return event;
  }

  const seen = new Set();
  const unique = [];

  event.dates.forEach((entry) => {
    if (!entry) return;
    const key = `${entry.date || ''}#${entry.time || ''}#${entry.rawDate || ''}`;
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
    return event;
  }

  const primary = unique[0];
  return {
    ...event,
    dates: unique,
    date: primary.date || null,
    time: primary.time || null,
    rawDate: primary.rawDate || null,
    rawEndDate: primary.rawEndDate || null,
    datesText: unique
      .map((entry) => [entry.date, entry.time].filter(Boolean).join(' ').trim())
      .filter(Boolean)
      .join(' · '),
  };
}

function getExplicitDateRangeFromSlot(dateSlot) {
  if (!dateSlot || typeof dateSlot !== 'object') {
    return null;
  }

  if (dateSlot.dateRange) {
    const startCandidate =
      dateSlot.dateRange.startDate instanceof Date
        ? dateSlot.dateRange.startDate
        : new Date(dateSlot.dateRange.startDate);
    const endCandidate =
      dateSlot.dateRange.endDate instanceof Date
        ? dateSlot.dateRange.endDate
        : new Date(dateSlot.dateRange.endDate);
    const startDate = normalizeToDayStart(startCandidate);
    const endDate = normalizeToDayStart(endCandidate);

    if (!startDate || !endDate) {
      return null;
    }

    if (endDate < startDate) {
      return null;
    }

    const endDateExclusive = new Date(endDate);
    endDateExclusive.setDate(endDateExclusive.getDate() + 1);

    return { startDate, endDateExclusive };
  }

  if (dateSlot.parsedDate) {
    const parsedDate =
      dateSlot.parsedDate instanceof Date ? dateSlot.parsedDate : new Date(dateSlot.parsedDate);
    const startDate = normalizeToDayStart(parsedDate);
    if (!startDate) {
      return null;
    }

    const endDateExclusive = new Date(startDate);
    endDateExclusive.setDate(endDateExclusive.getDate() + 1);

    return { startDate, endDateExclusive };
  }

  return null;
}

function eventOverlapsExplicitDateRange(eventDates, targetRange) {
  if (!eventDates?.startDate || !targetRange?.startDate || !targetRange?.endDateExclusive) {
    return false;
  }

  const eventStart = normalizeToDayStart(eventDates.startDate);
  const rawEventEnd = eventDates.endDate || eventDates.startDate;
  const eventEnd = normalizeToDayStart(rawEventEnd);

  if (!eventStart || !eventEnd) {
    return false;
  }

  return eventStart < targetRange.endDateExclusive && eventEnd >= targetRange.startDate;
}

export function filterEventsByExplicitDate(events, slots, dateContextText = '') {
  if (!Array.isArray(events) || events.length === 0) {
    return events;
  }

  const rawDateSlot = Array.isArray(slots)
    ? slots.find((slot) => slot && slot.name === 'дата_события')
    : null;
  const dateSlot = rawDateSlot
    ? enrichSlotWithDateConsideringSlots(rawDateSlot, slots, dateContextText)
    : rawDateSlot;
  const explicitRange = getExplicitDateRangeFromSlot(dateSlot);

  if (!explicitRange) {
    return events;
  }

  const filtered = events.reduce((acc, event) => {
    if (!event || typeof event !== 'object') {
      return acc;
    }

    const sourceEntries =
      Array.isArray(event.dates) && event.dates.length > 0
        ? event.dates
        : [
            {
              date: event.date || null,
              time: event.time || null,
              rawDate: event.rawDate || null,
              rawEndDate: event.rawEndDate || null,
            },
          ];

    const matchingEntries = sourceEntries
      .filter((entry) =>
        eventOverlapsExplicitDateRange(parseEventDatesForFilter(entry), explicitRange)
      )
      .map((entry) => ({
        date: entry.date || null,
        time: entry.time || null,
        rawDate: entry.rawDate || null,
        rawEndDate: entry.rawEndDate || null,
      }));

    if (matchingEntries.length === 0) {
      return acc;
    }

    acc.push(
      sortAndFinalizeDatesForFilter({
        ...event,
        dates: matchingEntries,
      })
    );
    return acc;
  }, []);

  return filtered;
}
