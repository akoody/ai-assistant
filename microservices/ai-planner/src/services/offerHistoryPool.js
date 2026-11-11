function normalizeOfferHistoryEventId(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeOfferHistoryText(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).trim().toLowerCase();
}

function buildOfferHistoryEventSignature(event) {
  if (!event || typeof event !== 'object') {
    return null;
  }

  const parts = [];
  const addPart = (value) => {
    const normalized = normalizeOfferHistoryText(value);
    if (normalized) {
      parts.push(normalized);
    }
  };

  addPart(event.title || event.name);
  addPart(event.date || event.dateStart);
  addPart(event.time);
  addPart(event.venue?.title || event.venue?.name || event.venue);
  addPart(event.city);
  addPart(event.url);

  if (parts.length === 0) {
    return null;
  }

  return parts.join('|');
}

function buildSeenEventSets(events = []) {
  const seenIds = new Set();
  const seenSignatures = new Set();

  if (!Array.isArray(events)) {
    return { seenIds, seenSignatures };
  }

  events.forEach((event) => {
    if (!event || typeof event !== 'object') {
      return;
    }

    const id = normalizeOfferHistoryEventId(event.id);
    const signature = buildOfferHistoryEventSignature(event);

    if (id) {
      seenIds.add(id);
    }
    if (signature) {
      seenSignatures.add(signature);
    }
  });

  return { seenIds, seenSignatures };
}

function isSeenEvent(event, seenIds, seenSignatures) {
  if (!event || typeof event !== 'object') {
    return false;
  }

  const id = normalizeOfferHistoryEventId(event.id);
  if (id && seenIds.has(id)) {
    return true;
  }

  const signature = buildOfferHistoryEventSignature(event);
  if (signature && seenSignatures.has(signature)) {
    return true;
  }

  return false;
}

export function getRemainingEventsFromPool(poolEvents = [], shownEvents = [], limit = 5) {
  if (!Array.isArray(poolEvents) || poolEvents.length === 0) {
    return [];
  }

  if (!Number.isFinite(limit) || limit <= 0) {
    return [];
  }

  const { seenIds, seenSignatures } = buildSeenEventSets(shownEvents);
  const remaining = [];

  for (const event of poolEvents) {
    if (!event || typeof event !== 'object') {
      continue;
    }

    if (isSeenEvent(event, seenIds, seenSignatures)) {
      continue;
    }

    remaining.push(event);
    if (remaining.length >= limit) {
      break;
    }
  }

  return remaining;
}
