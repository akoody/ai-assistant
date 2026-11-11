import { createHash } from 'node:crypto';

const CACHE_TTL = 300;

const CACHE_VERSION = '1.7';

const EVENT_DETAILS_CACHE_TTL = 1800;

const DESCRIPTION_REWRITE_TIMEOUT_MS = 25000;

const DISPLAY_DESCRIPTION_MAX_LEN = 220;

const DESCRIPTION_SUMMARY_MAX_LEN = 260;

const DESCRIPTION_SUMMARY_ELLIPSIS_THRESHOLD = 200;

function shouldLogEventDescriptions() {
  return String(process.env.LOG_EVENT_DESCRIPTIONS || '').trim() === '1';
}

function truncateForLog(value, maxLen = 180) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!text) return '';
  if (text.length <= maxLen) return text;
  const slice = text.slice(0, maxLen);
  const lastSpace = slice.lastIndexOf(' ');
  return `${(lastSpace > 80 ? slice.slice(0, lastSpace) : slice).trim()}…`;
}

function logEventDescriptions(events, label) {
  if (!shouldLogEventDescriptions()) return;
  const list = Array.isArray(events) ? events : [];
  const preview = list.slice(0, 5).map((event, idx) => ({
    n: idx + 1,
    id: event?.id ?? null,
    title: event?.title ?? null,
    descriptionLen: typeof event?.description === 'string' ? event.description.length : 0,
    descriptionPreview: truncateForLog(event?.description || '', 220) || null,
  }));
  console.log(
    `📝 [offerService] Описание событий (top ${preview.length})${label ? `: ${label}` : ''}:`,
    preview
  );
}

function pickNonEmptyString(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function buildPreferenceCacheToken(userPreferences, allowPreferenceKeywordExpansion = false) {
  const relevantPreferences = {
    dislikedGenres: Array.isArray(userPreferences?.dislikedGenres)
      ? userPreferences.dislikedGenres
      : [],
    dislikedArtists: Array.isArray(userPreferences?.dislikedArtists)
      ? userPreferences.dislikedArtists
      : [],
    dislikedEventTypes: Array.isArray(userPreferences?.dislikedEventTypes)
      ? userPreferences.dislikedEventTypes
      : [],
  };

  if (allowPreferenceKeywordExpansion) {
    relevantPreferences.genres = Array.isArray(userPreferences?.genres)
      ? userPreferences.genres
      : [];
    relevantPreferences.artists = Array.isArray(userPreferences?.artists)
      ? userPreferences.artists
      : [];
    relevantPreferences.eventTypes = Array.isArray(userPreferences?.eventTypes)
      ? userPreferences.eventTypes
      : [];
  }

  const serialized = JSON.stringify(relevantPreferences);
  const digest = createHash('sha1').update(serialized).digest('hex').slice(0, 12);
  return `${allowPreferenceKeywordExpansion ? 'prefs:on' : 'prefs:off'}:${digest}`;
}

export {
  CACHE_TTL,
  CACHE_VERSION,
  EVENT_DETAILS_CACHE_TTL,
  DESCRIPTION_REWRITE_TIMEOUT_MS,
  DISPLAY_DESCRIPTION_MAX_LEN,
  DESCRIPTION_SUMMARY_MAX_LEN,
  DESCRIPTION_SUMMARY_ELLIPSIS_THRESHOLD,
  logEventDescriptions,
  pickNonEmptyString,
  buildPreferenceCacheToken,
};
