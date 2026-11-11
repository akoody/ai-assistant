import { describe, expect, test } from '@jest/globals';
import { inferUiSlotFromButtons } from './quickButtonsService.js';

describe('quickButtonsService', () => {
  test('infers numeric budget slot from budget clarification buttons', () => {
    expect(
      inferUiSlotFromButtons('До 3000₽', [
        'До 500₽',
        'До 1000₽',
        'До 3000₽',
        'До 5000₽',
        'Не важно',
      ])
    ).toEqual({
      name: 'цена_до',
      value: '3000',
      confidence: 1.0,
      source: 'ui',
    });
  });

  test('infers any-budget slot from "Не важно" button', () => {
    expect(
      inferUiSlotFromButtons('Не важно', [
        'До 500₽',
        'До 1000₽',
        'До 3000₽',
        'До 5000₽',
        'Не важно',
      ])
    ).toEqual({
      name: 'бюджет',
      value: 'любой',
      confidence: 1.0,
      source: 'ui',
    });
  });
});
