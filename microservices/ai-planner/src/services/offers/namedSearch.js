function normalizeComparableSearchText(value) {
  const source = String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е');
  return source
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function transliterateRuToLatin(value) {
  const map = {
    а: 'a',
    б: 'b',
    в: 'v',
    г: 'g',
    д: 'd',
    е: 'e',
    ж: 'zh',
    з: 'z',
    и: 'i',
    й: 'y',
    к: 'k',
    л: 'l',
    м: 'm',
    н: 'n',
    о: 'o',
    п: 'p',
    р: 'r',
    с: 's',
    т: 't',
    у: 'u',
    ф: 'f',
    х: 'h',
    ц: 'ts',
    ч: 'ch',
    ш: 'sh',
    щ: 'sch',
    ъ: '',
    ы: 'y',
    ь: '',
    э: 'e',
    ю: 'yu',
    я: 'ya',
  };

  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split('')
    .map((char) => map[char] ?? char)
    .join('');
}

function addArtistAliasVariant(collection, seen, candidate) {
  const normalized = normalizeComparableSearchText(candidate);
  if (!normalized || seen.has(normalized)) {
    return;
  }

  seen.add(normalized);
  collection.push(normalized);
}

function buildCompactArtistAliasVariants(value) {
  const base = normalizeComparableSearchText(value);
  if (!base) {
    return [];
  }

  const queue = [base];
  const variants = [];
  const seen = new Set();

  while (queue.length > 0 && variants.length < 24) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    addArtistAliasVariant(variants, seen, current);

    const compactCurrent = current.replace(/\s+/g, '');
    addArtistAliasVariant(variants, seen, compactCurrent);

    const nextCandidates = [];

    if (/^h[a-z]/.test(compactCurrent)) {
      nextCandidates.push(`x${compactCurrent.slice(1)}`);
    }

    if (/^x[a-z]/.test(compactCurrent)) {
      nextCandidates.push(`h${compactCurrent.slice(1)}`);
    }

    if (compactCurrent.includes('ey')) {
      nextCandidates.push(compactCurrent.replace(/ey/g, 'ay'));
    }

    if (compactCurrent.includes('ay')) {
      nextCandidates.push(compactCurrent.replace(/ay/g, 'ey'));
    }

    if (compactCurrent.includes('ei')) {
      nextCandidates.push(compactCurrent.replace(/ei/g, 'ay'));
    }

    if (compactCurrent.includes('iy')) {
      nextCandidates.push(compactCurrent.replace(/iy/g, 'y'));
    }

    if (compactCurrent.includes('yy')) {
      nextCandidates.push(compactCurrent.replace(/yy/g, 'y'));
    }

    nextCandidates.forEach((candidate) => {
      const normalizedCandidate = normalizeComparableSearchText(candidate);
      if (normalizedCandidate && !seen.has(normalizedCandidate)) {
        queue.push(normalizedCandidate);
      }
    });
  }

  return variants;
}

function isSingleWordArtistCandidate(value) {
  const normalized = normalizeComparableSearchText(value);
  return Boolean(normalized) && !normalized.includes(' ') && normalized.length >= 3;
}

function buildArtistSearchVariants(value) {
  const raw = normalizeComparableSearchText(value);
  if (!isSingleWordArtistCandidate(raw)) {
    return [raw].filter(Boolean);
  }

  const variants = [];
  const seen = new Set();
  const push = (candidate) => {
    const normalized = normalizeComparableSearchText(candidate);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    variants.push(normalized);
  };

  push(raw);

  if (raw.length >= 4 && /[ую]$/u.test(raw)) {
    push(`${raw.slice(0, -1)}а`);
    push(raw.slice(0, -1));
  } else if (raw.length >= 4 && /[ыи]$/u.test(raw)) {
    push(`${raw.slice(0, -1)}а`);
    push(raw.slice(0, -1));
  } else if (raw.length >= 4 && /[ая]$/u.test(raw)) {
    push(raw.slice(0, -1));
  }

  return variants;
}

function buildEventSearchBlobs(event) {
  const parts = [event?.title, event?.activityTitle, event?.description]
    .map((part) => normalizeComparableSearchText(part))
    .filter(Boolean);

  const transliteratedParts = parts
    .map((part) => normalizeComparableSearchText(transliterateRuToLatin(part)))
    .filter(Boolean);

  return [...new Set([...parts, ...transliteratedParts])];
}

function buildEventArtistAliasBlobs(event) {
  const blobs = buildEventSearchBlobs(event);
  const variants = [];
  const seen = new Set();

  blobs.forEach((blob) => {
    buildCompactArtistAliasVariants(blob).forEach((variant) => {
      addArtistAliasVariant(variants, seen, variant);
    });
  });

  return variants;
}

