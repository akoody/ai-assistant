import { FREE_BUDGET_MAX_RUB, MAX_EVENTS_PER_OFFER } from './searchDefinitions.js';

function formatDateForKassir(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return undefined;
  }
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

function toPriceNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    // 0 — валидная цена "бесплатно", допускаем 0.
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  const digitsOnly = String(value).replace(/[^0-9]/g, '');
  if (!digitsOnly) {
    return null;
  }

  const parsed = Number(digitsOnly);
  // 0 — валидная цена "бесплатно", допускаем 0.
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function getBudgetCapFromSlots(slots = []) {
  const input = Array.isArray(slots) ? slots : [];
  const budgetSlot = input.find((s) => s && s.name === 'бюджет');
  const priceToSlot = input.find((s) => s && s.name === 'цена_до');

  const slotToNumber = (slot) => {
    if (!slot) return null;
    const digits = String(slot.value ?? '').replace(/[^0-9]/g, '');
    if (!digits) return null;
    const num = Number(digits);
    return Number.isFinite(num) ? num : null;
  };

  const fromBudget = slotToNumber(budgetSlot);
  const fromPriceTo = slotToNumber(priceToSlot);

  if (fromBudget === null && fromPriceTo === null) return null;
  if (fromBudget === null) return fromPriceTo;
  if (fromPriceTo === null) return fromBudget;
  return Math.min(fromBudget, fromPriceTo);
}

function isStrictFreeBudgetMode(slots = []) {
  const budgetCap = getBudgetCapFromSlots(slots);
  return Number.isFinite(budgetCap) && budgetCap <= FREE_BUDGET_MAX_RUB;
}

function eventMatchesBudget(event, budgetCap) {
  if (!Number.isFinite(budgetCap) || budgetCap < 0) return true;

  const eventPriceMinRaw = toPriceNumber(event?.priceMin);
  const eventPriceMaxRaw = toPriceNumber(event?.priceMax);
  const eventPriceMin = eventPriceMinRaw ?? eventPriceMaxRaw;
  const eventPriceMax = eventPriceMaxRaw ?? eventPriceMinRaw;

  if (budgetCap <= FREE_BUDGET_MAX_RUB) {
    if (eventPriceMin === null && eventPriceMax === null) return false;
    const min = eventPriceMin ?? eventPriceMax;
    return typeof min === 'number' && min <= FREE_BUDGET_MAX_RUB;
  }

  if (eventPriceMin === null && eventPriceMax === null) return true;
  const min = eventPriceMin ?? eventPriceMax;
  return typeof min === 'number' && min <= budgetCap;
}

function getCandidateCollectionStopReason({
  strictFreeBudgetMode,
  uniqueEventsCount,
  budgetMatchedCandidates,
  targetCollectedEvents,
  targetBudgetMatchedEvents,
}) {
  if (!strictFreeBudgetMode) {
    if (uniqueEventsCount >= targetCollectedEvents) {
      return `собрано достаточно событий (${uniqueEventsCount})`;
    }
    return null;
  }

  const reachedBudgetTarget =
    uniqueEventsCount >= MAX_EVENTS_PER_OFFER * 3 &&
    budgetMatchedCandidates >= targetBudgetMatchedEvents;
  if (reachedBudgetTarget) {
    return (
      `собрано достаточно кандидатов для бесплатного режима: ` +
      `${budgetMatchedCandidates} подходящих из ${uniqueEventsCount}`
    );
  }

  if (uniqueEventsCount >= targetCollectedEvents) {
    return `достигнут расширенный лимит кандидатов (${uniqueEventsCount})`;
  }

  return null;
}

function canStopMoodCandidateCollection({
  searchPlan = null,
  candidateIndex = 0,
  searchCandidates = [],
} = {}) {
  if (!searchPlan?.moodProfileKey && !searchPlan?.ambiguousCategoryShowAll) {
    return true;
  }

  if (!Array.isArray(searchCandidates) || searchCandidates.length <= 1) {
    return true;
  }

  const isInitialSweepIncomplete = candidateIndex < searchCandidates.length - 1;
  if (isInitialSweepIncomplete) {
    return false;
  }

  return true;
}

export {
  formatDateForKassir,
  toPriceNumber,
  getBudgetCapFromSlots,
  isStrictFreeBudgetMode,
  eventMatchesBudget,
  getCandidateCollectionStopReason,
  canStopMoodCandidateCollection,
};
