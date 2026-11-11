const ARTIST_ROLE_PATTERN =
  /(^|[^\p{L}\p{N}_])(?:артист|исполнитель|певец|певица|музыкант|группа|коллектив|звезда)(?=$|[^\p{L}\p{N}_])/u;
const BARE_ARTIST_ROLE_PATTERN =
  /^(?:артист|исполнитель|певец|певица|музыкант|группа|коллектив|звезда)$/u;
const VAGUE_ARTIST_DESCRIPTOR_PATTERN =
  /(^|[^\p{L}\p{N}_])(?:популярн\p{L}*|известн\p{L}*|знаменит\p{L}*|модн\p{L}*|топов\p{L}*|крут\p{L}*|хайпов\p{L}*|нашумевш\p{L}*|какой(?:-|\s)?то|какой(?:-|\s)?нибудь|кто(?:-|\s)?то|кто(?:-|\s)?нибудь|любой|любая|любое)(?=$|[^\p{L}\p{N}_])/u;
const UNKNOWN_ARTIST_PATTERN =
  /(^|[^\p{L}\p{N}_])(?:не\s+помню|не\s+знаю)\s+(?:кто|кого|имя|имени|название)(?=$|[^\p{L}\p{N}_])/u;
const ARTIST_ARRIVAL_PATTERN =
  /(?:приед\p{L}*|приезж\p{L}*|будет|ожида\p{L}*|выступ\p{L}*|гастрол\p{L}*|должен\s+приехать)/u;
const UNKNOWN_ARTIST_DISCOVERY_PATTERN =
  /(?:кто\s+(?:приед\p{L}*|приезж\p{L}*|будет|выступ\p{L}*)|не\s+помню\s+кто|не\s+знаю\s+кто)/u;

export function normalizeVagueArtistText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'`]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function isVagueArtistDescriptor(value = '') {
  const normalized = normalizeVagueArtistText(value);
  if (!normalized) {
    return false;
  }

  if (BARE_ARTIST_ROLE_PATTERN.test(normalized)) {
    return true;
  }

  if (UNKNOWN_ARTIST_PATTERN.test(normalized)) {
    return true;
  }

  return ARTIST_ROLE_PATTERN.test(normalized) && VAGUE_ARTIST_DESCRIPTOR_PATTERN.test(normalized);
}

export function looksLikeUnknownArtistDiscoveryText(value = '') {
  const normalized = normalizeVagueArtistText(value);
  if (!normalized) {
    return false;
  }

  const hasArtistRole = ARTIST_ROLE_PATTERN.test(normalized);
  const hasArrivalSignal = ARTIST_ARRIVAL_PATTERN.test(normalized);
  const hasUnknownArtistSignal =
    UNKNOWN_ARTIST_PATTERN.test(normalized) ||
    VAGUE_ARTIST_DESCRIPTOR_PATTERN.test(normalized) ||
    UNKNOWN_ARTIST_DISCOVERY_PATTERN.test(normalized);

  return hasArtistRole && hasArrivalSignal && hasUnknownArtistSignal;
}