function hasWholeWordSequenceMatch(blob, variant) {
  const normalizedBlob = normalizeComparableSearchText(blob);
  const normalizedVariant = normalizeComparableSearchText(variant);
  if (!normalizedBlob || !normalizedVariant) {
    return false;
  }

  const blobWords = normalizedBlob.split(' ').filter(Boolean);
  const variantWords = normalizedVariant.split(' ').filter(Boolean);
  if (blobWords.length === 0 || variantWords.length === 0) {
    return false;
  }

  if (variantWords.length === 1) {
    return blobWords.includes(variantWords[0]);
  }

  for (let index = 0; index <= blobWords.length - variantWords.length; index += 1) {
    let matched = true;
    for (let offset = 0; offset < variantWords.length; offset += 1) {
      if (blobWords[index + offset] !== variantWords[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return true;
    }
  }

  return false;
}

function getStrictSearchMatchScore(event, specificSearchQuery, options = {}) {
  const { allowArtistRelaxedMatch = false, allowVenueMatch = false } = options;
  const normalizedQuery = normalizeComparableSearchText(specificSearchQuery);
  if (!normalizedQuery) {
    return 0;
  }

  const normalizedTitle = normalizeComparableSearchText(event?.title);
  const normalizedDescription = normalizeComparableSearchText(event?.description);
  const normalizedVenue = normalizeComparableSearchText(event?.venue);
  const queryWords = normalizedQuery.split(/\s+/).filter((word) => word.length > 1);

  if (allowArtistRelaxedMatch) {
    if (hasWholeWordSequenceMatch(normalizedTitle, normalizedQuery)) {
      return 50;
    }

    if (hasWholeWordSequenceMatch(normalizedDescription, normalizedQuery)) {
      return 10;
    }
  } else {
    if (normalizedTitle.includes(normalizedQuery)) {
      return 50;
    }

    if (queryWords.length > 0 && queryWords.every((word) => normalizedTitle.includes(word))) {
      return 40;
    }

    if (normalizedDescription.includes(normalizedQuery)) {
      return 10;
    }

    if (allowVenueMatch) {
      if (normalizedVenue.includes(normalizedQuery)) {
        return 35;
      }

      if (queryWords.length > 0 && queryWords.every((word) => normalizedVenue.includes(word))) {
        return 25;
      }
    }
  }

  if (!allowArtistRelaxedMatch) {
    return 0;
  }

  const eventBlobs = buildEventSearchBlobs(event);
  const queryVariants = buildArtistSearchVariants(normalizedQuery)
    .flatMap((variant) => [variant, normalizeComparableSearchText(transliterateRuToLatin(variant))])
    .filter(Boolean);

  for (const variant of queryVariants) {
    for (const blob of eventBlobs) {
      if (hasWholeWordSequenceMatch(blob, variant)) {
        return 45;
      }
    }
  }

  const compactQueryVariants = queryVariants.flatMap((variant) =>
    buildCompactArtistAliasVariants(variant)
  );
  const compactEventBlobs = buildEventArtistAliasBlobs(event);

  for (const variant of compactQueryVariants) {
    for (const blob of compactEventBlobs) {
      if (variant === blob) {
        return 45;
      }
    }
  }

  return 0;
}

function shouldTrustSingleNamedSearchResult({
  finalScoredEvents = [],
  strictSearchSource = null,
  specificSearchQuery = '',
} = {}) {
  if (!Array.isArray(finalScoredEvents) || finalScoredEvents.length !== 1) {
    return false;
  }

  if (strictSearchSource !== 'artist' && strictSearchSource !== 'event_name') {
    return false;
  }

  const normalizedQuery = normalizeComparableSearchText(specificSearchQuery);
  if (!normalizedQuery || normalizedQuery.length < 4) {
    return false;
  }

  const queryWords = normalizedQuery.split(/\s+/).filter(Boolean);
  if (queryWords.length > 3) {
    return false;
  }

  return true;
}

function getSlotsForRanking(slots, searchResolution = null) {
  const safeSlots = Array.isArray(slots) ? [...slots] : [];
  if (!searchResolution?.strictQuerySuppressed || !searchResolution?.strictSource) {
    return safeSlots;
  }

  const slotNamesToRemove =
    searchResolution.strictSource === 'artist'
      ? new Set(['исполнитель', 'артист'])
      : new Set(['название_мероприятия']);

  const filteredSlots = safeSlots.filter((slot) => !slotNamesToRemove.has(slot?.name));
  console.log(
    `🧭 [offerService] Для ранжирования отключаю строгий слот ${searchResolution.strictSource} ` +
      `("${searchResolution.strictValue || ''}") because ${searchResolution.suppressionReason || 'unknown'}`
  );
  return filteredSlots;
}

export { getStrictSearchMatchScore, shouldTrustSingleNamedSearchResult, getSlotsForRanking };
