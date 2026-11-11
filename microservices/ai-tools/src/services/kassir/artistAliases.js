function isSingleWordArtistCandidate(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!normalized || normalized.includes(' ')) {
    return false;
  }

  try {
    return /^[\p{L}\d-]{3,}$/u.test(normalized);
  } catch (_error) {
    return /^[A-Za-zА-Яа-яЁё0-9-]{3,}$/.test(normalized);
  }
}

function buildArtistKeywordFallbacks(value = '') {
  const raw = String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!isSingleWordArtistCandidate(raw)) {
    return [];
  }

  const normalized = raw.toLowerCase().replace(/ё/g, 'е');
  const variants = [];
  const addVariant = (candidate, label) => {
    const keyword = String(candidate || '').trim();
    if (!keyword || keyword.toLowerCase() === raw.toLowerCase()) {
      return;
    }
    if (variants.some((item) => item.keyword.toLowerCase() === keyword.toLowerCase())) {
      return;
    }
    variants.push({ keyword, label });
  };

  if (normalized.length >= 4 && /[ыи]$/u.test(normalized)) {
    addVariant(`${raw.slice(0, -1)}а`, 'artist-form-nominative');
    addVariant(raw.slice(0, -1), 'artist-form-stem');
    return variants;
  }

  if (normalized.length >= 4 && /[ую]$/u.test(normalized)) {
    addVariant(`${raw.slice(0, -1)}а`, 'artist-form-nominative');
    addVariant(raw.slice(0, -1), 'artist-form-stem');
    return variants;
  }

  if (normalized.length >= 4 && /[ая]$/u.test(normalized)) {
    addVariant(raw.slice(0, -1), 'artist-form-stem');
  }

  return variants;
}

export { buildArtistKeywordFallbacks };
