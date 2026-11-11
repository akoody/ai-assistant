import { isRussianCity, normalizeCityButton } from './offerService.js';

const MAX_CITY_TOKENS = 3;
const LOCATION_PREPOSITIONS = new Set(['в', 'во', 'на', 'из', 'по', 'для', 'у']);

function normalizeComparableCity(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]/gi, '')
    .trim();
}

function tokenizeMessage(message = '') {
  return String(message || '')
    .replace(/[.,!?;:()[\]{}"«»'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean);
}

export function areSameRussianCity(left, right) {
  if (!left || !right) {
    return false;
  }

  const normalizedLeft = normalizeComparableCity(normalizeCityButton(left));
  const normalizedRight = normalizeComparableCity(normalizeCityButton(right));

  return Boolean(normalizedLeft) && normalizedLeft === normalizedRight;
}

export function extractExplicitRussianCityFromMessage(message) {
  if (!message || typeof message !== 'string') {
    return null;
  }

  const tokens = tokenizeMessage(message);
  if (tokens.length === 0) {
    return null;
  }

  for (let size = Math.min(MAX_CITY_TOKENS, tokens.length); size >= 1; size -= 1) {
    for (let index = 0; index <= tokens.length - size; index += 1) {
      const isWholeMessage = index === 0 && size === tokens.length;
      const previousToken = index > 0 ? normalizeComparableCity(tokens[index - 1]) : '';
      const hasLocationContext = LOCATION_PREPOSITIONS.has(previousToken);

      if (!isWholeMessage && !hasLocationContext) {
        continue;
      }

      const candidate = tokens
        .slice(index, index + size)
        .join(' ')
        .trim();
      if (candidate.length < 3) {
        continue;
      }

      if (!isRussianCity(candidate)) {
        continue;
      }

      return normalizeCityButton(candidate);
    }
  }

  return null;
}
