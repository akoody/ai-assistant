import { normalizeText } from '../textUtils.js';
import { extractNumberedSegments, hasOfferListArtifacts } from './eventMatching.js';
import { textClaimsFreePrice } from './eventFacts.js';
import { containsNonCyrillic } from '../../llm/assistantResponseUtils.js';

function getOfferFallbackIntro(
  events,
  { hasPreviouslyShownEvents = false, popularSelectionUsed = false, cityName = '' } = {}
) {
  const count = Array.isArray(events) ? events.filter(Boolean).length : 0;
  const normalizedCityName = String(cityName || '').trim();

  if (count === 1) {
    if (popularSelectionUsed && normalizedCityName) {
      return hasPreviouslyShownEvents
        ? `Я нашёл ещё одно популярное событие в городе ${normalizedCityName}:`
        : `Вот популярное событие в городе ${normalizedCityName}:`;
    }
    return hasPreviouslyShownEvents
      ? 'Вот ещё один интересный вариант:'
      : 'Вот интересный вариант:';
  }

  if (popularSelectionUsed && normalizedCityName) {
    return hasPreviouslyShownEvents
      ? `Я нашёл ещё несколько популярных событий в городе ${normalizedCityName}:`
      : `Вот несколько популярных событий в городе ${normalizedCityName}:`;
  }

  return hasPreviouslyShownEvents
    ? 'Я нашёл ещё варианты. Вот подборка:'
    : 'Вот несколько интересных вариантов:';
}

function extractFreshPreferenceAckPrefix(text = '') {
  const source = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!source) {
    return '';
  }

  const match = source.match(/^(Запомнил,\s+что\s+вам\s+нрав(?:ится|ятся)\s+[^.!?]+[.!?])/iu);
  return match ? match[1].trim() : '';
}

function prependFreshPreferenceAckToIntro(intro = '', sourceText = '') {
  const cleanIntro = String(intro || '').trim();
  const ack = extractFreshPreferenceAckPrefix(sourceText);
  if (!ack) {
    return cleanIntro;
  }

  if (normalizeText(cleanIntro).startsWith(normalizeText(ack))) {
    return cleanIntro;
  }

  return [ack, cleanIntro].filter(Boolean).join(' ');
}

function extractOfferIntro(text, fallbackIntro) {
  const source = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const firstNumberedIndex = source.search(/^\s*\d{1,2}[.)]\s+/m);
  if (firstNumberedIndex <= 0) {
    return prependFreshPreferenceAckToIntro(sanitizeOfferFramingText('', fallbackIntro), source);
  }
  const intro = source.slice(0, firstNumberedIndex).trim();
  return prependFreshPreferenceAckToIntro(sanitizeOfferFramingText(intro, fallbackIntro), source);
}

function extractOfferOutro(text, fallbackOutro = '') {
  const source = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const segments = extractNumberedSegments(source);
  if (segments.length === 0) {
    return sanitizeOfferFramingText('', fallbackOutro);
  }

  const lastSegment = segments[segments.length - 1];
  const outro = source.slice(lastSegment.end).trim();
  if (outro) {
    if (
      textClaimsFreePrice(outro) ||
      /(?<![A-Za-zА-Яа-яЁё0-9_])цена(?![A-Za-zА-Яа-яЁё0-9_])/iu.test(outro)
    ) {
      return sanitizeOfferFramingText('', fallbackOutro);
    }
    return sanitizeOfferFramingText(outro, fallbackOutro);
  }

  const lines = String(lastSegment.segment || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');
  const lastStructuredLineIndex = lines.reduce((acc, line, index) => {
    if (
      index === 0 ||
      /^(дата\s+и\s+время|место\s+проведения|место|описание|цена)\s*[:\-—–]/iu.test(
        String(line || '').trim()
      )
    ) {
      return index;
    }
    return acc;
  }, -1);

  if (lastStructuredLineIndex >= 0 && lastStructuredLineIndex < lines.length - 1) {
    const inlineOutro = lines
      .slice(lastStructuredLineIndex + 1)
      .join('\n')
      .trim();
    if (inlineOutro) {
      if (
        textClaimsFreePrice(inlineOutro) ||
        /(?<![A-Za-zА-Яа-яЁё0-9_])цена(?![A-Za-zА-Яа-яЁё0-9_])/iu.test(inlineOutro)
      ) {
        return sanitizeOfferFramingText('', fallbackOutro);
      }
      return sanitizeOfferFramingText(inlineOutro, fallbackOutro);
    }
  }

  return sanitizeOfferFramingText('', fallbackOutro);
}

function sanitizeOfferFramingText(text, fallbackText = '') {
  const source = String(text || '').trim();
  const fallback = String(fallbackText || '').trim();

  if (!source) {
    return fallback;
  }

  if (hasOfferListArtifacts(source)) {
    return fallback;
  }

  if (/[A-Za-z]/u.test(source) || containsNonCyrillic(source)) {
    return fallback;
  }

  return source;
}

export { getOfferFallbackIntro, extractOfferIntro, extractOfferOutro };
