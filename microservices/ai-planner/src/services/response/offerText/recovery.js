import {
  extractNumberedSegments,
  hasOfferListArtifacts,
  extractOfferTailAfterLastSegment,
} from './eventMatching.js';
import { extractOfferIntro } from './framing.js';
import { buildCanonicalOfferEventSegment, normalizeOfferDescriptions } from './descriptions.js';
import { textClaimsFreePrice } from './eventFacts.js';

function rebuildOfferTextWithRecovery({
  primaryText,
  retryText,
  events,
  fallbackIntro,
  ensureOutro = true,
  hasKnownEventType = true,
}) {
  const offerEvents = Array.isArray(events) ? events : [];
  const primarySegments = extractNumberedSegments(primaryText);
  const retrySegments = extractNumberedSegments(retryText);
  const primaryMap = new Map(primarySegments.map((s) => [s.num, s.segment]));
  const retryMap = new Map(retrySegments.map((s) => [s.num, s.segment]));

  // Берём интро из более полного ответа.
  const introSource = retrySegments.length >= primarySegments.length ? retryText : primaryText;
  const intro = extractOfferIntro(introSource, fallbackIntro);

  const segments = [];
  for (let i = 1; i <= offerEvents.length; i++) {
    const event = offerEvents[i - 1];
    const retrySegment = retryMap.get(i) || '';
    const primarySegment = primaryMap.get(i) || '';
    const sourceSegment = retrySegment || primarySegment || '';
    const canonicalSegment = buildCanonicalOfferEventSegment(event, i);

    if (!sourceSegment) {
      segments.push(canonicalSegment);
      continue;
    }

    const sourceLines = String(sourceSegment)
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const extraLines = sourceLines.filter((line, index) => {
      if (index === 0) return false;
      return !/^(дата\s+и\s+время|место\s+проведения|место|описание|цена)\s*[:\-—–]/iu.test(line);
    });
    const safeExtraLines = extraLines.filter(
      (line) =>
        !textClaimsFreePrice(line) &&
        !/(?<![A-Za-zА-Яа-яЁё0-9_])цена(?![A-Za-zА-Яа-яЁё0-9_])/iu.test(line) &&
        !/^\s*\d{1,2}[.)]\s+\S/u.test(line)
    );

    if (safeExtraLines.length === 0) {
      segments.push(canonicalSegment);
      continue;
    }

    segments.push(`${canonicalSegment}\n${safeExtraLines.join('\n')}`.trim());
  }

  const outro = hasKnownEventType
    ? 'Если хотите больше опций, уточните жанр, бюджет или время.'
    : 'Если хотите больше опций, уточните бюджет или время.';
  const body = segments.join('\n\n').trim();
  const withIntro = [intro, body].filter(Boolean).join('\n\n').trim();

  if (!ensureOutro) {
    return withIntro;
  }
  if (!withIntro.toLowerCase().includes(outro.toLowerCase())) {
    return `${withIntro}\n\n${outro}`.trim();
  }
  return withIntro;
}

function synchronizeOfferTextWithEvents(
  text,
  events,
  { fallbackIntro = 'Вот подходящие варианты:', hasKnownEventType = true } = {}
) {
  const source = String(text || '').trim();
  const offerEvents = Array.isArray(events) ? events.filter(Boolean) : [];

  if (!source || offerEvents.length === 0) {
    return source;
  }

  const normalizedText = normalizeOfferDescriptions(source, offerEvents);
  const normalizedSegmentsCount = extractNumberedSegments(normalizedText).length;
  const normalizedTail = extractOfferTailAfterLastSegment(normalizedText);

  if (normalizedSegmentsCount === offerEvents.length && !hasOfferListArtifacts(normalizedTail)) {
    return normalizedText;
  }

  return rebuildOfferTextWithRecovery({
    primaryText: source,
    retryText: '',
    events: offerEvents,
    fallbackIntro,
    ensureOutro: true,
    hasKnownEventType,
  });
}

function buildStrictOfferTextFromEvents(
  text,
  events,
  { fallbackIntro = 'Вот подходящие варианты:', hasKnownEventType = true } = {}
) {
  const source = String(text || '').trim();
  const offerEvents = Array.isArray(events) ? events.filter(Boolean) : [];

  if (offerEvents.length === 0) {
    return source;
  }

  const introCandidate = extractOfferIntro(source, fallbackIntro) || fallbackIntro;
  const intro = hasOfferListArtifacts(introCandidate) ? fallbackIntro : introCandidate;
  const body = offerEvents
    .map((event, index) => buildCanonicalOfferEventSegment(event, index + 1))
    .join('\n\n')
    .trim();
  const outro = hasKnownEventType
    ? 'Если хотите больше опций, уточните жанр, бюджет или время.'
    : 'Если хотите больше опций, уточните бюджет или время.';

  return [intro, body, outro].filter(Boolean).join('\n\n').trim();
}

export {
  rebuildOfferTextWithRecovery,
  synchronizeOfferTextWithEvents,
  buildStrictOfferTextFromEvents,
};
