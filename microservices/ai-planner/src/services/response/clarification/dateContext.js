import { normalizeClarificationTextForMatch } from '../textUtils.js';
import { extractDateHintFromText, hasDateReferenceInText } from '../../naturalLanguageHints.js';
import { enrichSlotWithDate } from '../../dateParsingUtils.js';
import { isMeaningfulPreferenceSlotValue } from '../../preferenceMemoryService.js';

function extractHeuristicDateHintFromText(text = '') {
  return extractDateHintFromText(normalizeClarificationTextForMatch(text));
}

function toComparableDateSignature(slot = null) {
  if (!slot?.value) {
    return '';
  }

  const enriched = enrichSlotWithDate(slot);
  if (enriched?.dateRange?.startDate && enriched?.dateRange?.endDate) {
    const startDate = new Date(enriched.dateRange.startDate);
    const endDate = new Date(enriched.dateRange.endDate);
    if (!Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime())) {
      return `range:${startDate.toISOString().slice(0, 10)}:${endDate.toISOString().slice(0, 10)}`;
    }
  }

  if (enriched?.parsedDate) {
    const parsedDate = new Date(enriched.parsedDate);
    if (!Number.isNaN(parsedDate.getTime())) {
      return `date:${parsedDate.toISOString().slice(0, 10)}`;
    }
  }

  return '';
}

function isKnownDateContextAligned(text = '', knownDate = '') {
  const normalizedKnownDate = String(knownDate || '').trim();
  if (!normalizedKnownDate) {
    return true;
  }

  const sourceText = String(text || '').trim();
  if (!sourceText || !hasDateReferenceInText(sourceText)) {
    return true;
  }

  const dateHintFromText = extractHeuristicDateHintFromText(sourceText);
  if (!dateHintFromText) {
    return true;
  }

  const knownDateSignature = toComparableDateSignature({
    name: 'дата_события',
    value: normalizedKnownDate,
  });
  const textDateSignature = toComparableDateSignature({
    name: 'дата_события',
    value: dateHintFromText,
  });

  if (!knownDateSignature || !textDateSignature) {
    return true;
  }

  return knownDateSignature === textDateSignature;
}

function shouldIgnoreRecoveredUiSlotForOffTopic({
  offTopicIntent = null,
  inferredUiSlot = null,
  inferredDateReplySlot = null,
  isButtonEcho = false,
  isQuickCategorySelection = false,
} = {}) {
  return Boolean(
    offTopicIntent &&
    !inferredUiSlot &&
    inferredDateReplySlot &&
    !isButtonEcho &&
    !isQuickCategorySelection
  );
}

function inferDateSlotFromConversation({
  userMessage = '',
  history = [],
  includeHistory = true,
} = {}) {
  const candidates = [];
  if (userMessage) {
    candidates.push(String(userMessage));
  }

  if (includeHistory && Array.isArray(history)) {
    const recentUserMessages = [...history]
      .reverse()
      .filter((item) => item?.role === 'user' && item?.content)
      .map((item) => String(item.content))
      .slice(0, 8);
    candidates.push(...recentUserMessages);
  }

  for (const candidateText of candidates) {
    const dateHint = extractHeuristicDateHintFromText(candidateText);
    if (!dateHint) {
      continue;
    }

    const enriched = enrichSlotWithDate({
      name: 'дата_события',
      value: dateHint,
      confidence: 0.88,
      source: 'heuristic_date_context',
    });

    if (enriched?.parsedDate || enriched?.dateRange) {
      return enriched;
    }
  }

  return null;
}

function hasUsableDateSlot(slots = []) {
  if (!Array.isArray(slots)) {
    return false;
  }

  return slots.some((slot) => {
    if (!slot || slot.name !== 'дата_события') {
      return false;
    }

    if (slot.parsedDate || slot.dateRange) {
      return true;
    }

    const enriched = enrichSlotWithDate(slot);
    return Boolean(enriched?.parsedDate || enriched?.dateRange);
  });
}

function isMetaPreferenceReferenceSlot(slot = null) {
  if (!slot || !slot.name) {
    return false;
  }

  const slotName = String(slot.name || '').trim();
  if (!['жанр', 'жанр_музыки', 'предпочтения_жанры'].includes(slotName)) {
    return false;
  }

  return !isMeaningfulPreferenceSlotValue(slotName, slot.value);
}

export {
  extractHeuristicDateHintFromText,
  isKnownDateContextAligned,
  shouldIgnoreRecoveredUiSlotForOffTopic,
  inferDateSlotFromConversation,
  hasUsableDateSlot,
  isMetaPreferenceReferenceSlot,
};
