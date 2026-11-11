import { parseBudgetValue } from '../../../../../shared/moneyUtils.js';

const BUDGET_SLOT_NAMES = new Set(['бюджет', 'цена_до', 'цена']);

function isBudgetSlotName(slotName) {
  return BUDGET_SLOT_NAMES.has(String(slotName || '').trim());
}

function normalizeForBudget(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .trim();
}

function normalizeBudgetSlots(slots = [], sourceText = '') {
  const input = Array.isArray(slots) ? slots : [];

  input.forEach((slot) => {
    if (!slot || !isBudgetSlotName(slot.name)) {
      return;
    }

    if (isExplicitAnyBudgetValue(slot.value) || isFreeBudgetValue(slot.value)) {
      return;
    }

    const parsedBudget = parseBudgetValue(slot.value, { sourceText });
    if (!Number.isFinite(parsedBudget) || parsedBudget <= 0) {
      return;
    }

    slot.name = slot.name === 'цена' ? 'цена_до' : slot.name;
    slot.value = String(parsedBudget);
  });
}

function isExplicitAnyBudgetValue(value) {
  const normalized = normalizeForBudget(value);
  if (!normalized) return false;
  return (
    normalized === 'любой' ||
    normalized === 'любая цена' ||
    normalized === 'любой бюджет' ||
    normalized === 'не важно' ||
    normalized === 'неважно'
  );
}

function isFreeBudgetValue(value) {
  const normalized = normalizeForBudget(value);
  if (!normalized) return false;

  if (
    /бесплатн/u.test(normalized) ||
    /без\s+денег/u.test(normalized) ||
    /нет\s+денег/u.test(normalized) ||
    /денег\s+нет/u.test(normalized) ||
    /на\s+халяв/u.test(normalized) ||
    /не\s*(?:хочу|готов|могу)\s*платить/u.test(normalized) ||
    /нулев(?:ой|ым)\s+бюджет/u.test(normalized)
  ) {
    return true;
  }

  const digits = normalized.replace(/[^0-9]/g, '');
  if (!digits) return false;
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) && parsed <= 0;
}

function looksLikeRelativeCheaperBudgetRequest(text) {
  const normalized = normalizeForBudget(text);
  if (!normalized) return false;

  return (
    /подешевле/u.test(normalized) ||
    /дешевле/u.test(normalized) ||
    /недорог/u.test(normalized) ||
    /бюджетн/u.test(normalized)
  );
}

function looksLikeFreeBudgetLeisureRequest(text) {
  const normalized = normalizeForBudget(text);
  if (!normalized) return false;

  const hasFreeBudgetSignal =
    /бесплатн/u.test(normalized) ||
    /без\s+денег/u.test(normalized) ||
    /нет\s+денег/u.test(normalized) ||
    /денег\s+нет/u.test(normalized) ||
    /на\s+халяв/u.test(normalized) ||
    /не\s*(?:хочу|готов|могу)\s*платить/u.test(normalized) ||
    /нулев(?:ой|ым)\s+бюджет/u.test(normalized) ||
    /бюджет\s*0/u.test(normalized);

  if (!hasFreeBudgetSignal) return false;

  return (
    /(?:куда|где)\s*(?:то\s*)?(?:сходить|пойти|погулять)/u.test(normalized) ||
    /хочу\s+(?:куда(?:-|\s)?то\s+)?(?:сходить|пойти|погулять|развеяться|отдохнуть)/u.test(
      normalized
    ) ||
    /(?:мероприят|событи|афиш|концерт|театр|выставк|музе|стендап|кино|досуг)/u.test(normalized)
  );
}

function normalizeFreeBudgetSlots(slots, text) {
  if (!Array.isArray(slots)) return;

  const hasBudgetSlot = slots.some((slot) => slot && isBudgetSlotName(slot.name));
  const freeBudgetRequest = looksLikeFreeBudgetLeisureRequest(text);
  const relativeCheaperRequest = looksLikeRelativeCheaperBudgetRequest(text);

  // "Подешевле" = относительное снижение цены, а не бесплатный сценарий.
  // Для таких фраз planner сам рассчитает адекватный потолок бюджета.
  if (!freeBudgetRequest && relativeCheaperRequest) {
    return;
  }

  let normalizedExistingBudget = false;
  slots.forEach((slot) => {
    if (!slot || !isBudgetSlotName(slot.name)) {
      return;
    }

    if (isExplicitAnyBudgetValue(slot.value)) {
      return;
    }

    if (!freeBudgetRequest && !isFreeBudgetValue(slot.value)) {
      return;
    }

    slot.name = slot.name === 'цена' ? 'цена_до' : slot.name;
    slot.value = '1';
    slot.confidence = typeof slot.confidence === 'number' ? Math.max(slot.confidence, 0.85) : 0.85;
    slot.source = slot.source || 'heuristic_free_budget';
    normalizedExistingBudget = true;
  });

  if (normalizedExistingBudget) {
    console.log('[queueService] Нормализован free-бюджет в числовой лимит: 1 руб.');
    return;
  }

  if (!hasBudgetSlot && freeBudgetRequest) {
    slots.push({
      name: 'цена_до',
      value: '1',
      confidence: 0.92,
      source: 'heuristic_free_budget',
    });
    console.log('[queueService] Добавлен эвристический слот бюджета для free-запроса: цена_до=1');
  }
}

export {
  normalizeBudgetSlots,
  isExplicitAnyBudgetValue,
  looksLikeRelativeCheaperBudgetRequest,
  normalizeFreeBudgetSlots,
};
