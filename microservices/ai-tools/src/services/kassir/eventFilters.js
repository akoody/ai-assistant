import {
  SHORT_GENRE_TOKEN_MAP,
  RAP_NEGATIVE_MARKERS,
  MUSIC_NON_CONCERT_NEGATIVE_MARKERS,
  THEATER_REQUEST_MARKERS,
  THEATER_EXPLICIT_NON_PERFORMANCE_REQUEST_MARKERS,
  THEATER_NON_PERFORMANCE_NEGATIVE_MARKERS,
  THEATER_PERFORMANCE_POSITIVE_MARKERS,
  STANDUP_NEGATIVE_MARKERS,
} from './keywordPolicy.js';

function buildEventTextBlob(item) {
  const obj = item?.object || item || {};
  const activity = obj.activity || {};
  const parts = [];
  const push = (value) => {
    if (value === null || value === undefined) {
      return;
    }
    const text = String(value).toLowerCase();
    if (text.trim()) {
      parts.push(text);
    }
  };

  push(obj.title);
  push(activity.title);
  push(activity.category);
  push(obj.description);
  push(activity.description);
  push(activity.techDescription);
  push(obj.venue?.title);
  push(obj.venue?.name);
  push(activity.venue?.title);
  push(activity.venue?.name);

  const extraCategories = activity.extraCategories || obj.extraCategories || [];
  if (Array.isArray(extraCategories)) {
    extraCategories.forEach((category) => {
      if (typeof category === 'string') {
        push(category);
      } else if (category && typeof category === 'object') {
        push(category.title || category.name || category.slug);
      }
    });
  } else if (extraCategories) {
    push(extraCategories);
  }

  const categories = obj.categories || activity.categories || item?.categories || [];
  if (Array.isArray(categories)) {
    categories.forEach((category) => {
      if (typeof category === 'string') {
        push(category);
      } else if (category && typeof category === 'object') {
        push(category.title || category.name || category.slug);
      }
    });
  }

  return parts.join(' ');
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasGenreTokenMatch(blob, token) {
  if (!blob || !token) {
    return false;
  }
  const escaped = escapeRegExp(token.toLowerCase());
  const pattern = `(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`;
  return new RegExp(pattern, 'iu').test(blob);
}

function applyShortGenreTokenFilter(items, detectedShortGenre) {
  if (!Array.isArray(items) || items.length === 0) {
    return items;
  }
  const tokens = SHORT_GENRE_TOKEN_MAP[detectedShortGenre] || [detectedShortGenre];
  const filtered = items.filter((item) => {
    const blob = buildEventTextBlob(item);
    return tokens.some((token) => hasGenreTokenMatch(blob, token));
  });
  return filtered;
}

function applyRapNegativeFilter(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return items;
  }

  return items.filter((item) => {
    const blob = buildEventTextBlob(item);
    return !RAP_NEGATIVE_MARKERS.some((marker) => blob.includes(marker));
  });
}

function applyMusicNonConcertNegativeFilter(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return items;
  }
  return items.filter((item) => {
    const blob = buildEventTextBlob(item);
    return !MUSIC_NON_CONCERT_NEGATIVE_MARKERS.some((marker) => blob.includes(marker));
  });
}

