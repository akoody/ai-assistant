import {
  matchesCategoryType,
  findCategoryConfigByType,
  buildEventCategorySearchText,
} from './searchRouting.js';
import { parseBudgetValue } from '../../../../../shared/moneyUtils.js';
import { toPriceNumber } from './budgetPolicy.js';
import { normalizeToDayStart, sortAndFinalizeDates } from './eventDates.js';
import { enrichSlotWithDateConsideringSlots } from '../dateParsingUtils.js';
import { parseEventDates } from './dateScoring.js';

function filterEventsByRequestedType(events, slots) {
  if (!Array.isArray(events) || events.length === 0) {
    return events;
  }

  const typeSlot = (Array.isArray(slots) ? slots : []).find(
    (slot) =>
      slot &&
      (slot.name === 'тип_события' ||
        slot.name === 'тип_мероприятия' ||
        slot.name === 'категория') &&
      slot.value
  );

  if (!typeSlot?.value) {
    return events;
  }

  const categoryConfig = findCategoryConfigByType([typeSlot.value]);
  if (!categoryConfig || categoryConfig.key === 'children') {
    return events;
  }

  const filtered = events.filter((event) => {
    const combinedText = buildEventCategorySearchText(event);
    if (!combinedText) {
      return false;
    }

    if (matchesCategoryType(categoryConfig, combinedText)) {
      return true;
    }

    return Array.isArray(event?.categories)
      ? event.categories.some((category) => matchesCategoryType(categoryConfig, category))
      : false;
  });

  if (filtered.length !== events.length) {
    console.log(
      `🧩 [filterEventsByRequestedType] Категория "${typeSlot.value}": оставлено ${filtered.length} из ${events.length}`
    );
  }

  return filtered;
}

