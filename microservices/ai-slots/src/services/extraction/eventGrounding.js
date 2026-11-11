import { resolveHeuristicArtistSlot } from '../artistHeuristics.js';
import { normalizeGuardText } from './timeGrounding.js';

function looksLikeEventDomainText(text) {
  const normalized = normalizeGuardText(text);
  if (!normalized) return false;

  return (
    Boolean(resolveHeuristicArtistSlot(text, [])) ||
    /(?:куда|где)\s*(?:то\s*)?(?:сходить|пойти|погулять)/u.test(normalized) ||
    /(?:мероприят|событи|афиш|билет|концерт|театр|выставк|музе|ст[еэ]ндап|кино|досуг|экскурс|тур|фестив|шоу|квест|спорт|цирк|цирков|клоунад|танц)/u.test(
      normalized
    )
  );
}

function getEventTypeGroundingPattern(value) {
  const normalized = normalizeGuardText(value);
  if (!normalized) return null;

  if (/(концерт|музык)/u.test(normalized)) {
    return /(?:концерт|музык|выступл|артист|группа|певец|джаз|jazz|(?:^|[^\p{L}\p{N}_])рок[\p{L}]*(?=$|[^\p{L}\p{N}_])|(?:^|[^\p{L}\p{N}_])поп(?=$|[^\p{L}\p{N}_])|попс[\p{L}]*|рэп|реп|хип[\s-]?хоп|trap|трэп|классик|симфон|академическ|шансон|романс|фолк|этно|электрон|электроник|edm|техно|techno|house|хаус|метал|metal|хэви|heavy|instrumental|инструментальн|творческ.*(?:вечер|встреч)|клуб|юмор|юморист|танцев|show|шоу)/u;
  }
  if (
    /(театр|спектакл|опер|балет|мюзикл|драм|комед|мелодрам|трагикомед|сказк|иммерсив|моноспект|кукольн|гастрол)/u.test(
      normalized
    )
  ) {
    return /(театр|спектакл|опер|балет|мюзикл|драм|комед|мелодрам|трагикомед|сказк|иммерсив|моноспект|кукольн|гастрол|пьес|танц)/u;
  }
  if (/(выставк|экспозиц)/u.test(normalized)) {
    return /(выставк|экспозиц|галере|фотограф|архитектур|историческ|техническ|искусствоведческ)/u;
  }
  if (/(музе)/u.test(normalized)) {
    return /(музе|галере|заповедник|мемориальн|археологическ|естественнонаучн|краеведческ|литературн|отраслев|художественн|архитектур|историческ|комплексн|техническ|искусствоведческ|фотограф)/u;
  }
  if (/(ст[еэ]ндап|stand-?\s*up)/u.test(normalized)) {
    return /(ст[еэ]ндап|stand-?\s*up|комик|юмор|юморист|сольн|женск|посме|смех|смея|смеш|хохот)/u;
  }
  if (/(кино|фильм)/u.test(normalized)) {
    return /(кино|фильм|сеанс|премьер)/u;
  }
  if (/(спорт|матч|соревн)/u.test(normalized)) {
    return /(спорт|матч|соревн|турнир|игр|футбол|баскетбол|единоборств|автоспорт)/u;
  }
  if (/(шоу|представлен)/u.test(normalized)) {
    return /(шоу|представлен|перформанс|цирк|цирков|клоунад|юмор|танц|ст[еэ]ндап|спортивн|посме|смех|смея|смеш|хохот)/u;
  }
  if (/(цирк|цирков|клоунад)/u.test(normalized)) {
    return /(цирк|цирков|клоунад|клоун|акробат|жонглер|жонглер)/u;
  }
  if (/(экскурс|турист|тур|прогулк|парк)/u.test(normalized)) {
    return /(экскурс|турист|(?:^|\s)тур(?:ы|а|у|ом|е|ов)?(?:$|\s|[.,!?;:\-–—])|погулять|прогулк|парк|достопримеч|красив[а-яё-]*\s+мест|путешеств|обзорн|пешеходн|автобусн|театрализован|особняк|активн.*отдых)/u;
  }
  if (/(квест)/u.test(normalized)) {
    return /(квест|escape\s*room)/u;
  }
  if (/(фестив)/u.test(normalized)) {
    return /(фестив|open\s*air|опен[\s-]?эйр|музыкальн)/u;
  }
  if (/(дет)/u.test(normalized)) {
    return /(дет|ребен|ребён|семейн|малыш|детск.*спектак|детск.*концерт|детск.*мюзикл|детск.*шоу|цирк|клоунад)/u;
  }
  if (/(образован|обучен|лекци|семинар|мастер[- ]?класс|тренинг|курс)/u.test(normalized)) {
    return /(образован|обучен|лекци|семинар|мастер[- ]?класс|тренинг|курс|вебинар|конференц)/u;
  }
  if (/(распродаж|скидк|акци)/u.test(normalized)) {
    return /(распродаж|скидк|акци)/u;
  }

  return null;
}

function isEventTypeSlotGrounded(slot, sourceText = '') {
  const normalizedText = normalizeGuardText(sourceText);
  if (!normalizedText) return true;

  const normalizedValue = normalizeGuardText(slot?.value);
  if (!normalizedValue) return false;

  if (normalizedText.includes(normalizedValue)) {
    return true;
  }

  const groundingPattern = getEventTypeGroundingPattern(normalizedValue);
  if (!groundingPattern) {
    return looksLikeEventDomainText(normalizedText);
  }

  return groundingPattern.test(normalizedText);
}

export { looksLikeEventDomainText, getEventTypeGroundingPattern, isEventTypeSlotGrounded };
