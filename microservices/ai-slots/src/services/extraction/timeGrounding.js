import { enrichSlotWithDate } from '../dateParsingService.js';

function normalizeGuardText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .trim();
}

function hasDateSlot(slots = []) {
  const list = Array.isArray(slots) ? slots : [];
  return list.some((slot) => {
    if (!slot || typeof slot !== 'object') return false;
    const slotName = String(slot.name || '').toLowerCase();
    if (slot.parsedDate || slot.dateRange) {
      return true;
    }
    if (!slotName.includes('дата')) {
      return false;
    }

    const enrichedSlot = enrichSlotWithDate(slot);
    return Boolean(enrichedSlot?.parsedDate || enrichedSlot?.dateRange);
  });
}

function hasTimeSlot(slots = []) {
  const list = Array.isArray(slots) ? slots : [];
  return list.some((slot) => {
    if (!slot || typeof slot !== 'object') return false;
    const slotName = String(slot.name || '').toLowerCase();
    return isTimeSlotName(slotName) || Boolean(slot.timeRange);
  });
}

function isTimeSlotName(slotName = '') {
  const normalizedName = String(slotName || '')
    .toLowerCase()
    .trim();
  return normalizedName === 'концерт_время' || normalizedName.includes('время');
}

function isTimeSlotGrounded(slot, sourceText = '') {
  const normalizedText = normalizeGuardText(sourceText);
  if (!normalizedText) {
    return true;
  }

  if (hasExplicitTimeOfDayMarker(normalizedText)) {
    return true;
  }

  const normalizedValue = normalizeGuardText(slot?.value);
  if (!normalizedValue) {
    return false;
  }

  return normalizedText === normalizedValue && normalizedValue === 'день';
}

function hasExplicitTimeOfDayMarker(normalizedText = '') {
  return (
    /(?:^|[^\p{L}\p{N}_])(?:утром|утро|днем|вечером|вечер|ночью|ночь|любое\s+время)(?=$|[^\p{L}\p{N}_])/u.test(
      normalizedText
    ) ||
    /(?:^|[^\p{L}\p{N}_])(?:дневное\s+время|дневной\s+сеанс)(?=$|[^\p{L}\p{N}_])/u.test(
      normalizedText
    ) ||
    /(?:^|[^\p{L}\p{N}_])(?:после|до)\s+\d{1,2}(?::|\s+\d{2}|$|[^\p{L}\p{N}_])/u.test(
      normalizedText
    ) ||
    /(?:^|[^\p{L}\p{N}_])\d{1,2}:\d{2}(?=$|[^\p{L}\p{N}_])/u.test(normalizedText)
  );
}

function hasChildAgeSlot(slots = []) {
  const list = Array.isArray(slots) ? slots : [];
  return list.some(
    (slot) =>
      slot && slot.name === 'возраст_ребенка' && slot.value !== undefined && slot.value !== null
  );
}

export {
  normalizeGuardText,
  hasDateSlot,
  hasTimeSlot,
  isTimeSlotName,
  isTimeSlotGrounded,
  hasChildAgeSlot,
};
