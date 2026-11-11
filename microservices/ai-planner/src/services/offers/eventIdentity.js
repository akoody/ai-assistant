import { MAX_SHOWN_EVENTS_CONTEXT_ITEMS, MAX_EVENTS_PER_OFFER } from './searchDefinitions.js';
import {
  normalizeSearchFacetValue,
  getAmbiguousGenreShowAllRouteDefinitions,
} from './searchRouting.js';

function normalizeEventId(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const stringified = String(value).trim();
  return stringified.length > 0 ? stringified : null;
}

function buildEventSignature(event) {
  if (!event || typeof event !== 'object') {
    return null;
  }

  const parts = [];
  const addPart = (value) => {
    if (typeof value !== 'string') {
      return;
    }
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      parts.push(trimmed.toLowerCase());
    }
  };

  addPart(event.title);
  addPart(event.venue);
  addPart(event.city);

  if (parts.length === 0 && event.url) {
    addPart(event.url);
  }

  if (parts.length === 0) {
    return null;
  }

  return parts.join('|');
}

function buildCompactShownEvent(event) {
  if (!event || typeof event !== 'object') {
    return null;
  }

  const id = normalizeEventId(event.id);
  const signature = buildEventSignature(event);
  const summary = {};

  if (typeof event.title === 'string' && event.title.trim()) {
    summary.title = event.title;
  }
  if (typeof event.date === 'string' && event.date.trim()) {
    summary.date = event.date;
  }
  if (typeof event.time === 'string' && event.time.trim()) {
    summary.time = event.time;
  }
  if (typeof event.venue === 'string' && event.venue.trim()) {
    summary.venue = event.venue;
  }
  if (typeof event.city === 'string' && event.city.trim()) {
    summary.city = event.city;
  }

  if (!id && !signature && Object.keys(summary).length === 0) {
    return null;
  }

  return {
    id,
    signature,
    summary: Object.keys(summary).length > 0 ? summary : null,
  };
}

function compactShownEventsForContext(
  alreadyShownEvents = [],
  limit = MAX_SHOWN_EVENTS_CONTEXT_ITEMS
) {
  const ids = [];
  const signatures = [];
  const summaries = [];
  const seenIds = new Set();
  const seenSignatures = new Set();
  const summaryKeys = new Set();

  if (!Array.isArray(alreadyShownEvents) || limit <= 0) {
    return {
      shownEventIds: ids,
      shownEventSignatures: signatures,
      shownEventSummaries: summaries,
    };
  }

  for (const event of alreadyShownEvents.slice(-limit)) {
    const compact = buildCompactShownEvent(event);
    if (!compact) {
      continue;
    }

    if (compact.id && !seenIds.has(compact.id)) {
      seenIds.add(compact.id);
      ids.push(compact.id);
    }

    if (compact.signature && !seenSignatures.has(compact.signature)) {
      seenSignatures.add(compact.signature);
      signatures.push(compact.signature);
    }

    if (compact.summary) {
      const summaryKey = [
        compact.summary.title || '',
        compact.summary.date || '',
        compact.summary.time || '',
        compact.summary.venue || '',
        compact.summary.city || '',
      ]
        .join('|')
        .toLowerCase();

      if (summaryKey && !summaryKeys.has(summaryKey)) {
        summaryKeys.add(summaryKey);
        summaries.push(compact.summary);
      }
    }
  }

  return {
    shownEventIds: ids,
    shownEventSignatures: signatures,
    shownEventSummaries: summaries,
  };
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
    const idKey = normalizeEventId(event.id);
    if (idKey) {
      excludeIds.add(idKey);
    }
    const signature = buildEventSignature(event);
    if (signature) {
      excludeSignatures.add(signature);
    }
  });

  return { excludeIds, excludeSignatures };
}

function buildEventLookupKey(event) {
  if (!event || typeof event !== 'object') {
    return null;
  }

  return (
    buildEventSignature(event) ||
    normalizeEventId(event.id) ||
    event.url ||
    normalizeSearchFacetValue(
      [event.title, event.venue, event.city, event.date, event.time].filter(Boolean).join(' ')
    )
  );
}