function filterEventsByBudget(events, slots) {
  if (!Array.isArray(events) || events.length === 0) {
    return events;
  }

  const budgetSlot = slots.find((s) => s.name === 'бюджет');
  const priceToSlot = slots.find((s) => s.name === 'цена_до');

  const parseSlotNumber = (slot) => {
    if (!slot) return null;
    const parsed = parseBudgetValue(slot.value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const budgetFromBudgetSlot = parseSlotNumber(budgetSlot);
  const budgetFromPriceToSlot = parseSlotNumber(priceToSlot);
  const budget = budgetFromBudgetSlot ?? budgetFromPriceToSlot;

  console.log(`🔍 Фильтрация по бюджету: проверка слотов:`, {
    hasBudgetSlot: !!budgetSlot,
    budgetSlotValue: budgetSlot?.value,
    hasPriceToSlot: !!priceToSlot,
    priceToSlotValue: priceToSlot?.value,
    extractedBudget: budget,
  });

  if (budget === null || budget === undefined || Number.isNaN(budget)) {
    console.log('🔍 Фильтрация по бюджету: бюджет не указан, пропускаю фильтрацию');
    return events;
  }

  // Бюджет = 0 означает "только бесплатные мероприятия".
  if (budget === 0) {
    console.log(
      `🔍 Фильтрация по бюджету: бюджет = 0 (только бесплатно), событий: ${events.length}`
    );
    const filteredFreeOnly = events.filter((event) => {
      const eventPriceMinRaw = toPriceNumber(event?.priceMin);
      const eventPriceMaxRaw = toPriceNumber(event?.priceMax);
      const eventPriceMin = eventPriceMinRaw ?? eventPriceMaxRaw;
      const eventPriceMax = eventPriceMaxRaw ?? eventPriceMinRaw;
      const hasAnyPrice = eventPriceMin !== null || eventPriceMax !== null;
      if (!hasAnyPrice) {
        // Цена не указана — при бюджете 0 не можем гарантировать, что мероприятие бесплатное.
        return false;
      }
      const min = eventPriceMin ?? eventPriceMax;
      return typeof min === 'number' && min === 0;
    });

    console.log(
      `🔍 Фильтрация по бюджету: бесплатно оставлено ${filteredFreeOnly.length} из ${events.length}`
    );
    return filteredFreeOnly;
  }

  console.log(
    `🔍 Фильтрация по бюджету: начинаю фильтрацию (бюджет: ${budget} руб., событий: ${events.length})`
  );

  const filtered = events.filter((event) => {
    // Если у события нет цены, оставляем его (ранжирование уже дало ему низкий балл)
    const eventPriceMinRaw = toPriceNumber(event?.priceMin);
    const eventPriceMaxRaw = toPriceNumber(event?.priceMax);
    const eventPriceMin = eventPriceMinRaw ?? eventPriceMaxRaw;
    const eventPriceMax = eventPriceMaxRaw ?? eventPriceMinRaw;
    if (eventPriceMin === null && eventPriceMax === null) {
      console.log(`🔍 Фильтрация по бюджету: событие "${event.title}" без цены - оставляю`);
      return true;
    }

    // ВАЖНО: Если у события есть только минимальная цена (например, "от 2800"),
    // это означает, что билеты стоят ОТ этой суммы, и могут стоить больше.
    // Поэтому если priceMin > budget, событие не подходит.
    // Если есть priceMax, проверяем его. Если нет, используем priceMin как максимальную цену.

    // ВАЖНО: Удаляем событие только если МИНИМАЛЬНАЯ цена превышает бюджет.
    // Если priceMin <= budget, то событие подходит, даже если priceMax > budget,
    // потому что есть билеты в пределах бюджета (от priceMin до budget).
    // Например: событие с ценами 2000-5000 и бюджетом 3000 - ПОДХОДИТ (есть билеты от 2000 до 3000).
    if (typeof eventPriceMin === 'number' && eventPriceMin > budget) {
      console.log(
        `🔍 Фильтрация по бюджету: событие "${event.title}" (цена от ${eventPriceMin} руб.) превышает бюджет ${budget} руб. - удаляю`
      );
      return false;
    }

    // Событие вписывается в бюджет (есть билеты в пределах бюджета)
    const isFree = eventPriceMin === 0 && (eventPriceMax === null || eventPriceMax === 0);
    const priceInfo = isFree
      ? `бесплатно`
      : eventPriceMax !== null && eventPriceMax !== undefined && eventPriceMax !== eventPriceMin
        ? `${eventPriceMin}-${eventPriceMax} руб. (есть билеты до ${Math.min(eventPriceMax, budget)} руб.)`
        : `от ${eventPriceMin} руб.`;
    console.log(
      `🔍 Фильтрация по бюджету: событие "${event.title}" (${priceInfo}) вписывается в бюджет ${budget} руб. - оставляю`
    );
    return true;
  });

  if (filtered.length < events.length) {
    console.log(
      `🔍 Фильтрация по бюджету: оставлено ${filtered.length} из ${events.length} событий (бюджет: ${budget} руб.)`
    );
    console.log(
      `🔍 Фильтрация по бюджету: удалено ${events.length - filtered.length} событий, превышающих бюджет`
    );
  } else {
    console.log(
      `🔍 Фильтрация по бюджету: все события соответствуют бюджету (бюджет: ${budget} руб.)`
    );
  }

  return filtered;
}

function getMonthOnlyDateRange(dateSlot) {
  if (!dateSlot || dateSlot.parsedDate || !dateSlot.dateRange) {
    return null;
  }

  const start = normalizeToDayStart(dateSlot.dateRange.startDate);
  const end = normalizeToDayStart(dateSlot.dateRange.endDate);

  if (!start || !end || end < start) {
    return null;
  }

  const lastDayOfMonth = new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate();
  const isFullMonth =
    start.getDate() === 1 &&
    end.getDate() === lastDayOfMonth &&
    start.getMonth() === end.getMonth() &&
    start.getFullYear() === end.getFullYear();

  if (!isFullMonth) {
    return null;
  }

  const endDateExclusive = new Date(end);
  endDateExclusive.setDate(endDateExclusive.getDate() + 1);

  return {
    startDate: start,
    endDate: end,
    endDateExclusive,
  };
}

function getEventDateEntries(event) {
  if (Array.isArray(event?.dates) && event.dates.length > 0) {
    return event.dates;
  }

  return [
    {
      date: event?.date || null,
      time: event?.time || null,
      rawDate: event?.rawDate || null,
      rawEndDate: event?.rawEndDate || null,
    },
  ];
}

function eventOverlapsDateRange(eventDates, targetRange) {
  if (!eventDates?.startDate || !targetRange?.startDate || !targetRange?.endDateExclusive) {
    return false;
  }

  const eventStart = normalizeToDayStart(eventDates.startDate);
  const eventEnd = normalizeToDayStart(eventDates.endDate || eventDates.startDate);

  if (!eventStart || !eventEnd) {
    return false;
  }

  return eventStart < targetRange.endDateExclusive && eventEnd >= targetRange.startDate;
}

function filterEventsByMonth(events, slots, dateContextText = '') {
  if (!Array.isArray(events) || events.length === 0) {
    return events;
  }

  const rawDateSlot = slots.find((s) => s.name === 'дата_события');
  const dateSlot = rawDateSlot
    ? enrichSlotWithDateConsideringSlots(rawDateSlot, slots, dateContextText)
    : rawDateSlot;
  if (!dateSlot) {
    console.log('🔍 Фильтрация по месяцу: слот даты не найден');
    return events;
  }

  console.log(`🔍 Фильтрация по месяцу: проверка слота даты:`, {
    name: dateSlot.name,
    value: dateSlot.value,
    hasParsedDate: !!dateSlot.parsedDate,
    hasDateRange: !!dateSlot.dateRange,
  });

  const monthRange = getMonthOnlyDateRange(dateSlot);
  if (!monthRange) {
    console.log(
      `🔍 Фильтрация по месяцу: пропущена (есть parsedDate: ${!!dateSlot.parsedDate}, есть dateRange: ${!!dateSlot.dateRange})`
    );
    return events;
  }

  const { startDate: start, endDate: end } = monthRange;
  const lastDayOfMonth = end.getDate();

  console.log(`🔍 Фильтрация по месяцу: проверка диапазона:`, {
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    startDay: start.getDate(),
    endDay: end.getDate(),
    lastDayOfMonth,
    isFullMonth: true,
  });

  // Фильтруем события: оставляем только те, которые попадают в запрошенный месяц
  const targetMonth = start.getMonth();
  const targetYear = start.getFullYear();

  console.log(
    `🔍 Фильтрация по месяцу: начинаю фильтрацию (месяц: ${targetMonth + 1}/${targetYear}, событий: ${events.length})`
  );

  const filtered = events.reduce((acc, event) => {
    if (!event || typeof event !== 'object') {
      return acc;
    }

    const matchingEntries = getEventDateEntries(event)
      .filter((entry) => eventOverlapsDateRange(parseEventDates(entry), monthRange))
      .map((entry) => ({
        date: entry.date || null,
        time: entry.time || null,
        rawDate: entry.rawDate || null,
        rawEndDate: entry.rawEndDate || null,
      }));

    if (matchingEntries.length === 0) {
      console.log(
        `🔍 Фильтрация по месяцу: событие "${event.title}" не попадает в ${targetMonth + 1}/${targetYear} - удаляю`
      );
      return acc;
    }

    const normalizedEvent = {
      ...event,
      dates: matchingEntries,
    };
    sortAndFinalizeDates(normalizedEvent);
    acc.push(normalizedEvent);
    return acc;
  }, []);

  if (filtered.length < events.length) {
    console.log(
      `🔍 Фильтрация по месяцу: оставлено ${filtered.length} из ${events.length} событий (месяц: ${targetMonth + 1}/${targetYear})`
    );
  } else {
    console.log(
      `🔍 Фильтрация по месяцу: все события соответствуют месяцу (месяц: ${targetMonth + 1}/${targetYear})`
    );
  }

  return filtered;
}

function filterEventsByTime(events, slots) {
  if (!Array.isArray(events) || events.length === 0) {
    return events;
  }

  console.log(
    `🔍 Фильтрация по времени: проверка слотов (всего ${slots.length}):`,
    slots.map((s) => ({
      name: s.name,
      value: s.value,
      hasTimeRange: !!s.timeRange,
      hasParsedDate: !!s.parsedDate,
    }))
  );

  // Ищем слот времени (может быть "концерт_время", "время_события" или содержать "время")
  const timeSlot = slots.find(
    (s) => s.name === 'концерт_время' || s.name === 'время_события' || s.name.includes('время')
  );

  if (!timeSlot) {
    console.log(
      '🔍 Фильтрация по времени: слот времени не найден среди слотов:',
      slots.map((s) => s.name).join(', ')
    );
    return events;
  }

  console.log(`🔍 Фильтрация по времени: проверка слота времени:`, {
    name: timeSlot.name,
    value: timeSlot.value,
    hasParsedDate: !!timeSlot.parsedDate,
    hasTimeRange: !!timeSlot.timeRange,
    timeRangeFormat: timeSlot.timeRange
      ? timeSlot.timeRange.startHour !== undefined
        ? 'new (numbers)'
        : 'old (Date)'
      : null,
  });

  // Проверяем, есть ли диапазон времени (для "после X:XX" или "до X:XX")
  if (timeSlot.timeRange) {
    let startHour, startMinute, endHour, endMinute;

    // Поддерживаем как новый формат (простые числа), так и старый (Date объекты)
    if (
      timeSlot.timeRange.startHour !== undefined &&
      timeSlot.timeRange.startMinute !== undefined
    ) {
      // Новый формат: простые числа (часы и минуты) - самый надежный способ
      startHour = timeSlot.timeRange.startHour;
      startMinute = timeSlot.timeRange.startMinute;
      endHour = timeSlot.timeRange.endHour;
      endMinute = timeSlot.timeRange.endMinute;
      console.log(`🔍 Фильтрация по времени: используем новый формат timeRange (простые числа)`);
    } else if (timeSlot.timeRange.startTime) {
      // Старый формат: Date объекты (для обратной совместимости)
      let { startTime, endTime } = timeSlot.timeRange;

      // Конвертируем в Date объекты, если они строками
      if (startTime && !(startTime instanceof Date)) {
        startTime = new Date(startTime);
      }
      if (endTime && !(endTime instanceof Date)) {
        endTime = new Date(endTime);
      }

      if (
        !startTime ||
        !endTime ||
        Number.isNaN(startTime.getTime()) ||
        Number.isNaN(endTime.getTime())
      ) {
        console.log(
          '🔍 Фильтрация по времени: пропущена (нет startTime или endTime, или невалидные даты)'
        );
        return events;
      }

      // ВАЖНО: Извлекаем час и минуты напрямую из ISO строки, а не используем getHours()/getMinutes()
      // Это нужно, потому что timeRange может быть сохранен в UTC, но время в нем уже в локальном часовом поясе города
      const startTimeStr = startTime instanceof Date ? startTime.toISOString() : String(startTime);
      const endTimeStr = endTime instanceof Date ? endTime.toISOString() : String(endTime);

      const startMatch = startTimeStr.match(/T(\d{2}):(\d{2}):/);
      const endMatch = endTimeStr.match(/T(\d{2}):(\d{2}):/);

      if (startMatch && endMatch) {
        startHour = parseInt(startMatch[1], 10);
        startMinute = parseInt(startMatch[2], 10);
        endHour = parseInt(endMatch[1], 10);
        endMinute = parseInt(endMatch[2], 10);
      } else {
        // Fallback на getHours/getMinutes
        startHour = startTime.getHours();
        startMinute = startTime.getMinutes();
        endHour = endTime.getHours();
        endMinute = endTime.getMinutes();
      }
      console.log(`🔍 Фильтрация по времени: используем старый формат timeRange (Date объекты)`);
    } else {
      console.log('🔍 Фильтрация по времени: пропущена (timeRange в неожиданном формате)');
      return events;
    }

    console.log(
      `🔍 Фильтрация по времени: начинаю фильтрацию (время: ${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')} - ${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}, событий: ${events.length})`
    );

    const exactMatches = [];
    const uncertainMatches = [];

    events.forEach((event) => {
      // Парсим время события - это критично для фильтрации
      let eventTime = null;
      let timeDerivedFromRawDate = false;

      // Пробуем из rawDate (ISO строка) - это самый надежный источник
      // ВАЖНО: API Кассира возвращает время, которое УЖЕ в локальном часовом поясе города,
      // но помечено как UTC (+00:00). Поэтому извлекаем компоненты напрямую из ISO строки,
      // а не используем getHours()/getMinutes(), которые возвращают время в локальном часовом поясе системы
      if (event.rawDate) {
        try {
          const dateTimeStr = String(event.rawDate);
          const isoMatch = dateTimeStr.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})/);
          if (isoMatch) {
            const hourNum = parseInt(isoMatch[2], 10);
            const minuteNum = parseInt(isoMatch[3], 10);
            if (hourNum >= 0 && hourNum < 24 && minuteNum >= 0 && minuteNum < 60) {
              eventTime = {
                hours: hourNum,
                minutes: minuteNum,
              };
              timeDerivedFromRawDate = true;
            }
          } else {
            // Fallback на Date объект, если формат не ISO
            const eventDate = new Date(event.rawDate);
            if (!Number.isNaN(eventDate.getTime())) {
              eventTime = {
                hours: eventDate.getHours(),
                minutes: eventDate.getMinutes(),
              };
              timeDerivedFromRawDate = true;
            }
          }
        } catch (e) {
          console.warn(
            `⚠️ Фильтрация по времени: ошибка парсинга rawDate для события "${event.title}": ${event.rawDate}`,
            e
          );
        }
      }

      // Если не получилось из rawDate, пробуем парсить из строки time (формат "HH:MM")
      if (!eventTime && event.time) {
        const timeMatch = event.time.match(/(\d{1,2}):(\d{2})/);
        if (timeMatch) {
          const hours = parseInt(timeMatch[1], 10);
          const minutes = parseInt(timeMatch[2], 10);
          if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
            eventTime = {
              hours: hours,
              minutes: minutes,
            };
          }
        }
      }

      const hasExplicitClockTime =
        typeof event.time === 'string' && /\d{1,2}:\d{2}/.test(event.time);
      const isMidnightPlaceholder =
        eventTime && eventTime.hours === 0 && eventTime.minutes === 0 && !hasExplicitClockTime;

      // Если у события нет точного времени или пришёл плейсхолдер 00:00,
      // сохраняем его как fallback-кандидат. Для витрин/экспозиций это часто означает
      // "событие доступно в течение дня", а не буквальный старт в полночь.
      if (!eventTime) {
        console.log(
          `🔍 Фильтрация по времени: событие "${event.title}" без точного времени - сохраняю как fallback-кандидат`
        );
        uncertainMatches.push(event);
        return;
      }

      if (isMidnightPlaceholder) {
        console.log(
          `🔍 Фильтрация по времени: событие "${event.title}" имеет неточное время 00:00` +
            `${timeDerivedFromRawDate ? ' из rawDate' : ''} - сохраняю как fallback-кандидат`
        );
        uncertainMatches.push(event);
        return;
      }

      // Преобразуем время события в минуты от начала дня для удобства сравнения
      const eventMinutes = eventTime.hours * 60 + eventTime.minutes;
      // Используем уже извлеченные startHour, startMinute, endHour, endMinute из ISO строки
      const startMinutes = startHour * 60 + startMinute;
      const endMinutes = endHour * 60 + endMinute;

      // Проверяем, попадает ли время события в диапазон
      // Для "после X:XX" событие должно начинаться ПОСЛЕ или РАВНО указанному времени (>=)
      // Это означает, что событие в 18:00 попадает под "после 18:00"
      // Для "до X:XX" событие должно начинаться ДО указанного времени (<)
      // Для обычного диапазона событие должно попадать в диапазон включительно
      let matches = false;
      const slotValueLower = (timeSlot.value || '').toLowerCase();
      if (slotValueLower.includes('после')) {
        // "После X:XX" - событие должно начинаться ПОСЛЕ или РАВНО указанному времени
        // Например, "после 18:00" включает события в 18:00, 18:01, 19:00 и т.д., но не 17:59
        matches = eventMinutes >= startMinutes;
      } else if (slotValueLower.includes('до')) {
        // "До X:XX" - событие должно начинаться ДО указанного времени (строго меньше)
        matches = eventMinutes < endMinutes;
      } else {
        // Обычный диапазон - включительно
        matches = eventMinutes >= startMinutes && eventMinutes <= endMinutes;
      }

      if (!matches) {
        console.log(
          `🔍 Фильтрация по времени: событие "${event.title}" (${String(eventTime.hours).padStart(2, '0')}:${String(eventTime.minutes).padStart(2, '0')}) ` +
            `не попадает в диапазон ${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')} - ` +
            `${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')} - удаляю`
        );
      } else {
        console.log(
          `✅ Фильтрация по времени: событие "${event.title}" (${String(eventTime.hours).padStart(2, '0')}:${String(eventTime.minutes).padStart(2, '0')}) ` +
            `попадает в диапазон ${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')} - ` +
            `${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')} - оставляю`
        );
        exactMatches.push(event);
      }
    });

    if (exactMatches.length > 0) {
      if (exactMatches.length < events.length) {
        console.log(
          `🔍 Фильтрация по времени: оставлено ${exactMatches.length} из ${events.length} событий`
        );
      } else {
        console.log(`🔍 Фильтрация по времени: все события соответствуют времени`);
      }

      return exactMatches;
    }

    if (uncertainMatches.length > 0) {
      console.log(
        `🔁 Фильтрация по времени: точных вечерних событий не найдено, ` +
          `возвращаю ${uncertainMatches.length} fallback-событий без точного времени`
      );
      return uncertainMatches;
    }

    console.log(`🔍 Фильтрация по времени: подходящих событий не осталось`);
    return [];
  }

  // Если есть конкретное время (parsedDate), фильтруем события, которые начинаются в это время или позже
  if (timeSlot.parsedDate) {
    const targetTime = new Date(timeSlot.parsedDate);
    const targetHour = targetTime.getHours();
    const targetMinute = targetTime.getMinutes();

    console.log(
      `🔍 Фильтрация по времени: начинаю фильтрацию (время: ${String(targetHour).padStart(2, '0')}:${String(targetMinute).padStart(2, '0')}, событий: ${events.length})`
    );

    const filtered = events.filter((event) => {
      // Если у события нет времени, оставляем его
      if (!event.time && !event.rawDate) {
        console.log(`🔍 Фильтрация по времени: событие "${event.title}" без времени - оставляю`);
        return true;
      }

      // Парсим время события
      let eventTime = null;

      // Пробуем из rawDate
      // ВАЖНО: API Кассира возвращает время, которое УЖЕ в локальном часовом поясе города,
      // но помечено как UTC (+00:00). Поэтому извлекаем компоненты напрямую из ISO строки
      if (event.rawDate) {
        try {
          const dateTimeStr = String(event.rawDate);
          const isoMatch = dateTimeStr.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})/);
          if (isoMatch) {
            const hourNum = parseInt(isoMatch[2], 10);
            const minuteNum = parseInt(isoMatch[3], 10);
            if (hourNum >= 0 && hourNum < 24 && minuteNum >= 0 && minuteNum < 60) {
              eventTime = {
                hours: hourNum,
                minutes: minuteNum,
              };
            }
          } else {
            // Fallback на Date объект, если формат не ISO
            const eventDate = new Date(event.rawDate);
            if (!Number.isNaN(eventDate.getTime())) {
              eventTime = {
                hours: eventDate.getHours(),
                minutes: eventDate.getMinutes(),
              };
            }
          }
        } catch (e) {
          console.warn(
            `⚠️ Фильтрация по времени: ошибка парсинга rawDate для события "${event.title}": ${event.rawDate}`,
            e
          );
        }
      }

      // Если не получилось из rawDate, пробуем парсить из строки time
      if (!eventTime && event.time) {
        const timeMatch = event.time.match(/(\d{1,2}):(\d{2})/);
        if (timeMatch) {
          eventTime = {
            hours: parseInt(timeMatch[1], 10),
            minutes: parseInt(timeMatch[2], 10),
          };
        }
      }

      if (!eventTime) {
        console.log(`🔍 Фильтрация по времени: событие "${event.title}" без времени - оставляю`);
        return true;
      }

      // Преобразуем время события в минуты от начала дня
      const eventMinutes = eventTime.hours * 60 + eventTime.minutes;
      const targetMinutes = targetHour * 60 + targetMinute;

      // Событие должно начинаться в указанное время или позже
      const matches = eventMinutes >= targetMinutes;

      if (!matches) {
        console.log(
          `🔍 Фильтрация по времени: событие "${event.title}" (${String(eventTime.hours).padStart(2, '0')}:${String(eventTime.minutes).padStart(2, '0')}) ` +
            `раньше ${String(targetHour).padStart(2, '0')}:${String(targetMinute).padStart(2, '0')} - удаляю`
        );
      }

      return matches;
    });

    if (filtered.length < events.length) {
      console.log(
        `🔍 Фильтрация по времени: оставлено ${filtered.length} из ${events.length} событий`
      );
    } else {
      console.log(`🔍 Фильтрация по времени: все события соответствуют времени`);
    }

    return filtered;
  }

  console.log(`🔍 Фильтрация по времени: пропущена (нет parsedDate или timeRange)`);
  return events;
}

export {
  filterEventsByRequestedType,
  filterEventsByBudget,
  filterEventsByMonth,
  filterEventsByTime,
};
