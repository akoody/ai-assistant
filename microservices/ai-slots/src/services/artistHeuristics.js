import { isVagueArtistDescriptor } from '../../../../shared/vagueArtistUtils.js';
import { isKnownEventTaxonomyValue } from '../../../../shared/eventTaxonomy.js';
import { looksLikePreferenceMemoryReferenceText } from '../../../../shared/preferenceRules.js';

const ARTIST_SLOT_NAMES = new Set(['исполнитель', 'артист']);
const EVENT_TYPE_SLOT_NAMES = new Set(['тип_мероприятия', 'тип_события', 'категория']);
const GENRE_SLOT_NAMES = new Set(['жанр', 'жанр_музыки', 'предпочтения_жанры']);

const ARTIST_TRIGGER_PATTERNS = [
  /(?:^|[^\p{L}\p{N}])(?:хочу|хотим|ищу|ищем|жду|люблю)\s+на\s+(.+)$/iu,
  /(?:^|[^\p{L}\p{N}])(?:билет(?:ы)?|билеты)\s+на\s+(.+)$/iu,
  /(?:^|[^\p{L}\p{N}])(?:концерт|выступление|шоу)\s+(.+)$/iu,
];

const EXPLICIT_GENRE_PATTERNS = [
  /(?:^|[^\p{L}\p{N}])поп(?:$|[^\p{L}\p{N}])/u,
  /(?:^|[^\p{L}\p{N}])рок(?:$|[^\p{L}\p{N}])/u,
  /рокчик/u,
  /рокешник/u,
  /джаз/u,
  /джазик/u,
  /джазок/u,
  /рэп/u,
  /рэпчик/u,
  /репчик/u,
  /хип[\s-]?хоп/u,
  /электрон/u,
  /электроник/u,
  /электронк/u,
  /классик/u,
  /шансон/u,
  /блюз/u,
  /фолк/u,
  /панк/u,
  /инди/u,
  /метал/u,
  /техно/u,
  /house/u,
  /dance/u,
  /(?:^|[^\p{L}\p{N}])тан(?:е|ц)(?:ц|цы)?(?:$|[^\p{L}\p{N}])/u,
  /танцев/u,
];

const EVENT_TYPE_PATTERNS = [
  /^(?:концерт|концерты|театр|театры|спектакль|спектакли|выставка|выставки|музей|музеи|стендап|шоу|кино|фильм|фильмы|спорт|матч|матчи|экскурсия|экскурсии)$/u,
  /^(?:опер|балет|мюзикл|драм|комед|трагед|фарс|пьес)/u,
];

const CATEGORY_OR_GENRE_PATTERNS = [
  /^(?:концерт|концерты|выступлен|живая\s+музыка|творческ.*вечер)/u,
  /^(?:рок|pop|поп|джаз|jazz|фолк|шансон|романс|авторск|бард|рэп|реп|хип[\s-]?хоп|трэп|trap|электрон|электроник|edm|техно|techno|house|хаус|метал|metal|хэви|heavy|instrumental|инструментальн|классик|симфон|академическ)/u,
  /^(?:театр|театральн|спектакл|пьес|постановк|опера|оперн|балет|балетн|мюзикл|драм|комед|трагикомед|мелодрам|сказк|иммерсив|моноспект|танец|танцы|танцев|цирк|цирков|клоунад|гастрол)/u,
  /^(?:выставк|экспозиц|галере|музе)/u,
  /^(?:ст[еэ]ндап|stand[\s-]*up|юмор|юморист)/u,
  /^(?:шоу|show|представлен|перформанс)/u,
  /^(?:кино|фильм|сеанс)/u,
  /^(?:спорт|матч|соревн|турнир|игр)/u,
  /^(?:квест|escape\s*room)/u,
  /^(?:экскурс|турист|тур|прогулк)/u,
  /^(?:фестив|open\s*air|опен[\s-]?эйр)/u,
  /^(?:детск|детям|для\s+детей|ребен|ребён|малыш)/u,
  /^(?:образован|обучен|лекци|семинар)/u,
  /^(?:распродаж|скидк|акци)/u,
];