function appendHiddenEventMetaValue(event, propertyName, value) {
  if (!event || typeof event !== 'object' || !propertyName || !value) {
    return;
  }

  const currentValues = Array.isArray(event[propertyName]) ? event[propertyName] : [];
  if (currentValues.includes(value)) {
    return;
  }

  Object.defineProperty(event, propertyName, {
    value: [...currentValues, value],
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

function attachSearchCandidateMetadata(event, candidate = null) {
  if (!event || typeof event !== 'object' || !candidate) {
    return event;
  }

  const routeKey = String(candidate.source || '').trim();
  const routeLabel = String(candidate.label || '').trim();

  if (routeKey) {
    appendHiddenEventMetaValue(event, '__searchRouteKeys', routeKey);
  }

  if (routeLabel) {
    appendHiddenEventMetaValue(event, '__searchRouteLabels', routeLabel);
  }

  return event;
}

function mergeSearchCandidateMetadata(targetEvent, sourceEvent) {
  if (
    !targetEvent ||
    typeof targetEvent !== 'object' ||
    !sourceEvent ||
    typeof sourceEvent !== 'object'
  ) {
    return targetEvent;
  }

  const routeKeys = Array.isArray(sourceEvent.__searchRouteKeys)
    ? sourceEvent.__searchRouteKeys
    : [];
  const routeLabels = Array.isArray(sourceEvent.__searchRouteLabels)
    ? sourceEvent.__searchRouteLabels
    : [];

  routeKeys.forEach((routeKey) =>
    appendHiddenEventMetaValue(targetEvent, '__searchRouteKeys', routeKey)
  );
  routeLabels.forEach((routeLabel) =>
    appendHiddenEventMetaValue(targetEvent, '__searchRouteLabels', routeLabel)
  );

  return targetEvent;
}

function rehydrateSearchCandidateMetadata(events = [], referenceEvents = []) {
  if (
    !Array.isArray(events) ||
    events.length === 0 ||
    !Array.isArray(referenceEvents) ||
    referenceEvents.length === 0
  ) {
    return events;
  }

  const referenceByKey = new Map();
  referenceEvents.forEach((event) => {
    const eventKey = buildEventLookupKey(event);
    if (!eventKey || referenceByKey.has(eventKey)) {
      return;
    }
    referenceByKey.set(eventKey, event);
  });

  events.forEach((event) => {
    const eventKey = buildEventLookupKey(event);
    if (!eventKey || !referenceByKey.has(eventKey)) {
      return;
    }

    mergeSearchCandidateMetadata(event, referenceByKey.get(eventKey));
  });

  return events;
}

function getEventSearchRouteKeys(event = {}) {
  return Array.isArray(event?.__searchRouteKeys) ? event.__searchRouteKeys.filter(Boolean) : [];
}

function getPositiveGenreSlots(slots = []) {
  return (Array.isArray(slots) ? slots : []).filter(
    (slot) =>
      slot &&
      !slot.isNegative &&
      ['жанр', 'жанр_музыки', 'предпочтения_жанры'].includes(String(slot.name || '').trim()) &&
      String(slot.value || '').trim()
  );
}

function getPreferenceGenreRouteKeys(slots = []) {
  const routeKeys = [];
  const seen = new Set();

  getPositiveGenreSlots(slots).forEach((slot) => {
    const normalizedGenre = normalizeSearchFacetValue(slot.value || '');
    if (!normalizedGenre) {
      return;
    }

    const routeKey = `genre:${normalizedGenre}`;
    if (seen.has(routeKey)) {
      return;
    }

    seen.add(routeKey);
    routeKeys.push(routeKey);
  });

  return routeKeys;
}

function getBalancedSelectionRouteKeys(slots = []) {
  const ambiguousRouteKeys = getAmbiguousGenreShowAllRouteDefinitions(slots)
    .map((route) => route.source)
    .filter(Boolean);

  if (ambiguousRouteKeys.length > 1) {
    return ambiguousRouteKeys;
  }

  return getPreferenceGenreRouteKeys(slots);
}

function getBalancedSelectionCoverageLabel(slots = []) {
  return getAmbiguousGenreShowAllRouteDefinitions(slots).length > 1
    ? 'ambiguous category coverage'
    : 'genre coverage';
}

function reorderEventsForPreferenceRouteDiversity(
  events = [],
  slots = [],
  limit = MAX_EVENTS_PER_OFFER
) {
  if (!Array.isArray(events) || events.length === 0) {
    return [];
  }

  const targetRouteKeys = getBalancedSelectionRouteKeys(slots);
  if (targetRouteKeys.length < 2 || events.length < 2) {
    return events.slice(0, Math.min(limit, events.length));
  }

  const safeLimit =
    Number.isFinite(limit) && limit > 0 ? Math.min(limit, events.length) : events.length;
  const headSize = Math.min(MAX_EVENTS_PER_OFFER, safeLimit, events.length);

  if (headSize < 2) {
    return events.slice(0, safeLimit);
  }

  const eventRef = (event) => buildEventLookupKey(event) || event;
  const selectedHead = [];
  const selectedRefs = new Set();
  const candidatesByRoute = new Map(targetRouteKeys.map((routeKey) => [routeKey, []]));

  events.forEach((event) => {
    const routeKeys = getEventSearchRouteKeys(event);
    targetRouteKeys.forEach((routeKey) => {
      if (routeKeys.includes(routeKey)) {
        candidatesByRoute.get(routeKey).push(event);
      }
    });
  });

  const activeRouteKeys = targetRouteKeys.filter(
    (routeKey) => candidatesByRoute.get(routeKey)?.length > 0
  );
  if (activeRouteKeys.length < 2) {
    return events.slice(0, safeLimit);
  }

  const addEvent = (event) => {
    const ref = eventRef(event);
    if (!event || selectedRefs.has(ref) || selectedHead.length >= headSize) {
      return false;
    }

    selectedRefs.add(ref);
    selectedHead.push(event);
    return true;
  };

  let round = 0;
  while (selectedHead.length < headSize) {
    let addedOnRound = false;

    for (const routeKey of activeRouteKeys) {
      const event = candidatesByRoute.get(routeKey)?.[round];
      if (addEvent(event)) {
        addedOnRound = true;
      }
    }

    if (!addedOnRound) {
      break;
    }

    round += 1;
  }

  if (selectedHead.length === 0) {
    return events.slice(0, safeLimit);
  }

  const remainingEvents = events.filter((event) => !selectedRefs.has(eventRef(event)));
  return [...selectedHead, ...remainingEvents].slice(0, safeLimit);
}

export {
  normalizeEventId,
  buildEventSignature,
  compactShownEventsForContext,
  seedExclusionSets,
  buildEventLookupKey,
  attachSearchCandidateMetadata,
  mergeSearchCandidateMetadata,
  rehydrateSearchCandidateMetadata,
  getEventSearchRouteKeys,
  getPositiveGenreSlots,
  getBalancedSelectionRouteKeys,
  getBalancedSelectionCoverageLabel,
  reorderEventsForPreferenceRouteDiversity,
};
