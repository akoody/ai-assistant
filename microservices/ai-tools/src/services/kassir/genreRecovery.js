import { RAP_POSITIVE_MARKERS, SHORT_GENRE_TOKEN_MAP } from './keywordPolicy.js';
import {
  buildEventTextBlob,
  applyRapNegativeFilter,
  hasGenreTokenMatch,
  applyShortGenreTokenFilter,
  applyMusicNonConcertNegativeFilter,
} from './eventFilters.js';
import { buildSignatureFromApiItem } from './eventIdentity.js';

function applyRapRescueFilter(items) {
  const cleaned = applyRapNegativeFilter(items);
  if (!Array.isArray(cleaned) || cleaned.length === 0) {
    return cleaned;
  }
  return cleaned.filter((item) => {
    const blob = buildEventTextBlob(item);
    return RAP_POSITIVE_MARKERS.some((marker) => blob.includes(marker));
  });
}

function scoreRapCandidate(item) {
  const blob = buildEventTextBlob(item);
  if (!blob) {
    return 0;
  }
  const hasPositive = RAP_POSITIVE_MARKERS.some((marker) => blob.includes(marker));
  const hasConcertish =
    blob.includes('концерт') ||
    blob.includes('сольный') ||
    blob.includes('live') ||
    blob.includes('band') ||
    blob.includes('тур') ||
    blob.includes('show');
  return (hasPositive ? 10 : 0) + (hasConcertish ? 3 : 0);
}

function scoreShortGenreCandidate(item, detectedShortGenre) {
  const obj = item?.object || item || {};
  const activity = obj.activity || {};
  const titleBlob = `${obj.title || ''} ${activity.title || ''}`.toLowerCase();
  const descriptionBlob =
    `${obj.description || ''} ${activity.description || ''} ${activity.techDescription || ''}`.toLowerCase();
  const blob = buildEventTextBlob(item);
  const tokens = SHORT_GENRE_TOKEN_MAP[detectedShortGenre] || [detectedShortGenre];

  let score = 0;

  if (tokens.some((token) => hasGenreTokenMatch(titleBlob, token))) {
    score += 12;
  }

  if (tokens.some((token) => hasGenreTokenMatch(descriptionBlob, token))) {
    score += 6;
  }

  if (tokens.some((token) => hasGenreTokenMatch(blob, token))) {
    score += 4;
  }

  if (/(концерт|live|show|tour|фестиваль|band|группа|music|музык)/iu.test(blob)) {
    score += 3;
  }

  return score;
}

function backfillShortGenreResults({
  filteredItems = [],
  baseCandidates = [],
  detectedShortGenre,
  minDesired = 5,
}) {
  if (!Array.isArray(filteredItems) || filteredItems.length === 0) {
    return { items: filteredItems, added: 0 };
  }

  if (
    !Array.isArray(baseCandidates) ||
    baseCandidates.length === 0 ||
    filteredItems.length >= minDesired
  ) {
    return { items: filteredItems, added: 0 };
  }

  const cleanedPool = applyMusicNonConcertNegativeFilter(baseCandidates);
  const tokenMatchedPool = applyShortGenreTokenFilter(cleanedPool, detectedShortGenre);
  const pool = tokenMatchedPool.length > 0 ? tokenMatchedPool : cleanedPool;
  const originalOrder = new Map(baseCandidates.map((item, index) => [item, index]));
  const existingIds = new Set();
  const existingSignatures = new Set();

  filteredItems.forEach((item) => {
    const idCandidate =
      item?.object?.id ?? item?.id ?? item?.object?.backofficeId ?? item?.object?.activity?.id;
    const idKey = idCandidate === null || idCandidate === undefined ? null : String(idCandidate);
    const signature = buildSignatureFromApiItem(item);
    if (idKey) {
      existingIds.add(idKey);
    }
    if (signature) {
      existingSignatures.add(signature);
    }
  });

  const result = filteredItems.slice();
  const sortedPool = pool.slice().sort((a, b) => {
    const scoreDiff =
      scoreShortGenreCandidate(b, detectedShortGenre) -
      scoreShortGenreCandidate(a, detectedShortGenre);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    return (
      (originalOrder.get(a) ?? Number.MAX_SAFE_INTEGER) -
      (originalOrder.get(b) ?? Number.MAX_SAFE_INTEGER)
    );
  });

  let added = 0;

  for (const item of sortedPool) {
    if (result.length >= minDesired) {
      break;
    }

    const idCandidate =
      item?.object?.id ?? item?.id ?? item?.object?.backofficeId ?? item?.object?.activity?.id;
    const idKey = idCandidate === null || idCandidate === undefined ? null : String(idCandidate);
    const signature = buildSignatureFromApiItem(item);

    if ((idKey && existingIds.has(idKey)) || (signature && existingSignatures.has(signature))) {
      continue;
    }

    result.push(item);
    if (idKey) {
      existingIds.add(idKey);
    }
    if (signature) {
      existingSignatures.add(signature);
    }
    added += 1;
  }

  return { items: result, added };
}

export { applyRapRescueFilter, scoreRapCandidate, backfillShortGenreResults };
