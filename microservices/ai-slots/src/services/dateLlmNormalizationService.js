import NodeCache from 'node-cache';
import { callAiGateway } from './aiGatewayService.js';
import { getDateNormalizationPrompt } from './configService.js';
import { enrichSlotWithDate } from './dateParsingService.js';

const normalizationCache = new NodeCache({ stdTTL: 3600, checkperiod: 600, useClones: false });

function isDateSlot(slot = null) {
  return Boolean(slot?.name && String(slot.name).toLowerCase().includes('дата'));
}

function hasStructuredDate(slot = null) {
  return Boolean(slot?.parsedDate || slot?.dateRange);
}

function normalizeToDayStart(value = new Date()) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatDateIso(date) {
  const normalized = normalizeToDayStart(date);
  if (!normalized) {
    return '';
  }

  const year = normalized.getFullYear();
  const month = String(normalized.getMonth() + 1).padStart(2, '0');
  const day = String(normalized.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseJsonContent(rawContent = '') {
  const cleanContent = String(rawContent || '')
    .replace(/```json\s*/giu, '')
    .replace(/```\s*/gu, '')
    .trim();

  if (!cleanContent) {
    return null;
  }

  try {
    return JSON.parse(cleanContent);
  } catch (error) {
    console.error(
      '[dateLlmNormalizationService] Не удалось распарсить JSON ответа нормализатора даты:',
      error
    );
    return null;
  }
}

function parseIsoDate(value, { endOfDay = false } = {}) {
  const match = String(value || '')
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const date = new Date(year, month - 1, day);

  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  if (endOfDay) {
    date.setHours(23, 59, 59, 999);
  } else {
    date.setHours(0, 0, 0, 0);
  }

  return date;
}

function normalizeLlmDatePayload(payload = null) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const result = {};
  const parsedDate = parseIsoDate(payload.parsedDate);
  if (parsedDate) {
    result.parsedDate = parsedDate;
  }

  const startDate = parseIsoDate(payload.dateRange?.startDate);
  const endDate = parseIsoDate(payload.dateRange?.endDate, { endOfDay: true });
  if (startDate && endDate && endDate >= startDate) {
    result.dateRange = { startDate, endDate };
  }

  return hasStructuredDate(result) ? result : null;
}

async function resolveDateWithLlm(slot, { sourceText = '', referenceDate = new Date() } = {}) {
  const normalizedReferenceDate = normalizeToDayStart(referenceDate);
  if (!normalizedReferenceDate) {
    return null;
  }

  const cacheKey = JSON.stringify({
    slotName: slot.name,
    slotValue: slot.value,
    sourceText: String(sourceText || ''),
    referenceDate: formatDateIso(normalizedReferenceDate),
  });

  if (normalizationCache.has(cacheKey)) {
    return normalizationCache.get(cacheKey);
  }

  const systemPrompt = getDateNormalizationPrompt();
  const userPayload = {
    slotName: slot.name,
    slotValue: String(slot.value || ''),
    sourceText: String(sourceText || ''),
    referenceDate: formatDateIso(normalizedReferenceDate),
  };

  try {
    const response = await callAiGateway(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
      0.1,
      'slots-extraction'
    );

    const rawContent = response?.choices?.[0]?.message?.content || '';
    const parsedPayload = parseJsonContent(rawContent);
    const normalizedPayload = normalizeLlmDatePayload(parsedPayload);
    normalizationCache.set(cacheKey, normalizedPayload);
    return normalizedPayload;
  } catch (error) {
    console.error(
      `[dateLlmNormalizationService] Ошибка LLM-нормализации даты для ${slot.name}="${slot.value}":`,
      error
    );
    normalizationCache.set(cacheKey, null, 60);
    return null;
  }
}

export async function enrichSlotWithDateLlmFallback(slot, options = {}) {
  const deterministicSlot = enrichSlotWithDate(slot);
  if (!isDateSlot(deterministicSlot) || hasStructuredDate(deterministicSlot)) {
    return deterministicSlot;
  }

  const normalizedByLlm = await resolveDateWithLlm(deterministicSlot, options);
  if (!normalizedByLlm) {
    return deterministicSlot;
  }

  const enrichedSlot = {
    ...deterministicSlot,
    ...(deterministicSlot.parsedDate
      ? {}
      : normalizedByLlm.parsedDate
        ? { parsedDate: normalizedByLlm.parsedDate }
        : {}),
    ...(deterministicSlot.dateRange
      ? {}
      : normalizedByLlm.dateRange
        ? { dateRange: normalizedByLlm.dateRange }
        : {}),
  };

  console.log(
    `[dateLlmNormalizationService] LLM обогатил слот ${deterministicSlot.name}="${deterministicSlot.value}":`,
    {
      hasParsedDate: !!enrichedSlot.parsedDate,
      hasDateRange: !!enrichedSlot.dateRange,
      dateRange: enrichedSlot.dateRange
        ? {
            startDate: enrichedSlot.dateRange.startDate?.toISOString(),
            endDate: enrichedSlot.dateRange.endDate?.toISOString(),
          }
        : null,
    }
  );

  return enrichedSlot;
}

export async function enrichSlotsWithDateLlmFallback(slots = [], options = {}) {
  const list = Array.isArray(slots) ? slots : [];
  return Promise.all(list.map((slot) => enrichSlotWithDateLlmFallback(slot, options)));
}