const GENERIC_PERFORMER_ROLE_PATTERNS = [
  /^(?:иллюзионист|иллюзионист\p{L}*)$/u,
  /^(?:фокусник|фокусник\p{L}*)$/u,
  /^(?:клоун|клоун\p{L}*)$/u,
  /^(?:аниматор|аниматор\p{L}*)$/u,
];

const GENERIC_MUSIC_NOUN_PATTERNS = [
  /^(?:песн(?:я|и|ей|ям|ями|ях)?|музык(?:а|и|у|ой|е)|мелоди(?:я|и|ю|ей|ях)|хит(?:ы|ов|ам|ами|ах)?|трек(?:и|ов|ам|ами|ах)?|саундтрек(?:и|ов|ам|ами|ах)?|композиц(?:ия|ии|ию|ией|иях))$/u,
];

const NON_ARTIST_PATTERNS = [
  /^(?:не\s+указан[аоы]?|неизвестно|unknown|undefined|null|none|n\/a)$/u,
  /^(?:сегодня|завтра|послезавтра|выходные|на\s+выходных|утром|днем|днём|вечером|ночью)$/u,
  /^(?:следующ(?:ие|их|им)\s+выходн(?:ые|ых|ым)|будущ(?:ие|их|им)\s+выходн(?:ые|ых|ым)|ближайш(?:ие|их|им)\s+выходн(?:ые|ых|ым))$/u,
  /^(?:следующ\p{L}*|будущ\p{L}*|ближайш\p{L}*)$/u,
  /^(?:любой|любая|любое|покажи\s+все|покажи\s+всё|все|всё)$/u,
  /^(?:какой(?:-|\s)?нибудь|какая(?:-|\s)?нибудь|какое(?:-|\s)?нибудь|что(?:-|\s)?нибудь|куда(?:-|\s)?нибудь|какой(?:-|\s)?то|какая(?:-|\s)?то|какое(?:-|\s)?то|что(?:-|\s)?то)$/u,
  /^(?:до\s*)?\d[\d\s]*(?:₽|р|руб)?$/u,
  /^(?:за|до|от)\s+\d[\d\s]*(?:₽|р|руб(?:\.|ля|лей)?)?$/u,
  /^(?:бесплатно|без\s+денег|не\s+важно)$/u,
  // Локационные фразы (в т.ч. многословные города) не являются именем исполнителя.
  /^(?:в|во|на|по|под|около|возле|из)\s+[\p{L}\d-]+(?:\s+[\p{L}\d-]+){0,2}$/iu,
];

const BUDGET_CANDIDATE_PATTERNS = [
  /(?:^|\s)(?:за|до|от|не\s+дороже|не\s+больше|не\s+выше|максимум|max|минимум)\s+\d/u,
  /(?:^|\s)(?:подешевле|дешевле|недорог|бюджетн)(?![A-Za-zА-Яа-яЁё0-9_])/u,
  /\d+(?:[.,]\d+)?\s*(?:к|k|тыс\.?|тыщ|тысяч(?:а|и)?|тысяча|тысячи|₽|р(?![A-Za-zА-Яа-яЁё0-9_])|руб(?:\.|ля|лей)?)(?:(?<=[A-Za-zА-Яа-яЁё0-9_])(?![A-Za-zА-Яа-яЁё0-9_])|(?<![A-Za-zА-Яа-яЁё0-9_])(?=[A-Za-zА-Яа-яЁё0-9_]))/u,
];

