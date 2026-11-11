import { pickNonEmptyString } from './offerSupport.js';
import {
  extractAgeRestrictionFromText,
  setEventDescriptionSource,
  extractMeaningfulDescriptionData,
} from './descriptions.js';
import { formatEventDateTime } from './eventDates.js';
import { toPriceNumber } from './budgetPolicy.js';

function getIsoCalendarDate(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/u);
  return match ? match[1] : null;
}

function calculateSameDayDurationMinutes(startValue, endValue) {
  const startDate = getIsoCalendarDate(startValue);
  const endDate = getIsoCalendarDate(endValue);
  if (!startDate || !endDate || startDate !== endDate) {
    return null;
  }

  const start = new Date(startValue);
  const end = new Date(endValue);
  const diffMs = end.getTime() - start.getTime();
  if (!Number.isFinite(diffMs) || diffMs <= 0) {
    return null;
  }

  const durationMinutes = Math.round(diffMs / 60000);
  return durationMinutes <= 12 * 60 ? durationMinutes : null;
}

function normalizeEvent(eventItem, { activityDescriptionById } = {}) {
  const obj = eventItem.object || eventItem;
  const activity = obj.activity || obj;

  // Определяем название
  const title = obj.title || activity.title || 'Без названия';

  // Определяем постер
  const posterImage = obj.posterImage || activity.posterImage || null;

  // Определяем город
  const city = obj.cityName || activity.cityName || null;

  // Определяем дату и время
  let date = null;
  let time = null;

  // Получаем дату/время начала из различных полей API
  let dateTimeString = null;
  if (obj.beginsAt) {
    dateTimeString = obj.beginsAt;
  } else if (obj.dateRange?.beginsAt) {
    dateTimeString = obj.dateRange.beginsAt;
  } else if (activity.dateRange?.beginsAt) {
    dateTimeString = activity.dateRange.beginsAt;
  }

  // Получаем дату/время окончания из различных полей API
  let endDateTimeString = null;
  if (obj.endsAt) {
    endDateTimeString = obj.endsAt;
  } else if (obj.dateRange?.endsAt) {
    endDateTimeString = obj.dateRange.endsAt;
  } else if (activity.dateRange?.endsAt) {
    endDateTimeString = activity.dateRange.endsAt;
  }

  // Форматируем дату и время (API уже возвращает локальное время)
  if (dateTimeString) {
    const formatted = formatEventDateTime(dateTimeString);
    date = formatted.date;
    time = formatted.time;
  }

  // Определяем место проведения
  let venue = null;
  if (obj.venue) {
    venue =
      typeof obj.venue === 'string'
        ? obj.venue
        : obj.venue.name || obj.venue.title || obj.venueName || null;
  } else if (obj.venues && obj.venues.length > 0) {
    venue = obj.venues[0].name || obj.venues[0].title || null;
  } else if (activity.venues && activity.venues.length > 0) {
    venue = activity.venues[0].name || activity.venues[0].title || null;
  }

  // Определяем цены
  let priceMin = null;
  let priceMax = null;
  if (obj.priceRange) {
    priceMin = toPriceNumber(obj.priceRange.min);
    priceMax = toPriceNumber(obj.priceRange.max);
  } else if (activity.priceRange) {
    priceMin = toPriceNumber(activity.priceRange.min);
    priceMax = toPriceNumber(activity.priceRange.max);
  }

  // Определяем ссылку
  let rawUrl = obj.url || activity.url || null;
  let url = null;

  if (rawUrl) {
    const separator = rawUrl.includes('?') ? '&' : '?';
    url = `${rawUrl}${separator}ref=ai_widget`;
  }

  // Доп. факты (без догадок): помогают LLM писать описание, когда description пустой
  const activityTitle = activity.title || null;
  const ageRestriction =
    obj.ageRestriction ||
    obj.ageLimit ||
    obj.ageGroup?.name ||
    activity.ageRestriction ||
    activity.ageLimit ||
    activity.ageGroup?.name ||
    (Array.isArray(obj.ageGroups) && obj.ageGroups.length > 0
      ? obj.ageGroups[0]?.name || obj.ageGroups[0]?.code || obj.ageGroups[0]?.value
      : null) ||
    (Array.isArray(activity.ageGroups) && activity.ageGroups.length > 0
      ? activity.ageGroups[0]?.name || activity.ageGroups[0]?.code || activity.ageGroups[0]?.value
      : null) ||
    extractAgeRestrictionFromText(
      obj.title,
      activityTitle,
      obj.description,
      activity.description,
      obj.techDescription,
      activity.techDescription
    ) ||
    null;
  const address = obj.venue?.address?.addressString || null;
  const category = activity.category?.name || null;
  const extraCategories = Array.isArray(activity.extraCategories)
    ? activity.extraCategories.map((c) => c?.name).filter(Boolean)
    : null;

  const durationMinutes =
    dateTimeString && endDateTimeString
      ? calculateSameDayDurationMinutes(dateTimeString, endDateTimeString)
      : null;

  // Определяем описание (убираем HTML теги и декодируем HTML-сущности)
  let description = null;
  let rawDescriptionCandidate = pickNonEmptyString(
    obj.description,
    activity.description,
    activity.techDescription,
    obj.techDescription
  );

  if (!rawDescriptionCandidate) {
    const activityId = obj?.activity?.id ?? null;
    if (activityId && activityDescriptionById instanceof Map) {
      rawDescriptionCandidate = activityDescriptionById.get(activityId) || null;
    }
  }

  const descriptionData = extractMeaningfulDescriptionData(rawDescriptionCandidate, {
    title,
    venue,
    category,
    extraCategories,
  });
  description = descriptionData.summary;

  const dateEntries = [];
  if (date || time || dateTimeString) {
    dateEntries.push({
      date,
      time,
      rawDate: dateTimeString || null,
      rawEndDate: endDateTimeString || null,
    });
  }

  const normalizedEvent = {
    id: obj.id || activity.id || null,
    title,
    activityTitle,
    posterImage,
    date,
    time,
    venue,
    city,
    address,
    ageRestriction,
    durationMinutes,
    priceMin,
    priceMax,
    url,
    description,
    category,
    extraCategories,
    // Сохраняем исходные даты для ранжирования
    rawDate: dateTimeString || null,
    rawEndDate: endDateTimeString || null,
    dates: dateEntries,
  };

  setEventDescriptionSource(normalizedEvent, descriptionData.source || '');

  return normalizedEvent;
}

export { normalizeEvent };
