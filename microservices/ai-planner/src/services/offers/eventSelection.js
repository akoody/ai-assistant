import {
  MAX_EVENTS_PER_OFFER,
  QUICK_OFFER_DEFERRED_LLM_MAX_SELECTIONS,
} from './searchDefinitions.js';
import {
  reorderEventsForPreferenceRouteDiversity,
  buildEventLookupKey,
  rehydrateSearchCandidateMetadata,
  getEventSearchRouteKeys,
  getBalancedSelectionRouteKeys,
  getBalancedSelectionCoverageLabel,
} from './eventIdentity.js';
import { reorderEventsForMoodDiversity } from './moodDiversity.js';
import {
  normalizeToDayStart,
  formatLocalDayKey,
  getDateSlotDayKeys,
  isWeekendDateSlot,
} from './eventDates.js';
import { parseEventDates } from './dateScoring.js';
import { resolveMoodSearchRouting } from './searchRouting.js';

function selectEventsForOffer(events, slots, limit = MAX_EVENTS_PER_OFFER, dateContextText = '') {
  if (!Array.isArray(events) || events.length === 0) {
    return [];
  }

  if (!Number.isFinite(limit) || limit <= 0) {
    return [];
  }

  const eventsWithPreferenceRouteDiversity = reorderEventsForPreferenceRouteDiversity(
    events,
    slots,
    events.length
  );
  const preparedEvents = reorderEventsForMoodDiversity(
    eventsWithPreferenceRouteDiversity,
    slots,
    eventsWithPreferenceRouteDiversity.length
  );

  if (preparedEvents.length <= limit) {
    return preparedEvents.slice(0, limit);
  }

  const dateSlot = Array.isArray(slots)
    ? slots.find((slot) => slot && slot.name === 'дата_события')
    : null;

  if (!isWeekendDateSlot(dateSlot, slots, dateContextText)) {
    return preparedEvents.slice(0, limit);
  }

  const targetDayKeys = getDateSlotDayKeys(dateSlot, 2, slots, dateContextText);
  if (targetDayKeys.length < 2) {
    return preparedEvents.slice(0, limit);
  }

  const eventDayInfo = new Map();
  const getEventDayInfo = (event) => {
    if (eventDayInfo.has(event)) {
      return eventDayInfo.get(event);
    }

    const parsed = parseEventDates(event);
    if (!parsed?.startDate) {
      eventDayInfo.set(event, null);
      return null;
    }

    const dayStart = normalizeToDayStart(parsed.startDate);
    if (!dayStart) {
      eventDayInfo.set(event, null);
      return null;
    }

    const info = {
      key: formatLocalDayKey(dayStart),
      timestamp: dayStart.getTime(),
    };
    eventDayInfo.set(event, info);
    return info;
  };

  const groupedByDay = new Map();
  preparedEvents.forEach((event) => {
    const info = getEventDayInfo(event);
    if (!info) {
      return;
    }

    if (!groupedByDay.has(info.key)) {
      groupedByDay.set(info.key, {
        dayKey: info.key,
        timestamp: info.timestamp,
        events: [],
      });
    }

    groupedByDay.get(info.key).events.push(event);
  });

  const orderedGroups = targetDayKeys.map((dayKey) => groupedByDay.get(dayKey)).filter(Boolean);

  if (orderedGroups.length < 2) {
    return preparedEvents.slice(0, limit);
  }

  const fairSharePerDay = Math.max(1, Math.floor(limit / orderedGroups.length));
  const maxPerDay = Math.max(fairSharePerDay, Math.ceil(limit / orderedGroups.length));
  const selectedEvents = [];
  const selectedRefs = new Set();
  const picksByDay = new Map(orderedGroups.map((group) => [group.dayKey, 0]));

  const addEvent = (event, dayKey) => {
    if (!event || selectedEvents.length >= limit || selectedRefs.has(event)) {
      return false;
    }

    selectedRefs.add(event);
    selectedEvents.push(event);

    if (dayKey) {
      picksByDay.set(dayKey, (picksByDay.get(dayKey) || 0) + 1);
    }

    return true;
  };

  for (let round = 0; round < fairSharePerDay; round += 1) {
    for (const group of orderedGroups) {
      if (selectedEvents.length >= limit) {
        break;
      }

      const candidate = group.events[round];
      if (candidate) {
        addEvent(candidate, group.dayKey);
      }
    }
  }

  if (selectedEvents.length < limit) {
    for (const event of preparedEvents) {
      if (selectedEvents.length >= limit) {
        break;
      }

      const info = getEventDayInfo(event);
      if (!info || !picksByDay.has(info.key)) {
        continue;
      }

      if ((picksByDay.get(info.key) || 0) >= maxPerDay) {
        continue;
      }

      addEvent(event, info.key);
    }
  }

  if (selectedEvents.length < limit) {
    for (const event of preparedEvents) {
      if (selectedEvents.length >= limit) {
        break;
      }
      addEvent(event, null);
    }
  }

  const distribution = orderedGroups
    .map((group) => `${group.dayKey}:${picksByDay.get(group.dayKey) || 0}`)
    .join(', ');
  console.log(`📅 [offerService] Балансирую выдачу по выходным: ${distribution} (limit=${limit})`);

  return selectedEvents.slice(0, limit);
}

