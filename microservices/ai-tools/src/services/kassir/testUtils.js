import {
  shouldSkipGeneratedKeywordForSlug,
  shouldApplyMoodKeywordFallback,
  inferMoodValueFromText,
  detectCategorySearchSlugs,
  resolveSearchSlugStrategy,
  buildStrictSearchResolution,
  buildQuerySuggestionFromParams,
  shouldPreserveFullKeywordForNamedTarget,
} from './searchRouting.js';
import {
  buildEventTextBlob,
  shouldApplyTheaterPerformanceFilter,
  isTheaterPerformanceCandidate,
  applyTheaterPerformanceFilter,
  shouldExcludeStandupForConcertRequest,
} from './eventFilters.js';

const __testUtils = Object.freeze({
  buildQuerySuggestionFromParams,
  buildEventTextBlob,
  buildStrictSearchResolution,
  detectCategorySearchSlugs,
  resolveSearchSlugStrategy,
  shouldSkipGeneratedKeywordForSlug,
  shouldApplyMoodKeywordFallback,
  shouldPreserveFullKeywordForNamedTarget,
  inferMoodValueFromText,
  shouldExcludeStandupForConcertRequest,
  shouldApplyTheaterPerformanceFilter,
  isTheaterPerformanceCandidate,
  applyTheaterPerformanceFilter,
});

export { __testUtils };