const WEEKDAY_PATTERNS = [
  /(?:^|[^\p{L}\p{N}])(?:понедельник|понедельника|понедельнику|понедельником|понедельнике)(?:$|[^\p{L}\p{N}])/u,
  /(?:^|[^\p{L}\p{N}])(?:вторник|вторника|вторнику|вторником|вторнике)(?:$|[^\p{L}\p{N}])/u,
  /(?:^|[^\p{L}\p{N}])(?:среда|среду|среды|среде|средой)(?:$|[^\p{L}\p{N}])/u,
  /(?:^|[^\p{L}\p{N}])(?:четверг|четверга|четвергу|четвергом|четверге)(?:$|[^\p{L}\p{N}])/u,
  /(?:^|[^\p{L}\p{N}])(?:пятница|пятницу|пятницы|пятнице|пятницей)(?:$|[^\p{L}\p{N}])/u,
  /(?:^|[^\p{L}\p{N}])(?:суббота|субботу|субботы|субботе|субботой)(?:$|[^\p{L}\p{N}])/u,
  /(?:^|[^\p{L}\p{N}])(?:воскресенье|воскресенья|воскресенью|воскресеньем|воскресенье)(?:$|[^\p{L}\p{N}])/u,
];

const RELATIVE_DATE_PATTERNS = [
  /(?:^|[^\p{L}\p{N}])(?:сегодня|завтра|послезавтра|вчера|позавчера)(?:$|[^\p{L}\p{N}])/u,
  /(?:^|[^\p{L}\p{N}])(?:на\s+выходных|выходные|будни|на\s+неделе|на\s+этой\s+неделе|на\s+следующей\s+неделе)(?:$|[^\p{L}\p{N}])/u,
  /(?:^|[^\p{L}\p{N}])(?:(?:на\s+)?(?:следующ(?:ие|их|им)|будущ(?:ие|их|им)|ближайш(?:ие|их|им)|этих?)\s+выходн(?:ые|ых|ым))(?:$|[^\p{L}\p{N}])/u,
  /(?:^|[^\p{L}\p{N}])(?:в\s+начале\s+недели|в\s+конце\s+недели|в\s+ближайшие\s+дни)(?:$|[^\p{L}\p{N}])/u,
  /(?:^|[^\p{L}\p{N}])(?:утром|днем|днём|вечером|ночью)(?:$|[^\p{L}\p{N}])/u,
  /(?:^|[^\p{L}\p{N}])(?:через|спустя)\s+\d{1,2}\s*(?:дн(?:я|ей)?|сут(?:ки|ок)?|недел(?:ю|и|ь)|месяц(?:а|ев)?|год(?:а|ов)?|час(?:а|ов)?)(?:$|[^\p{L}\p{N}])/u,
  /(?:^|[^\p{L}\p{N}])(?:через|спустя)\s+(?:один|одну|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять)\s+(?:день|дня|дней|неделю|недели|месяц|месяца|месяцев|год|года|лет)(?:$|[^\p{L}\p{N}])/u,
  /(?:^|[^\p{L}\p{N}])(?:через|спустя)\s+(?:неделю|месяц|год)(?:$|[^\p{L}\p{N}])/u,
];

const MONTH_NAME_PATTERNS = [
  /(?:^|[^\p{L}\p{N}])\d{1,2}(?:\s*[-–]\s*\d{1,2})?\s*(?:январ(?:я|е)|феврал(?:я|е)|март(?:а|е)?|апрел(?:я|е)|ма[йея]|июн(?:я|е)|июл(?:я|е)|август(?:а|е)?|сентябр(?:я|е)|октябр(?:я|е)|ноябр(?:я|е)|декабр(?:я|е))(?:$|[^\p{L}\p{N}])/u,
  /(?:^|[^\p{L}\p{N}])(?:январ(?:я|е)|феврал(?:я|е)|март(?:а|е)?|апрел(?:я|е)|ма[йея]|июн(?:я|е)|июл(?:я|е)|август(?:а|е)?|сентябр(?:я|е)|октябр(?:я|е)|ноябр(?:я|е)|декабр(?:я|е))\s+\d{1,2}(?:$|[^\p{L}\p{N}])/u,
  /(?:^|[^\p{L}\p{N}])(?:в|во|на)?\s*(?:январ(?:ь|я|е)|феврал(?:ь|я|е)|март(?:а|е)?|апрел(?:ь|я|е)|май|мая|мае|июн(?:ь|я|е)|июл(?:ь|я|е)|август(?:а|е)?|сентябр(?:ь|я|е)|октябр(?:ь|я|е)|ноябр(?:ь|я|е)|декабр(?:ь|я|е))(?:$|[^\p{L}\p{N}])/u,
];

