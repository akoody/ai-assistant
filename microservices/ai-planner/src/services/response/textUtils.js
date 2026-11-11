function normalizeComplaintText(text = '') {
  return String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^а-я0-9\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hashToIndex(value, modulo) {
  if (!modulo || modulo <= 0) return 0;
  const text = String(value ?? '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash % modulo;
}

function pickVariant(list, seed) {
  const items = Array.isArray(list) ? list : [];
  if (items.length === 0) return '';

  const deterministic = process.env.DETERMINISTIC_OFFTOPIC_REDIRECT === '1';
  if (deterministic) {
    return items[hashToIndex(seed, items.length)] || items[0];
  }

  const randomIndex = Math.floor(Math.random() * items.length);
  const mixedIndex = (hashToIndex(seed, items.length) + randomIndex) % items.length;
  return items[mixedIndex] || items[0];
}

function normalizeClarificationTextForMatch(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeText(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.toLowerCase().replace(/ё/g, 'е').trim();
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function asksForCityClarification(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return false;
  }
  return (
    /(в каком городе|каком городе)/u.test(normalized) ||
    /(укажите|укажи|укажете)\s+город/u.test(normalized) ||
    /выберите\s+город/u.test(normalized) ||
    /(какой|в какой)\s+город/u.test(normalized)
  );
}

export {
  normalizeComplaintText,
  hashToIndex,
  pickVariant,
  normalizeClarificationTextForMatch,
  normalizeText,
  escapeRegExp,
  asksForCityClarification,
};
