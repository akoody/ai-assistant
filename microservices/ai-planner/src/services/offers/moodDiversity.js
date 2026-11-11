import { normalizeSearchFacetValue, resolveMoodSearchRouting } from './searchRouting.js';
import { getEventSearchRouteKeys, buildEventLookupKey } from './eventIdentity.js';
import { MAX_EVENTS_PER_OFFER } from './searchDefinitions.js';

function getMoodDiversityBuckets(event = {}) {
  const buckets = [];
  const pushBucket = (prefix, value) => {
    const normalized = normalizeSearchFacetValue(value);
    if (!normalized) {
      return;
    }

    const bucket = `${prefix}:${normalized}`;
    if (!buckets.includes(bucket)) {
      buckets.push(bucket);
    }
  };

  getEventSearchRouteKeys(event).forEach((routeKey) => pushBucket('route', routeKey));
  pushBucket('category', event.category);
  (Array.isArray(event.extraCategories) ? event.extraCategories : []).forEach((value) =>
    pushBucket('extra', value)
  );
  (Array.isArray(event.categories) ? event.categories : []).forEach((value) =>
    pushBucket('categories', value)
  );

  if (buckets.length === 0) {
    pushBucket('title', event.title);
  }

  return buckets;
}

function reorderEventsForMoodDiversity(events = [], slots = [], limit = MAX_EVENTS_PER_OFFER) {
  if (!Array.isArray(events) || events.length === 0) {
    return [];
  }

  const moodRouting = resolveMoodSearchRouting({ slots });
  if (!moodRouting || events.length < 2) {
    return events.slice(0, Math.min(limit, events.length));
  }

  const safeLimit =
    Number.isFinite(limit) && limit > 0 ? Math.min(limit, events.length) : events.length;
  const headSize = Math.min(MAX_EVENTS_PER_OFFER, safeLimit, events.length);

  if (headSize < 2) {
    return events.slice(0, safeLimit);
  }

  const selectedHead = [];
  const seenEvents = new Set();
  const usedBuckets = new Set();
  const venueCounts = new Map();

  const getEventRef = (event) => buildEventLookupKey(event) || event;
  const addEvent = (event, assignedBucket = null) => {
    const eventRef = getEventRef(event);
    if (seenEvents.has(eventRef) || selectedHead.length >= headSize) {
      return false;
    }

    seenEvents.add(eventRef);
    selectedHead.push(event);

    if (assignedBucket) {
      usedBuckets.add(assignedBucket);
    }

    const fallbackBucket = getMoodDiversityBuckets(event)[0];
    if (fallbackBucket) {
      usedBuckets.add(fallbackBucket);
    }

    const venueKey = normalizeSearchFacetValue(event?.venue || '');
    if (venueKey) {
      venueCounts.set(venueKey, (venueCounts.get(venueKey) || 0) + 1);
    }

    return true;
  };

  moodRouting.routes.forEach((route) => {
    if (selectedHead.length >= headSize) {
      return;
    }

    const routeSourceKey = normalizeSearchFacetValue(`mood:${moodRouting.key}:${route.key}`);
    const candidate = events.find((event) => {
      const eventRef = getEventRef(event);
      if (seenEvents.has(eventRef)) {
        return false;
      }
      return getEventSearchRouteKeys(event)
        .map((routeKey) => normalizeSearchFacetValue(routeKey))
        .includes(routeSourceKey);
    });

    if (candidate) {
      addEvent(candidate, `route:${routeSourceKey}`);
    }
  });

  events.forEach((event) => {
    if (selectedHead.length >= headSize) {
      return;
    }

    const eventRef = getEventRef(event);
    if (seenEvents.has(eventRef)) {
      return;
    }

    const freshBucket = getMoodDiversityBuckets(event).find((bucket) => !usedBuckets.has(bucket));
    if (freshBucket) {
      addEvent(event, freshBucket);
    }
  });

  events.forEach((event) => {
    if (selectedHead.length >= headSize) {
      return;
    }

    const eventRef = getEventRef(event);
    if (seenEvents.has(eventRef)) {
      return;
    }

    const venueKey = normalizeSearchFacetValue(event?.venue || '');
    if (venueKey && (venueCounts.get(venueKey) || 0) >= 2 && events.length > headSize) {
      return;
    }

    addEvent(event);
  });

  events.forEach((event) => {
    if (selectedHead.length >= headSize) {
      return;
    }
    addEvent(event);
  });

  const reordered = [
    ...selectedHead,
    ...events.filter((event) => !seenEvents.has(getEventRef(event))),
  ];

  if (selectedHead.length > 1) {
    const coverage = selectedHead
      .map(
        (event) =>
          getMoodDiversityBuckets(event)[0] || normalizeSearchFacetValue(event?.title || 'unknown')
      )
      .join(', ');
    console.log(`🎭 [offerService] Диверсифицирую mood-выдачу по маршрутам: ${coverage}`);
  }

  return reordered.slice(0, safeLimit);
}

export { reorderEventsForMoodDiversity };
