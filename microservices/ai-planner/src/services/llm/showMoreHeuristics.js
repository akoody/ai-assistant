function normalizeText(value) {
  if (typeof value !== 'string') return '';
  return value.toLowerCase().replace(/ё/g, 'е').trim();
}

function tokenize(text) {
  const compact = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!compact) return [];
  return compact.split(' ').filter(Boolean);
}

export function looksLikeShowMoreRequestText(userMessage) {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;

  const compact = normalized.replace(/\s+/g, ' ').trim();
  const tokens = tokenize(compact);

  if (
    compact === 'еще' ||
    compact === 'ещё' ||
    compact === 'а еще' ||
    compact === 'а ещё' ||
    compact === 'и еще' ||
    compact === 'и ещё'
  ) {
    return true;
  }

  if (compact === 'показать другие варианты') return true;

  if (compact === 'а еще что' || compact === 'а ещё что') return true;
  if (compact === 'еще что' || compact === 'ещё что') return true;
  if (compact === 'что еще' || compact === 'что ещё') return true;
  if (compact === 'что еще есть' || compact === 'что ещё есть') return true;

  const allowedTail = new Set([
    'что',
    'вариант',
    'варианты',
    'события',
    'событие',
    'мероприятия',
    'мероприятие',
    'концерт',
    'концерты',
    'спектакль',
    'спектакли',
    'матч',
    'матчи',
    'игра',
    'игры',
  ]);

  if (tokens.length >= 2 && (tokens[0] === 'еще' || tokens[0] === 'ещё')) {
    if (tokens.length <= 3 && allowedTail.has(tokens[1])) return true;
  }
  if (tokens.length >= 3 && tokens[0] === 'а' && (tokens[1] === 'еще' || tokens[1] === 'ещё')) {
    if (tokens.length <= 4 && allowedTail.has(tokens[2])) return true;
  }

  if (
    /(?:^|\s)друг(?:ие|ой|ую)\s+(?:вариант|событи|мероприят|концерт|спектакл|матч|игр)/u.test(
      compact
    )
  ) {
    return true;
  }

  if (/(?:^|\s)(покажи|показать)\s+ещ[её](?:\s|$)/u.test(compact)) return true;
  if (
    /(?:^|\s)ещ[её]\s+(?:вариант|событи|мероприят|концерт|спектакл|матч|игр)(?:\s|$)/u.test(compact)
  )
    return true;

  if (/^(?:дальше|далее|продолжай|следующие)(?:\s|$)/u.test(compact)) return true;

  return false;
}