const NUMERIC_DATE_PATTERNS = [
  /(?:^|[^\p{L}\p{N}])\d{1,2}\s*[./]\s*\d{1,2}(?:\s*[./]\s*\d{2,4})?(?:$|[^\p{L}\p{N}])/u,
  /(?:^|[^\p{L}\p{N}])\d{4}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{1,2}(?:$|[^\p{L}\p{N}])/u,
  /(?:^|[^\p{L}\p{N}])\d{1,2}\s*[-–]\s*\d{1,2}(?:\s*[./]\s*\d{1,2}(?:\s*[./]\s*\d{2,4})?)?(?:$|[^\p{L}\p{N}])/u,
];

const TIME_MARKER_PATTERNS = [
  /(?:^|[^\p{L}\p{N}])(?:в\s*)?\d{1,2}:\d{2}(?:$|[^\p{L}\p{N}])/u,
  /(?:^|[^\p{L}\p{N}])(?:в\s*)?\d{1,2}\s*час(?:а|ов)?(?:$|[^\p{L}\p{N}])/u,
];

const MOOD_PATTERNS = [
  /(?:^|[^\p{L}\p{N}])настроени(?:е|я|ю|ем|и)(?:$|[^\p{L}\p{N}])/u,
  /(?:^|[^\p{L}\p{N}])(?:романт|весел|весель|энергич|спокойн|интеллектуал|необыч|нов(?:ое|ый)|грустн|тоск)(?:$|[^\p{L}\p{N}])/u,
  /(?:^|[^\p{L}\p{N}])(?:развея|отвлеч|взбодр|повесел|посмея|рассмеш|расслаб|отдохн|выплесн(?:ить)?\s+энерг|драйв|движ|оторваться|проораться|поорать)(?:$|[^\p{L}\p{N}])/u,
];

const GENERIC_DISCOVERY_PATTERNS = [
  /(?:^|[^\p{L}\p{N}])(?:какой(?:-|\s)?нибудь|какая(?:-|\s)?нибудь|какое(?:-|\s)?нибудь|что(?:-|\s)?нибудь|куда(?:-|\s)?нибудь)(?:$|[^\p{L}\p{N}])/u,
  /(?:^|[^\p{L}\p{N}])(?:любой|любая|любое|что(?:-|\s)?то|как(?:-|\s)?то)(?:$|[^\p{L}\p{N}])/u,
];

const TRAILING_NON_ARTIST_CONTEXT_PATTERNS = [
  /\s+(?:сегодня|завтра|послезавтра|вчера|утром|днем|днём|вечером|ночью)$/iu,
  /\s+(?:(?:в|на)\s+)?(?:понедельник(?:а|у|ом|е)?|вторник(?:а|у|ом|е)?|сред(?:а|у|ы|е|ой)|четверг(?:а|у|ом|е)?|пятниц(?:а|у|ы|е|ой)|суббот(?:а|у|ы|е|ой)|воскресень(?:е|я|ю|ем))$/iu,
  /\s+(?:(?:на\s+)?(?:выходных?|ближайших\s+выходных?|этих?\s+выходных?|следующ(?:ие|их|им)\s+выходных?|будущ(?:ие|их|им)\s+выходных?))$/iu,
  /\s+(?:(?:на\s+)?(?:этой|эту|эта|следующей|следующую|следующая|будущей|будущую|будущая)\s+недел(?:е|ю|я))$/iu,
  /\s+(?:через|спустя)\s+(?:\d+|один|одна|одну|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять)\s+(?:день|дня|дней|неделю|недели|недель|месяц|месяца|месяцев|год|года|лет|час|часа|часов)$/iu,
  /\s+(?:через|спустя)\s+(?:неделю|месяц|год)$/iu,
  /\s+(?:в\s*)?\d{1,2}:\d{2}$/u,
  /\s+\d{1,2}\s*[./]\s*\d{1,2}(?:\s*[./]\s*\d{2,4})?$/u,
  /\s+\d{1,2}\s+(?:январ(?:я|е)|феврал(?:я|е)|март(?:а|е)?|апрел(?:я|е)|ма[йея]|июн(?:я|е)|июл(?:я|е)|август(?:а|е)?|сентябр(?:я|е)|октябр(?:я|е)|ноябр(?:я|е)|декабр(?:я|е))$/iu,
];

