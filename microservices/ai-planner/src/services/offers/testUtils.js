import {
  extractMeaningfulDescriptionData,
  sanitizeRewrittenDescriptionCandidate,
  shouldRewriteDescriptionForDisplay,
} from './descriptions.js';
import { decorateDisplayDates } from './eventDates.js';

const __descriptionTestUtils = Object.freeze({
  decorateDisplayDates,
  extractMeaningfulDescriptionData,
  sanitizeRewrittenDescriptionCandidate,
  shouldRewriteDescriptionForDisplay,
});

export { __descriptionTestUtils };