function preserveWeekendCoverageAfterLlmFilter(
  filteredEvents = [],
  basePool = [],
  slots = [],
  limit = QUICK_OFFER_DEFERRED_LLM_MAX_SELECTIONS,
  dateContextText = ''
) {
  if (!Array.isArray(filteredEvents) || filteredEvents.length === 0) {
    return filteredEvents;
  }

  const dateSlot = Array.isArray(slots)
    ? slots.find((slot) => slot && slot.name === 'дата_события')
    : null;

  if (!isWeekendDateSlot(dateSlot, slots, dateContextText)) {
    return filteredEvents;
  }

  const targetDayKeys = getDateSlotDayKeys(dateSlot, 2, slots, dateContextText);
  if (targetDayKeys.length < 2) {
    return filteredEvents;
  }

  const getDayKey = (event) => {
    const parsed = parseEventDates(event);
    if (!parsed?.startDate) return null;
    const dayStart = normalizeToDayStart(parsed.startDate);
    return formatLocalDayKey(dayStart);
  };

  const groupedBase = new Map();
  for (const event of basePool) {
    const dayKey = getDayKey(event);
    if (!dayKey) continue;
    if (!groupedBase.has(dayKey)) groupedBase.set(dayKey, []);
    groupedBase.get(dayKey).push(event);
  }

  const orderedDays = targetDayKeys.filter((dayKey) => groupedBase.has(dayKey));
  if (orderedDays.length < 2) {
    return filteredEvents;
  }

  const result = [...filteredEvents];
  const seen = new Set(result);
  const countByDay = new Map(orderedDays.map((dayKey) => [dayKey, 0]));

  for (const event of result) {
    const dayKey = getDayKey(event);
    if (dayKey && countByDay.has(dayKey)) {
      countByDay.set(dayKey, (countByDay.get(dayKey) || 0) + 1);
    }
  }

  let rescued = 0;
  for (const dayKey of orderedDays) {
    const baseEventsForDay = groupedBase.get(dayKey) || [];
    const targetPerDay = Math.min(2, baseEventsForDay.length);
    let currentCount = countByDay.get(dayKey) || 0;

    if (currentCount >= targetPerDay) {
      continue;
    }

    for (const candidate of baseEventsForDay) {
      if (result.length >= limit || currentCount >= targetPerDay) {
        break;
      }
      if (seen.has(candidate)) {
        continue;
      }
      seen.add(candidate);
      result.push(candidate);
      currentCount += 1;
      rescued += 1;
      countByDay.set(dayKey, currentCount);
    }
  }

  if (rescued > 0) {
    const distribution = orderedDays
      .map((dayKey) => `${dayKey}:${countByDay.get(dayKey) || 0}`)
      .join(', ');
    console.log(
      `📅 [offerService] Восстанавливаю покрытие выходных после LLM-фильтра: +${rescued}, ${distribution}`
    );
  }

  return result;
}