const LOCATION_MARKER_PATTERNS = [
  /(?<![A-Za-zА-Яа-яЁё0-9_])(?:москв\p{L}*|питер\p{L}*|спб|с-пб|санкт[\s-]?петербург\p{L}*)(?:(?<=[A-Za-zА-Яа-яЁё0-9_])(?![A-Za-zА-Яа-яЁё0-9_])|(?<![A-Za-zА-Яа-яЁё0-9_])(?=[A-Za-zА-Яа-яЁё0-9_]))/iu,
  /^(?:в|во|на|по|под|около|возле|рядом(?:\s+с)?|неподалеку\s+от|неподалёку\s+от|из)\s+[\p{L}\d-]+(?:\s+[\p{L}\d-]+){0,2}(?:\s+(?:или|либо)\s+[\p{L}\d-]+(?:\s+[\p{L}\d-]+){0,2}){0,2}$/iu,
];

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

function isAgeOnlyCandidate(value = '') {
  const normalized = normalizeText(value);
  if (!normalized) {
    return false;
  }

  const hasAgeMarker =
    /(?:^|[^\p{L}\p{N}])\d{1,2}\s*(?:\+|плюс|лет|года|год|годиков)(?=$|[^\p{L}\p{N}])/u.test(
      normalized
    ) ||
    /(?:^|[^\p{L}\p{N}])(?:от|с|до|по|старше|младше)\s+\d{1,2}\s*(?:лет|года|год|годиков)?(?=$|[^\p{L}\p{N}])/u.test(
      normalized
    );

  if (!hasAgeMarker) {
    return false;
  }

  const residue = normalized
    .replace(/\d{1,2}\s*(?:\+|плюс|лет|года|год|годиков)?/gu, ' ')
    .replace(
      /(?:можно|возраст|возраста|от|с|до|по|старше|младше|лет|года|год|годиков|плюс|детям|детей|дети|ребенку|ребенок|ребенка|ребёнку|ребёнок|ребёнка)/gu,
      ' '
    )
    .replace(/[+.,;:!?()[\]{}"'`«»\s-]+/gu, '')
    .trim();

  return residue.length === 0;
}

function hasMixedAlphabet(value = '') {
  const source = String(value || '');
  return /[A-Za-z]/.test(source) && /[А-Яа-яЁё]/.test(source);
}

function hasArtistSlot(slots = []) {
  return (Array.isArray(slots) ? slots : []).some((slot) => {
    if (!slot || typeof slot !== 'object') return false;
    return (
      ARTIST_SLOT_NAMES.has(String(slot.name || '').trim()) &&
      String(slot.value || '').trim() !== ''
    );
  });
}

function cleanupArtistCandidate(rawCandidate = '') {
  if (!rawCandidate) return '';

  let candidate = String(rawCandidate).trim();
  candidate = candidate.replace(/^[\s"'«»“”„`]+|[\s"'«»“”„`!?.,;:()]+$/gu, '');
  candidate = candidate.replace(
    /^(?:на\s+)?(?:(?:рок|pop|поп|джаз|jazz|фолк|шансон|романс|авторск\p{L}*|бард\p{L}*|рэп|реп|хип[\s-]?хоп|трэп|trap|электрон\p{L}*|электроник\p{L}*|edm|техно|techno|house|хаус|метал\p{L}*|metal|хэви|heavy|instrumental|инструментальн\p{L}*|классик\p{L}*|симфон\p{L}*|академическ\p{L}*|танцевальн\p{L}*|юмористическ\p{L}*|цирков\p{L}*|детск\p{L}*)\s+)?(?:концерт|концерты|выступление|выступления|шоу|ст[еэ]ндап|театр|спектакль|спектакли|опера|балет|мюзикл|выставка|выставки|музей|музеи|экскурсия|экскурсии|кино|фильм|фильмы|матч|матчи)\s+/iu,
    ''
  );
  candidate = candidate.replace(
    /\s+(?:в|во|на)\s+[\p{L}\d-]+(?:\s+[\p{L}\d-]+){0,2}(?:\s+(?:или|либо)\s+[\p{L}\d-]+(?:\s+[\p{L}\d-]+){0,2}){0,2}$/iu,
    ''
  );
  for (const pattern of TRAILING_NON_ARTIST_CONTEXT_PATTERNS) {
    candidate = candidate.replace(pattern, '');
  }
  candidate = candidate.replace(/\s+/g, ' ').trim();

  return candidate;
}

function looksLikeDateOrWeekdayCandidate(candidate = '') {
  const normalized = normalizeText(candidate);
  if (!normalized) return false;

  if (WEEKDAY_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  if (RELATIVE_DATE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  if (MONTH_NAME_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  if (NUMERIC_DATE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  if (TIME_MARKER_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  return false;
}

function containsMoodMarker(candidate = '') {
  const normalized = normalizeText(candidate);
  if (!normalized) return false;
  return MOOD_PATTERNS.some((pattern) => pattern.test(normalized));
}

function containsGenericDiscoveryLanguage(candidate = '') {
  const normalized = normalizeText(candidate);
  if (!normalized) return false;
  return GENERIC_DISCOVERY_PATTERNS.some((pattern) => pattern.test(normalized));
}

function startsWithNonArtistLead(candidate = '') {
  const normalized = normalizeText(candidate);
  if (!normalized) return false;

  return (
    /^(?:на\s+)?(?:сегодня|завтра|послезавтра|вчера|следующ(?:ие|их|им)\s+выходн(?:ые|ых|ым)|будущ(?:ие|их|им)\s+выходн(?:ые|ых|ым)|ближайш(?:ие|их|им)\s+выходн(?:ые|ых|ым)|выходн(?:ые|ых|ым))/u.test(
      normalized
    ) ||
    /^(?:на\s+)?(?:этой|эту|эта|следующей|следующую|следующая|будущей|будущую|будущая)\s+недел/u.test(
      normalized
    ) ||
    /^(?:какой(?:-|\s)?нибудь|какая(?:-|\s)?нибудь|какое(?:-|\s)?нибудь|что(?:-|\s)?нибудь|куда(?:-|\s)?нибудь|любой|любая|любое)(?![A-Za-zА-Яа-яЁё0-9_])/u.test(
      normalized
    )
  );
}

export function isLikelyArtistCandidate(candidate = '') {
  const normalized = normalizeText(candidate);
  if (!normalized) return false;
  if (normalized.length < 3 || normalized.length > 80) return false;

  if (looksLikePreferenceMemoryReferenceText(candidate, { requireAction: false })) {
    return false;
  }

  if (isKnownEventTaxonomyValue(normalized)) {
    return false;
  }

  if (isVagueArtistDescriptor(normalized)) {
    return false;
  }

  if (BUDGET_CANDIDATE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  if (
    EVENT_TYPE_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    /^(?:концерт|концерты|выступление|шоу)(?![A-Za-zА-Яа-яЁё0-9_])/u.test(normalized)
  ) {
    return false;
  }

  if (CATEGORY_OR_GENRE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  if (GENERIC_PERFORMER_ROLE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  if (GENERIC_MUSIC_NOUN_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  if (NON_ARTIST_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  if (isAgeOnlyCandidate(normalized)) {
    return false;
  }

  if (looksLikeDateOrWeekdayCandidate(normalized)) {
    return false;
  }

  if (containsMoodMarker(normalized)) {
    return false;
  }

  if (containsGenericDiscoveryLanguage(normalized)) {
    return false;
  }

  if (LOCATION_MARKER_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  if (EXPLICIT_GENRE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 5) return false;

  return words.some((word) => word.length >= 3 && !/^\d+$/.test(word));
}

function conflictsWithExistingSearchFacet(candidate = '', slots = []) {
  const normalizedCandidate = normalizeText(candidate);
  if (!normalizedCandidate) {
    return false;
  }

  return (Array.isArray(slots) ? slots : []).some((slot) => {
    if (!slot || typeof slot !== 'object') {
      return false;
    }

    const slotName = String(slot.name || '').trim();
    if (!EVENT_TYPE_SLOT_NAMES.has(slotName) && !GENRE_SLOT_NAMES.has(slotName)) {
      return false;
    }

    return normalizeText(slot.value) === normalizedCandidate;
  });
}

function extractArtistCandidate(text = '') {
  const source = String(text || '').trim();
  if (!source) return null;

  for (const pattern of ARTIST_TRIGGER_PATTERNS) {
    const match = source.match(pattern);
    const rawCandidate = match?.[1] || '';
    if (startsWithNonArtistLead(rawCandidate)) continue;
    const candidate = cleanupArtistCandidate(rawCandidate);
    if (!candidate) continue;
    if (!isLikelyArtistCandidate(candidate)) continue;
    return candidate;
  }

  return null;
}

export function hasExplicitGenreSignal(text = '') {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  return EXPLICIT_GENRE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function resolveHeuristicArtistSlot(text = '', slots = []) {
  if (hasArtistSlot(slots)) {
    return null;
  }

  const candidate = extractArtistCandidate(text);
  if (!candidate) {
    return null;
  }

  if (conflictsWithExistingSearchFacet(candidate, slots)) {
    return null;
  }

  return {
    name: 'исполнитель',
    value: candidate,
    confidence: 0.94,
    source: 'heuristic_artist',
  };
}

export function appendHeuristicArtistSlot(slots = [], text = '') {
  const target = Array.isArray(slots) ? slots : [];
  const artistSlot = resolveHeuristicArtistSlot(text, target);
  if (!artistSlot) {
    return null;
  }

  target.push(artistSlot);
  return artistSlot;
}

export function reconcileArtistSlotsWithText(slots = [], text = '') {
  const target = Array.isArray(slots) ? slots : [];
  if (target.length === 0) {
    return target;
  }

  const candidate = extractArtistCandidate(text);
  if (!candidate) {
    return target;
  }

  const candidateNormalized = normalizeText(candidate);
  if (!candidateNormalized) {
    return target;
  }

  for (const slot of target) {
    if (!slot || typeof slot !== 'object') {
      continue;
    }

    const slotName = String(slot.name || '').trim();
    if (!ARTIST_SLOT_NAMES.has(slotName)) {
      continue;
    }

    const currentValue = String(slot.value || '').trim();
    if (!currentValue || !hasMixedAlphabet(currentValue)) {
      continue;
    }

    if (normalizeText(currentValue) === candidateNormalized) {
      continue;
    }

    slot.value = candidate;
    slot.source = slot.source
      ? `${slot.source}_reconciled_with_text`
      : 'artist_reconciled_with_text';
  }

  return target;
}

export function dropUngroundedGenreSlotsWhenArtistDetected(
  slots = [],
  text = '',
  artistSlot = null
) {
  const target = Array.isArray(slots) ? slots : [];
  if (!artistSlot || !GENRE_SLOT_NAMES.size || hasExplicitGenreSignal(text)) {
    return target;
  }

  return target.filter((slot) => {
    if (!slot || typeof slot !== 'object') return false;
    const slotName = String(slot.name || '').trim();
    return !GENRE_SLOT_NAMES.has(slotName);
  });
}
