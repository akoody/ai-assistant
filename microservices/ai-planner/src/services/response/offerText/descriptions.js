import {
  normalizeForMatch,
  tokenizeForMatch,
  extractNumberedSegments,
  titleMatchesResponseText,
} from './eventMatching.js';
import { formatPriceRange, hasFreePriceMismatch } from './eventFacts.js';
import { extractOfferIntro, extractOfferOutro } from './framing.js';

function buildSafeDescriptionFromEvent(event) {
  const raw = String(event?.description || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (raw && !isTrivialDescriptionContent(raw, event?.title)) {
    // Берём 1–2 предложения из исходного description, без обрывов.
    const normalized = raw.replace(/(\.\.\.|…)\s*$/u, '').trim();
    const parts = normalized.split(/(?<=[.!?])\s+/u).filter(Boolean);
    const picked = parts.slice(0, 2).join(' ').trim();
    if (picked.length <= 220) {
      return picked.endsWith('.') || picked.endsWith('!') || picked.endsWith('?')
        ? picked
        : `${picked}.`;
    }
    const slice = picked.slice(0, 220);
    const lastSpace = slice.lastIndexOf(' ');
    const trimmed = (lastSpace > 120 ? slice.slice(0, lastSpace) : slice).trim();
    return trimmed.endsWith('.') || trimmed.endsWith('!') || trimmed.endsWith('?')
      ? trimmed
      : `${trimmed}.`;
  }

  // Если подробностей нет в данных — не придумываем: даём нейтральное описание по фактам.
  const extraCategory = Array.isArray(event?.extraCategories)
    ? event.extraCategories.find(Boolean)
    : null;
  const category = String(event?.category || '').trim();
  const venue = String(event?.venue || '').trim();
  const title = String(event?.title || '').trim();

  const lowerExtra = String(extraCategory || '').toLowerCase();
  const lowerCategory = String(category || '').toLowerCase();
  let kind = '';

  if (extraCategory && category) {
    if (lowerCategory.includes('концерт') && lowerExtra) {
      kind = `${extraCategory}-концерт`;
    } else {
      kind = `${extraCategory} ${category}`.trim();
    }
  } else if (extraCategory) {
    kind =
      lowerExtra.includes('рок') || lowerExtra.includes('джаз') || lowerExtra.includes('поп')
        ? `${extraCategory}-концерт`
        : extraCategory;
  } else if (category) {
    kind = category;
  }

  if (kind && venue) return `${kind} на площадке «${venue}».`;
  if (kind && title) return `${kind} «${title}».`;
  if (title && venue) return `Событие «${title}» на площадке «${venue}».`;
  if (title) return `Событие «${title}».`;
  if (venue) return `Событие на площадке «${venue}».`;
  return 'Событие.';
}

function isTrivialDescriptionContent(descriptionText, eventTitle) {
  const descNorm = normalizeForMatch(descriptionText);
  if (!descNorm) return true;

  // Явные заглушки/просьбы "уточнить" вместо описания.
  // Это НЕ описание события и должно заменяться на безопасную фразу из данных.
  if (
    /(укажи|укажите|сообщи|сообщите|напиши|напишите)/u.test(descNorm) &&
    /(подробнее|больше\s+информац|детал|подробност)/u.test(descNorm)
  ) {
    return true;
  }
  if (/(если\s+хочет(е|ся)\s+больше\s+информац)/u.test(descNorm)) {
    return true;
  }
  if (
    /(нет\s+информац|нет\s+описан|описан(ие)?\s+не\s+доступн|описан(ие)?\s+отсутств)/u.test(
      descNorm
    )
  ) {
    return true;
  }

  // Очень короткое описание — обычно заглушка.
  const words = descNorm.split(' ').filter(Boolean);
  if (words.length <= 4) return true;

  // Типовой шаблон вида "Концерт ...".
  if (words.length <= 6) {
    const hasGenericKind =
      words.includes('концерт') ||
      words.includes('шоу') ||
      words.includes('спектакль') ||
      words.includes('выставка') ||
      words.includes('мероприятие');
    if (hasGenericKind) {
      const titleTokens = tokenizeForMatch(eventTitle);
      const matchedTitleTokens = titleTokens.filter((t) => words.includes(t));
      // Почти полное совпадение с названием/типом.
      if (matchedTitleTokens.length > 0) return true;
    }
  }

  return false;
}

function ensureDescriptionInEventSegment(segment, event) {
  const text = String(segment || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const safeDescription = buildSafeDescriptionFromEvent(event);
  const descriptionLine = `Описание: ${safeDescription}`;

  // Если описание есть, но выглядит как заглушка — заменяем на безопасное из данных.
  const existingMatch = text.match(/(?:^|\n)\s*описание\s*(?::|—|–|-)\s*([^\n]*)/iu);
  if (existingMatch) {
    const existing = String(existingMatch[1] || '').trim();
    if (!existing || isTrivialDescriptionContent(existing, event?.title)) {
      return text
        .replace(/(?:^|\n)\s*описание\s*(?::|—|–|-)\s*[^\n]*/iu, `\n${descriptionLine}`)
        .trim();
    }
    return text.trim();
  }

  // "Описание" без контента (только метка и перенос).
  if (/(?:^|\n)\s*описание\s*(?:\n|$)/iu.test(text)) {
    return text
      .replace(/(?:^|\n)\s*описание\s*(?:\n|$)/iu, `\n${descriptionLine}\n`)
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // Вставляем описание перед "Цена" или в конец сегмента.
  if (/\n\s*Цена\s*:/iu.test(text)) {
    return text.replace(/\n(\s*Цена\s*:)/iu, `\n${descriptionLine}\n$1`).trim();
  }
  return `${text.trim()}\n${descriptionLine}`.trim();
}

function buildCanonicalOfferEventSegment(event, number) {
  const parts = [];
  const title = String(event?.title || '').trim();
  const when = [event?.date, event?.time].filter(Boolean).join(', ').trim();
  const where = [event?.venue, event?.address, event?.city].filter(Boolean).join(', ').trim();
  const description = buildSafeDescriptionFromEvent(event);
  const price = formatPriceRange(event);

  parts.push(`${number}. ${title || `Событие ${number}`}`);
  if (when) {
    parts.push(`Дата и время: ${when}`);
  }
  if (where) {
    parts.push(`Место проведения: ${where}`);
  }
  parts.push(`Описание: ${description}`);
  if (price) {
    parts.push(`Цена: ${price}`);
  }

  return parts.join('\n').trim();
}

function normalizeOfferDescriptions(text, events) {
  const offerEvents = Array.isArray(events) ? events : [];
  const source = String(text || '').trim();
  if (!source || offerEvents.length === 0) return source;

  const intro = extractOfferIntro(source, '');
  const outro = extractOfferOutro(source, '');
  const existingSegments = extractNumberedSegments(source);
  const existingByNumber = new Map(existingSegments.map((item) => [item.num, item.segment]));

  const normalizedSegments = offerEvents.map((event, index) => {
    const number = index + 1;
    const existingSegment = existingByNumber.get(number);

    if (!existingSegment) {
      return buildCanonicalOfferEventSegment(event, number);
    }

    if (segmentConflictsWithEventData(existingSegment, event)) {
      return buildCanonicalOfferEventSegment(event, number);
    }

    let normalizedSegment = normalizeEventSegmentHeader(
      existingSegment,
      number,
      String(event?.title || '').trim() || `Событие ${number}`
    );

    normalizedSegment = ensureDescriptionInEventSegment(normalizedSegment, event);

    if (hasFreePriceMismatch(normalizedSegment, event)) {
      return buildCanonicalOfferEventSegment(event, number);
    }

    return normalizedSegment;
  });

  const body = normalizedSegments.join('\n\n').trim();
  return [intro, body, outro].filter(Boolean).join('\n\n').trim();
}

function normalizeEventSegmentHeader(segment, number, title) {
  const normalized = String(segment || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
  if (!normalized) {
    return `${number}. ${title}`.trim();
  }
  const lines = normalized.split('\n');
  lines[0] = `${number}. ${title}`.trim();
  return lines.join('\n').trim();
}

function segmentConflictsWithEventData(segment, event) {
  const source = String(segment || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
  if (!source || !event) return false;

  const title = String(event?.title || '').trim();
  if (title && !titleMatchesResponseText(title, source)) {
    return true;
  }

  const dateLineMatch = source.match(/(?:^|\n)\s*дата\s+и\s+время\s*(?::|—|–|-)\s*([^\n]*)/iu);
  const venueLineMatch = source.match(
    /(?:^|\n)\s*место(?:\s+проведения)?\s*(?::|—|–|-)\s*([^\n]*)/iu
  );
  const normalizedDateLine = normalizeForMatch(dateLineMatch?.[1] || '');
  const normalizedVenueLine = normalizeForMatch(venueLineMatch?.[1] || '');
  const normalizedDate = normalizeForMatch(event?.date || '');
  const normalizedTime = normalizeForMatch(event?.time || '');
  const normalizedVenue = normalizeForMatch(event?.venue || '');

  if (normalizedDateLine && normalizedDate && !normalizedDateLine.includes(normalizedDate)) {
    return true;
  }

  if (normalizedDateLine && normalizedTime && !normalizedDateLine.includes(normalizedTime)) {
    return true;
  }

  if (normalizedVenueLine && normalizedVenue && !normalizedVenueLine.includes(normalizedVenue)) {
    return true;
  }

  if (hasFreePriceMismatch(source, event)) {
    return true;
  }

  return false;
}

export {
  buildSafeDescriptionFromEvent,
  buildCanonicalOfferEventSegment,
  normalizeOfferDescriptions,
};
