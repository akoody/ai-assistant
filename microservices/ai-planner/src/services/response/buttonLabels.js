import { normalizeText } from './textUtils.js';

const BUTTON_LABEL_NORMALIZATION_RULES = Object.freeze([
  { pattern: /вечеир/giu, replacement: 'вечер' },
  { pattern: /вечe?rом/giu, replacement: 'Вечером' },
  { pattern: /вечеи?рнк/giu, replacement: 'вечеринк' },
  { pattern: /стэндап/giu, replacement: 'Стендап' },
]);

function normalizeAssistantButtonLabel(button = '') {
  let normalized = String(button || '').trim();
  if (!normalized) {
    return '';
  }

  BUTTON_LABEL_NORMALIZATION_RULES.forEach(({ pattern, replacement }) => {
    normalized = normalized.replace(pattern, replacement);
  });

  if (normalizeText(normalized) === 'стендап') {
    return 'Стендап';
  }

  return normalized;
}

export { normalizeAssistantButtonLabel };
