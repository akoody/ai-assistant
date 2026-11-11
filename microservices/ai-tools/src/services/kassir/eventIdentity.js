function extractEventSummary(item) {
  const obj = item?.object || item || {};
  const activity = obj.activity || {};

  const title = obj.title || activity.title || 'Без названия';

  const dateCandidate =
    obj.beginsAt ||
    obj.date ||
    obj.dateStart ||
    obj.dateRange?.beginsAt ||
    obj.dateRange?.startDate ||
    activity.dateRange?.beginsAt ||
    activity.dateRange?.startDate ||
    null;

  const priceRange =
    obj.priceRange || activity.priceRange || item?.priceRange || item?.object?.priceRange || {};

  const priceMin = priceRange?.min ?? null;
  const priceMax = priceRange?.max ?? null;

  return {
    title,
    date: dateCandidate,
    priceMin,
    priceMax,
  };
}

function normalizeEventId(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const stringified = String(value).trim();
  return stringified.length > 0 ? stringified : null;
}

function normalizeTextValue(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim().toLowerCase();
}

function buildSignatureFromShownEvent(event) {
  if (!event || typeof event !== 'object') {
    return null;
  }

  const parts = [];
  const addPart = (value) => {
    const normalized = normalizeTextValue(value);
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

function normalizeShownEventSummary(summary) {
  if (!summary || typeof summary !== 'object') {
    return null;
  }

  const normalized = {};
  const assign = (key, value) => {
    if (typeof value === 'string' && value.trim()) {
      normalized[key] = value.trim();
    }
  };

  assign('title', summary.title || summary.name);
  assign('date', summary.date || summary.dateStart);
  assign('time', summary.time);
  assign('venue', summary.venue?.title || summary.venue?.name || summary.venue);
  assign('city', summary.city);

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function extractShownEventsContext(context = {}) {
  const legacyShownEvents = Array.isArray(context.alreadyShownEvents)
    ? context.alreadyShownEvents
    : [];
  const shownEventIds = Array.isArray(context.shownEventIds) ? context.shownEventIds : [];
  const shownEventSignatures = Array.isArray(context.shownEventSignatures)
    ? context.shownEventSignatures
    : [];
  const shownEventSummaries = Array.isArray(context.shownEventSummaries)
    ? context.shownEventSummaries
    : [];

  const hasCompactContext =
    shownEventIds.length > 0 || shownEventSignatures.length > 0 || shownEventSummaries.length > 0;

  const knownEvents = hasCompactContext
    ? shownEventSummaries.map(normalizeShownEventSummary).filter(Boolean)
    : legacyShownEvents;

  const excludeIds = new Set();
  const excludeSignatures = new Set();

  shownEventIds.forEach((value) => {
    const normalized = normalizeEventId(value);
    if (normalized) {
      excludeIds.add(normalized);
    }
  });

  shownEventSignatures.forEach((value) => {
    const normalized = normalizeTextValue(value);
    if (normalized) {
      excludeSignatures.add(normalized);
    }
  });

  if (!hasCompactContext) {
    const legacySets = seedExclusionSets(legacyShownEvents);
    legacySets.excludeIds.forEach((value) => excludeIds.add(value));
    legacySets.excludeSignatures.forEach((value) => excludeSignatures.add(value));
  }

  return {
    knownEvents,
    excludeIds,
    excludeSignatures,
  };
}

function buildSignatureFromApiItem(item) {
  const obj = item?.object || item || {};
  const activity = obj.activity || {};
  const parts = [];

  const addPart = (value) => {
    const normalized = normalizeTextValue(value);
    if (normalized) {
      parts.push(normalized);
    }
  };

  addPart(obj.title || activity.title || item?.title);
  addPart(
    obj.beginsAt ||
      obj.date ||
      obj.dateStart ||
      obj.dateRange?.beginsAt ||
      obj.dateRange?.startDate ||
      activity.dateRange?.beginsAt ||
      activity.dateRange?.startDate
  );
  addPart(
    obj.venue?.title ||
      obj.venue?.name ||
      obj.venue ||
      activity.venue?.title ||
      activity.venue?.name ||
      item?.venue?.title
  );

  if (parts.length === 0) {
    return null;
  }

  return parts.join('|');
}

function seedExclusionSets(alreadyShownEvents = []) {
  const excludeIds = new Set();
  const excludeSignatures = new Set();

  if (!Array.isArray(alreadyShownEvents)) {
    return { excludeIds, excludeSignatures };
  }

  alreadyShownEvents.forEach((event) => {
    if (!event || typeof event !== 'object') {
      return;
    }
    const id = normalizeEventId(event.id);
    if (id) {
      excludeIds.add(id);
    } else {
      const signature = buildSignatureFromShownEvent(event);
      if (signature) {
        excludeSignatures.add(signature);
      }
    }
  });

  return { excludeIds, excludeSignatures };
}

function isDuplicateEvent(item, excludeIds, excludeSignatures) {
  const obj = item?.object || item || {};
  const activity = obj.activity || {};

  const id = normalizeEventId(obj.id || activity.id || item?.id);
  if (id && excludeIds.has(id)) {
    return true;
  }

  const signature = buildSignatureFromApiItem(item);
  if (!id && signature && excludeSignatures.has(signature)) {
    return true;
  }

  if (id) {
    excludeIds.add(id);
  } else if (signature) {
    excludeSignatures.add(signature);
  }

  return false;
}

export {
  extractEventSummary,
  extractShownEventsContext,
  buildSignatureFromApiItem,
  isDuplicateEvent,
};
