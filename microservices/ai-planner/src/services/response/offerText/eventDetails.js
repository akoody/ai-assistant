import { normalizeForMatch } from './eventMatching.js';
import { buildSafeDescriptionFromEvent } from './descriptions.js';
import {
  formatPriceRange,
  formatDurationMinutes,
  getEventDurationMinutes,
  buildUnknownDurationDetailsText,
  isEventDurationQuestionText,
} from './eventFacts.js';

function buildSafeEventDetailsText(event, userMessage = '') {
  const title = String(event?.title || '').trim();
  const when = [event?.date, event?.time].filter(Boolean).join(', ').trim();
  const where = [event?.venue, event?.address, event?.city].filter(Boolean).join(', ').trim();
  const description = buildSafeDescriptionFromEvent(event);
  const price = formatPriceRange(event);
  const ageRestriction = String(event?.ageRestriction || '').trim();
  const normalizedQuestion = normalizeForMatch(userMessage);
  const asksAboutDuration = isEventDurationQuestionText(normalizedQuestion);
  const asksAboutPrice =
    !asksAboutDuration &&
    /(цен|стоим|скольк\S*\s+стои|скольк\S*\s+(?:за|биле))/u.test(normalizedQuestion);
  const parts = [];

  const durationMin = getEventDurationMinutes(event);

  if (asksAboutDuration && durationMin) {
    const durationStr = formatDurationMinutes(durationMin);
    parts.push(`Длительность${title ? ` «${title}»` : ''} — ${durationStr}.`);
  } else if (asksAboutDuration) {
    return buildUnknownDurationDetailsText(event);
  } else if (asksAboutPrice && price) {
    parts.push(`По событию ${title ? `«${title}» ` : ''}цена сейчас ${price}.`);
  } else if (title) {
    parts.push(`По событию «${title}» могу подсказать следующее.`);
  } else {
    parts.push('По выбранному событию могу подсказать следующее.');
  }

  if (when) {
    parts.push(`Дата и время: ${when}.`);
  }
  if (where) {
    parts.push(`Место проведения: ${where}.`);
  }
  if (description) {
    parts.push(description);
  }
  if (price && !asksAboutPrice) {
    parts.push(`Цена: ${price}.`);
  }
  if (ageRestriction) {
    parts.push(`Возрастное ограничение: ${ageRestriction}.`);
  }
  if (event?.isPushkinCard === true || event?.isPushkin === true) {
    parts.push('Доступна оплата Пушкинской картой.');
  }

  parts.push('Если хотите, могу помочь с покупкой билета или подобрать похожие варианты.');

  return parts
    .join('\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export { buildSafeEventDetailsText };