function preservePreferenceRouteCoverageAfterLlmFilter(
  filteredEvents = [],
  basePool = [],
  slots = [],
  limit = QUICK_OFFER_DEFERRED_LLM_MAX_SELECTIONS
) {
  if (!Array.isArray(filteredEvents) || filteredEvents.length === 0) {
    return filteredEvents;
  }

  const targetRouteKeys = getBalancedSelectionRouteKeys(slots);
  if (targetRouteKeys.length < 2) {
    return filteredEvents;
  }

  const hydratedFilteredEvents = rehydrateSearchCandidateMetadata(filteredEvents, basePool);
  const headLimit =
    Number.isFinite(limit) && limit > 0
      ? Math.min(limit, hydratedFilteredEvents.length)
      : hydratedFilteredEvents.length;

  const coveredRouteKeys = new Set(
    hydratedFilteredEvents
      .slice(0, headLimit)
      .flatMap((event) => getEventSearchRouteKeys(event))
      .filter((routeKey) => targetRouteKeys.includes(routeKey))
  );

  const mergedPool = [];
  const seenKeys = new Set();

  [...hydratedFilteredEvents, ...(Array.isArray(basePool) ? basePool : [])].forEach((event) => {
    const eventKey = buildEventLookupKey(event) || event;
    if (seenKeys.has(eventKey)) {
      return;
    }
    seenKeys.add(eventKey);
    mergedPool.push(event);
  });

  const availableRouteKeys = targetRouteKeys.filter((routeKey) =>
    mergedPool.some((event) => getEventSearchRouteKeys(event).includes(routeKey))
  );
  const targetCoverageCount = Math.min(
    availableRouteKeys.length,
    Math.max(
      1,
      Math.min(
        MAX_EVENTS_PER_OFFER,
        Number.isFinite(limit) && limit > 0 ? limit : MAX_EVENTS_PER_OFFER
      )
    )
  );

  if (availableRouteKeys.length < 2 || coveredRouteKeys.size >= targetCoverageCount) {
    return hydratedFilteredEvents;
  }

  const diversifiedPool = reorderEventsForPreferenceRouteDiversity(
    mergedPool,
    slots,
    Math.min(Number.isFinite(limit) && limit > 0 ? limit : mergedPool.length, mergedPool.length)
  );

  const restoredCoverage = Array.from(
    new Set(
      diversifiedPool
        .slice(0, Math.min(MAX_EVENTS_PER_OFFER, diversifiedPool.length))
        .flatMap((event) => getEventSearchRouteKeys(event))
        .filter((routeKey) => targetRouteKeys.includes(routeKey))
    )
  );

  console.log(
    `🎭 [offerService] Восстанавливаю ${getBalancedSelectionCoverageLabel(slots)} после LLM-фильтра: ` +
      `${restoredCoverage.join(', ')}`
  );

  return diversifiedPool;
}

function preserveMoodDiversityAfterLlmFilter(
  filteredEvents = [],
  basePool = [],
  slots = [],
  limit = QUICK_OFFER_DEFERRED_LLM_MAX_SELECTIONS
) {
  if (!Array.isArray(filteredEvents) || filteredEvents.length === 0) {
    return filteredEvents;
  }

  const moodRouting = resolveMoodSearchRouting({ slots });
  if (!moodRouting) {
    return filteredEvents;
  }

  const hydratedFilteredEvents = rehydrateSearchCandidateMetadata(filteredEvents, basePool);
  const mergedPool = [];
  const seenKeys = new Set();

  [...hydratedFilteredEvents, ...(Array.isArray(basePool) ? basePool : [])].forEach((event) => {
    const eventKey = buildEventLookupKey(event) || event;
    if (seenKeys.has(eventKey)) {
      return;
    }
    seenKeys.add(eventKey);
    mergedPool.push(event);
  });

  const diversifiedPool = reorderEventsForMoodDiversity(
    mergedPool,
    slots,
    Math.min(limit, mergedPool.length)
  );

  if (diversifiedPool.length > 0) {
    const routeCoverage = diversifiedPool
      .slice(0, Math.min(MAX_EVENTS_PER_OFFER, diversifiedPool.length))
      .flatMap((event) => getEventSearchRouteKeys(event))
      .filter(Boolean);

    if (routeCoverage.length > 0) {
      console.log(
        `🎭 [offerService] Восстанавливаю разнообразие mood-пула после LLM-фильтра: ` +
          `${Array.from(new Set(routeCoverage)).join(', ')}`
      );
    }
  }

  return diversifiedPool;
}

export {
  selectEventsForOffer,
  preserveWeekendCoverageAfterLlmFilter,
  preservePreferenceRouteCoverageAfterLlmFilter,
  preserveMoodDiversityAfterLlmFilter,
};
