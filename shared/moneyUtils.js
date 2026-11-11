const THOUSAND_UNIT_REGEX =
  /^(?:к|k|тыс(?:\.|яч(?:а|и)?)?|тыщ(?:а|и)?|тысяча|тысячи|тысяч|косар(?:ь|я|ей)?)$/u;

function escapeRegExp(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeMoneyText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseGroupedDigits(value = '') {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  if (!digits) return null;
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseNumberToken(value = '') {
  const normalized = String(value || '')
    .replace(/\s+/g, '')
    .replace(',', '.')
    .trim();
  if (!normalized) return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function scaleWithUnit(rawNumber = '', rawUnit = '') {
  const parsedNumber = parseNumberToken(rawNumber);
  if (!parsedNumber) return null;

  const normalizedUnit = normalizeMoneyText(rawUnit).replace(/\s+/g, '');
  if (THOUSAND_UNIT_REGEX.test(normalizedUnit)) {
    return Math.round(parsedNumber * 1000);
  }

  return null;
}

function extractAmountWithUnit(text = '') {
  const normalized = normalizeMoneyText(text);
  if (!normalized) return null;

  const match = normalized.match(
    /(?:^|[^\d])(\d+(?:[.,]\d+)?)\s*(к|k|тыс(?:\.|яч(?:а|и)?)?|тыщ(?:а|и)?|тысяча|тысячи|тысяч|косар(?:ь|я|ей)?)(?=$|[^\p{L}\p{N}])/u
  );
  if (!match) return null;

  return scaleWithUnit(match[1], match[2]);
}

function extractPlainAmount(text = '') {
  const normalized = normalizeMoneyText(text);
  if (!normalized) return null;

  if (/^\d{1,3}(?:[ .,\u00a0]\d{3})+(?:\s*(?:р|руб(?:\.|ля|лей)?|₽))?$/u.test(normalized)) {
    return parseGroupedDigits(normalized);
  }

  if (/^\d+(?:\s*(?:р|руб(?:\.|ля|лей)?|₽))?$/u.test(normalized)) {
    return parseGroupedDigits(normalized);
  }

  return null;
}

function inferUnitScaledValueFromSource(rawValue = '', sourceText = '') {
  const normalizedValue = normalizeMoneyText(rawValue);
  const normalizedSource = normalizeMoneyText(sourceText);
  if (!normalizedValue || !normalizedSource) return null;
  if (!/^\d+(?:[.,]\d+)?$/u.test(normalizedValue)) return null;

  const tokenPattern = escapeRegExp(normalizedValue).replace(',', '[,.]');
  const match = normalizedSource.match(
    new RegExp(
      `(?:^|[^\\d])(${tokenPattern})\\s*(к|k|тыс(?:\\.|яч(?:а|и)?)?|тыщ(?:а|и)?|тысяча|тысячи|тысяч|косар(?:ь|я|ей)?)(?=$|[^\\p{L}\\p{N}])`,
      'u'
    )
  );

  if (!match) return null;
  return scaleWithUnit(match[1], match[2]);
}

export function parseBudgetValue(rawValue = '', options = {}) {
  const sourceText = typeof options?.sourceText === 'string' ? options.sourceText : '';
  const normalizedValue = normalizeMoneyText(rawValue);
  if (!normalizedValue) return null;

  const directWithUnit = extractAmountWithUnit(normalizedValue);
  if (directWithUnit) {
    return directWithUnit;
  }

  const plainAmount = extractPlainAmount(normalizedValue);
  if (plainAmount) {
    const inferredFromSource = inferUnitScaledValueFromSource(normalizedValue, sourceText);
    return inferredFromSource || plainAmount;
  }

  if (sourceText) {
    const amountFromSource = extractAmountWithUnit(sourceText);
    if (amountFromSource) {
      return amountFromSource;
    }
  }

  return null;
}
