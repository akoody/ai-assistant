import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { enrichSlotWithDate } from '../services/dateParsingService.js';
import {
  extractDateHintFromText,
  extractTimeHintFromText,
} from '../services/naturalLanguageHints.js';

describe('ai-slots date parsing and hints', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-07T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('parses "послезавтра" as the day after tomorrow instead of tomorrow', () => {
    const slot = enrichSlotWithDate({
      name: 'концерт_дата',
      value: 'послезавтра',
      confidence: 0.95,
    });

    expect(slot.parsedDate).toBeInstanceOf(Date);
    expect(slot.parsedDate.getFullYear()).toBe(2026);
    expect(slot.parsedDate.getMonth()).toBe(3);
    expect(slot.parsedDate.getDate()).toBe(9);
  });

  test('extracts month-only date hint from a generic recommendation request', () => {
    expect(extractDateHintFromText('Привет, хочу сходить куда-нибудь в Октябре')).toBe('в октябре');
  });

  test('extracts complex date phrases as a single hint', () => {
    expect(extractDateHintFromText('Хочу что-нибудь с 5 по 12 октября')).toBe('с 5 по 12 октября');
    expect(extractDateHintFromText('Хочу выбраться на будущей неделе ближе к четвергу')).toBe(
      'на будущей неделе ближе к четвергу'
    );
    expect(extractDateHintFromText('Хочу выбраться в следующем месяце')).toBe('в следующем месяце');
    expect(extractDateHintFromText('Давай что-нибудь в конце октября')).toBe('в конце октября');
    expect(extractDateHintFromText('Реп концерт через месяц')).toBe('через месяц');
    expect(extractDateHintFromText('Хочу на рок концерт через 2 недели')).toBe('через 2 недели');
    expect(extractDateHintFromText('Ищу вариант через две недели')).toBe('через две недели');
    expect(extractDateHintFromText('Хочу на следующих выходных на какой-нибудь спектакль')).toBe(
      'на следующих выходных'
    );
  });

  test('does not treat birthday wording as a daytime hint', () => {
    expect(extractTimeHintFromText('30 апреля 2026 где отметить День рождения')).toBe('');
    expect(extractTimeHintFromText('Хочу днем сходить на выставку')).toBe('днем');
  });

  test('enriches month-only slot with a full date range', () => {
    const slot = enrichSlotWithDate({
      name: 'дата_события',
      value: 'в октябре',
      confidence: 0.9,
    });

    expect(slot.dateRange).toBeDefined();
    expect(slot.dateRange.startDate.getFullYear()).toBe(2026);
    expect(slot.dateRange.startDate.getMonth()).toBe(9);
    expect(slot.dateRange.startDate.getDate()).toBe(1);
    expect(slot.dateRange.endDate.getFullYear()).toBe(2026);
    expect(slot.dateRange.endDate.getMonth()).toBe(9);
    expect(slot.dateRange.endDate.getDate()).toBe(31);
  });

  test('parses same-month date ranges like "с 5 по 12 октября"', () => {
    const slot = enrichSlotWithDate({
      name: 'дата_события',
      value: 'с 5 по 12 октября',
      confidence: 0.9,
    });

    expect(slot.dateRange).toBeDefined();
    expect(slot.dateRange.startDate.getFullYear()).toBe(2026);
    expect(slot.dateRange.startDate.getMonth()).toBe(9);
    expect(slot.dateRange.startDate.getDate()).toBe(5);
    expect(slot.dateRange.endDate.getFullYear()).toBe(2026);
    expect(slot.dateRange.endDate.getMonth()).toBe(9);
    expect(slot.dateRange.endDate.getDate()).toBe(12);
  });

  test('parses qualified weekday on a future week', () => {
    const slot = enrichSlotWithDate({
      name: 'дата_события',
      value: 'на будущей неделе ближе к четвергу',
      confidence: 0.9,
    });

    expect(slot.parsedDate).toBeInstanceOf(Date);
    expect(slot.parsedDate.getFullYear()).toBe(2026);
    expect(slot.parsedDate.getMonth()).toBe(3);
    expect(slot.parsedDate.getDate()).toBe(16);
  });

  test('parses month parts like beginning and end of month', () => {
    const endSlot = enrichSlotWithDate({
      name: 'дата_события',
      value: 'в конце октября',
      confidence: 0.9,
    });
    const startSlot = enrichSlotWithDate({
      name: 'дата_события',
      value: 'в начале ноября',
      confidence: 0.9,
    });

    expect(endSlot.dateRange).toBeDefined();
    expect(endSlot.dateRange.startDate.getMonth()).toBe(9);
    expect(endSlot.dateRange.startDate.getDate()).toBe(21);
    expect(endSlot.dateRange.endDate.getMonth()).toBe(9);
    expect(endSlot.dateRange.endDate.getDate()).toBe(31);

    expect(startSlot.dateRange).toBeDefined();
    expect(startSlot.dateRange.startDate.getMonth()).toBe(10);
    expect(startSlot.dateRange.startDate.getDate()).toBe(1);
    expect(startSlot.dateRange.endDate.getMonth()).toBe(10);
    expect(startSlot.dateRange.endDate.getDate()).toBe(10);
  });

  test('parses "через 2 недели" as target calendar week range', () => {
    jest.setSystemTime(new Date('2026-04-14T12:00:00.000Z'));
    const slot = enrichSlotWithDate({
      name: 'дата_события',
      value: 'через 2 недели',
      confidence: 0.95,
    });

    expect(slot.dateRange).toBeDefined();
    expect(slot.dateRange.startDate.getFullYear()).toBe(2026);
    expect(slot.dateRange.startDate.getMonth()).toBe(3);
    expect(slot.dateRange.startDate.getDate()).toBe(27);
    expect(slot.dateRange.endDate.getFullYear()).toBe(2026);
    expect(slot.dateRange.endDate.getMonth()).toBe(4);
    expect(slot.dateRange.endDate.getDate()).toBe(3);
  });

  test('parses "через две недели" as target calendar week range', () => {
    jest.setSystemTime(new Date('2026-04-14T12:00:00.000Z'));
    const slot = enrichSlotWithDate({
      name: 'дата_события',
      value: 'через две недели',
      confidence: 0.95,
    });

    expect(slot.dateRange).toBeDefined();
    expect(slot.dateRange.startDate.getDate()).toBe(27);
    expect(slot.dateRange.endDate.getDate()).toBe(3);
  });

  test('parses "через 2 месяца" as full target month range', () => {
    jest.setSystemTime(new Date('2026-04-14T12:00:00.000Z'));
    const slot = enrichSlotWithDate({
      name: 'дата_события',
      value: 'через 2 месяца',
      confidence: 0.95,
    });

    expect(slot.dateRange).toBeDefined();
    expect(slot.dateRange.startDate.getFullYear()).toBe(2026);
    expect(slot.dateRange.startDate.getMonth()).toBe(5);
    expect(slot.dateRange.startDate.getDate()).toBe(1);
    expect(slot.dateRange.endDate.getMonth()).toBe(5);
    expect(slot.dateRange.endDate.getDate()).toBe(30);
  });

  test('parses "через месяц" as the next full month range', () => {
    jest.setSystemTime(new Date('2026-04-14T12:00:00.000Z'));
    const slot = enrichSlotWithDate({
      name: 'дата_события',
      value: 'через месяц',
      confidence: 0.95,
    });

    expect(slot.dateRange).toBeDefined();
    expect(slot.dateRange.startDate.getFullYear()).toBe(2026);
    expect(slot.dateRange.startDate.getMonth()).toBe(4);
    expect(slot.dateRange.startDate.getDate()).toBe(1);
    expect(slot.dateRange.endDate.getFullYear()).toBe(2026);
    expect(slot.dateRange.endDate.getMonth()).toBe(4);
    expect(slot.dateRange.endDate.getDate()).toBe(31);
  });

  test('parses "в следующем месяце" as the next full month range', () => {
    const slot = enrichSlotWithDate({
      name: 'дата_события',
      value: 'в следующем месяце',
      confidence: 0.95,
    });

    expect(slot.dateRange).toBeDefined();
    expect(slot.dateRange.startDate.getFullYear()).toBe(2026);
    expect(slot.dateRange.startDate.getMonth()).toBe(4);
    expect(slot.dateRange.startDate.getDate()).toBe(1);
    expect(slot.dateRange.endDate.getFullYear()).toBe(2026);
    expect(slot.dateRange.endDate.getMonth()).toBe(4);
    expect(slot.dateRange.endDate.getDate()).toBe(31);
  });

  test('parses "следующие выходные" as the nearest upcoming weekend', () => {
    jest.setSystemTime(new Date('2026-04-14T12:00:00.000Z'));
    const slot = enrichSlotWithDate({
      name: 'дата_события',
      value: 'следующие выходные',
      confidence: 0.95,
    });

    expect(slot.dateRange).toBeDefined();
    expect(slot.dateRange.startDate.getFullYear()).toBe(2026);
    expect(slot.dateRange.startDate.getMonth()).toBe(3);
    expect(slot.dateRange.startDate.getDate()).toBe(18);
    expect(slot.dateRange.endDate.getFullYear()).toBe(2026);
    expect(slot.dateRange.endDate.getMonth()).toBe(3);
    expect(slot.dateRange.endDate.getDate()).toBe(19);
  });
});