function shouldApplyTheaterPerformanceFilter({
  effectiveKeyword,
  querySuggestion,
  slots,
  lastUserMessage,
}) {
  const typeSlot = Array.isArray(slots)
    ? slots.find(
        (s) =>
          s && (s.name === 'тип_события' || s.name === 'тип_мероприятия' || s.name === 'категория')
      )
    : null;

  const combined = [
    effectiveKeyword,
    querySuggestion?.searchQuery,
    querySuggestion?.category,
    typeSlot?.value,
    lastUserMessage,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (!combined) {
    return false;
  }

  const explicitlyRequestsNonPerformanceFormat =
    THEATER_EXPLICIT_NON_PERFORMANCE_REQUEST_MARKERS.some((marker) => combined.includes(marker));

  if (explicitlyRequestsNonPerformanceFormat) {
    return false;
  }

  return THEATER_REQUEST_MARKERS.some((marker) => combined.includes(marker));
}

function isTheaterPerformanceCandidate(item) {
  const blob = buildEventTextBlob(item);
  if (!blob) {
    return true;
  }

  const hasNonPerformanceMarkers = THEATER_NON_PERFORMANCE_NEGATIVE_MARKERS.some((marker) =>
    blob.includes(marker)
  );

  if (!hasNonPerformanceMarkers) {
    return true;
  }

  const hasPerformanceMarkers = THEATER_PERFORMANCE_POSITIVE_MARKERS.some((marker) =>
    blob.includes(marker)
  );

  return hasPerformanceMarkers;
}

function applyTheaterPerformanceFilter(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return items;
  }

  return items.filter(isTheaterPerformanceCandidate);
}

function applyStandupNegativeFilter(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return items;
  }
  return items.filter((item) => {
    const blob = buildEventTextBlob(item);
    return !STANDUP_NEGATIVE_MARKERS.some((marker) => blob.includes(marker));
  });
}

function collectSlotValues(slots = [], slotNames = []) {
  if (
    !Array.isArray(slots) ||
    slots.length === 0 ||
    !Array.isArray(slotNames) ||
    slotNames.length === 0
  ) {
    return [];
  }

  const allowedNames = new Set(slotNames);
  return slots
    .filter((slot) => slot && allowedNames.has(slot.name))
    .map((slot) => String(slot.value || '').trim())
    .filter(Boolean);
}

function shouldExcludeStandupForConcertRequest({
  effectiveKeyword,
  querySuggestion,
  slots,
  lastUserMessage,
}) {
  const keywordLower = String(effectiveKeyword || '').toLowerCase();
  const suggestionLower = String(querySuggestion?.searchQuery || '').toLowerCase();
  const messageLower = String(lastUserMessage || '').toLowerCase();
  const artistLower = collectSlotValues(slots, ['исполнитель', 'артист']).join(' ').toLowerCase();
  const genreLower = collectSlotValues(slots, ['жанр', 'жанр_музыки', 'поджанр'])
    .join(' ')
    .toLowerCase();
  const contextLower = collectSlotValues(slots, ['контекст_события', 'настроение'])
    .join(' ')
    .toLowerCase();

  const typeSlot = Array.isArray(slots)
    ? slots.find(
        (s) =>
          s && (s.name === 'тип_события' || s.name === 'тип_мероприятия' || s.name === 'категория')
      )
    : null;
  const typeLower = String(typeSlot?.value || '').toLowerCase();

  const isConcertRequest =
    keywordLower.includes('концерт') ||
    suggestionLower.includes('концерт') ||
    typeLower.includes('концерт');

  if (!isConcertRequest) {
    return false;
  }

  const hasArtistFocus = querySuggestion?.intent === 'artist' || Boolean(artistLower);
  if (hasArtistFocus) {
    return false;
  }

  const combined = `${keywordLower} ${suggestionLower} ${typeLower} ${messageLower} ${artistLower} ${genreLower} ${contextLower}`;
  const explicitlyWantsStandup = /(ст[эе]ндап|stand\s*-?\s*up|комеди|юмор|comedy)/iu.test(combined);

  return !explicitlyWantsStandup;
}

export {
  buildEventTextBlob,
  hasGenreTokenMatch,
  applyShortGenreTokenFilter,
  applyRapNegativeFilter,
  applyMusicNonConcertNegativeFilter,
  shouldApplyTheaterPerformanceFilter,
  isTheaterPerformanceCandidate,
  applyTheaterPerformanceFilter,
  applyStandupNegativeFilter,
  shouldExcludeStandupForConcertRequest,
};
