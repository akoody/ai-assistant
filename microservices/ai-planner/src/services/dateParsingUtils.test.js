import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import {
  coalesceDateSlotsIntoRange,
  enrichSlotWithDate,
  enrichSlotWithDateConsideringSlots,
  isCalendarSchedulingSearchNoiseToken,
  isCalendarSchedulingOnlySearchString,
  mergeSlotsWithImplicitDateFromUserMessage,
} from './dateParsingUtils.js';
import { extractDateHintFromText } from './naturalLanguageHints.js';

describe('ai-planner date parsing utils', () => {
  test('flags weekday and weekend tokens as calendar scheduling noise for search', () => {
    expect(isCalendarSchedulingSearchNoiseToken('субботу')).toBe(true);
    expect(isCalendarSchedulingSearchNoiseToken('выходные')).toBe(true);
    expect(isCalendarSchedulingSearchNoiseToken('неделю')).toBe(true);
    expect(isCalendarSchedulingSearchNoiseToken('рок')).toBe(false);
    expect(isCalendarSchedulingOnlySearchString('ближайшие выходные')).toBe(true);
    expect(isCalendarSchedulingOnlySearchString('субботу')).toBe(true);
  });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-07T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('parses "послезавтра" as the day after tomorrow', () => {
    const slot = enrichSlotWithDate({
      name: 'дата_события',
      value: 'послезавтра',
      confidence: 0.95,
    });

    expect(slot.parsedDate).toBeInstanceOf(Date);
    expect(slot.parsedDate.getFullYear()).toBe(2026);
    expect(slot.parsedDate.getMonth()).toBe(3);
    expect(slot.parsedDate.getDate()).toBe(9);
  });

  test('extracts month-only hint from greeting-based recommendation request', () => {
    expect(extractDateHintFromText('Привет, хочу сходить куда-нибудь в Октябре')).toBe('в октябре');
  });

  test('extracts extended date phrases as one hint', () => {
    expect(extractDateHintFromText('Хочу что-нибудь с 5 по 12 октября')).toBe('с 5 по 12 октября');
    expect(extractDateHintFromText('Хочу выбраться на будущей неделе ближе к четвергу')).toBe(
      'на будущей неделе ближе к четвергу'
    );
    expect(extractDateHintFromText('Хочу выбраться в следующем месяце')).toBe('в следующем месяце');
    expect(extractDateHintFromText('Давай что-нибудь в конце октября')).toBe('в конце октября');
    expect(extractDateHintFromText('Хочу на рок концерт через 2 недели')).toBe('через 2 недели');
    expect(extractDateHintFromText('Ищу вариант через две недели')).toBe('через две недели');
  });

  test('enriches month-only slot with October date range', () => {
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

  test('coalesces sequential discrete days into one explicit range slot', () => {
    const slots = coalesceDateSlotsIntoRange(
      [
        { name: 'дата_события', value: '24 апреля', confidence: 0.9 },
        { name: 'дата_события', value: '25 апреля', confidence: 0.9 },
        { name: 'дата_события', value: '26 апреля', confidence: 0.9 },
        { name: 'дата_события', value: '27 апреля', confidence: 0.9 },
        { name: 'город', value: 'Нижний Новгород', confidence: 0.95 },
      ],
      'С 24 по 27 апреля куда можно сходить в нижнем Новгороде'
    );

    const dateSlots = slots.filter((slot) => slot.name === 'дата_события');
    expect(dateSlots).toHaveLength(1);
    expect(dateSlots[0].value).toBe('с 24 по 27 апреля');
    expect(dateSlots[0].dateRange).toBeDefined();
    expect(dateSlots[0].dateRange.startDate.getDate()).toBe(24);
    expect(dateSlots[0].dateRange.endDate.getDate()).toBe(27);
  });

  test('does not coalesce sparse alternative dates into a fake interval', () => {
    const slots = coalesceDateSlotsIntoRange(
      [
        { name: 'дата_события', value: '24 апреля', confidence: 0.9 },
        { name: 'дата_события', value: '27 апреля', confidence: 0.9 },
        { name: 'город', value: 'Нижний Новгород', confidence: 0.95 },
      ],
      '24 или 27 апреля в Нижнем Новгороде'
    );

    expect(slots.filter((slot) => slot.name === 'дата_события')).toHaveLength(2);
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

  test('narrows "на следующей неделе" to weekend when день_недели is выходные', () => {
    const slots = [
      { name: 'день_недели', value: 'выходные', confidence: 0.85 },
      { name: 'дата_события', value: 'на следующей неделе', confidence: 0.9 },
    ];
    const dateSlot = slots.find((s) => s.name === 'дата_события');
    const enriched = enrichSlotWithDateConsideringSlots(dateSlot, slots);

    expect(enriched.dateRange).toBeDefined();
    expect(enriched.dateRange.startDate.getFullYear()).toBe(2026);
    expect(enriched.dateRange.startDate.getMonth()).toBe(3);
    expect(enriched.dateRange.startDate.getDate()).toBe(18);
    expect(enriched.dateRange.endDate.getFullYear()).toBe(2026);
    expect(enriched.dateRange.endDate.getMonth()).toBe(3);
    expect(enriched.dateRange.endDate.getDate()).toBe(19);
  });

  test('keeps full week for "на следующей неделе" without день_недели выходные', () => {
    const slots = [{ name: 'дата_события', value: 'на следующей неделе', confidence: 0.9 }];
    const enriched = enrichSlotWithDateConsideringSlots(slots[0], slots);

    expect(enriched.dateRange).toBeDefined();
    expect(enriched.dateRange.startDate.getDate()).toBe(13);
    expect(enriched.dateRange.endDate.getDate()).toBe(19);
  });

  test('narrows slot "следующая неделя" to weekend when user message mentions выходные', () => {
    const slots = [{ name: 'дата_события', value: 'следующая неделя', confidence: 0.9 }];
    const userText = 'Хочу на рок концерт в выходные на следующей неделе';
    const enriched = enrichSlotWithDateConsideringSlots(slots[0], slots, userText);

    expect(enriched.dateRange).toBeDefined();
    expect(enriched.dateRange.startDate.getFullYear()).toBe(2026);
    expect(enriched.dateRange.startDate.getMonth()).toBe(3);
    expect(enriched.dateRange.startDate.getDate()).toBe(18);
    expect(enriched.dateRange.endDate.getDate()).toBe(19);
  });

  test('shifts "в выходные" to next weekend when companion slot says "выходные на следующей неделе"', () => {
    const slots = [
      { name: 'даты', value: 'выходные на следующей неделе', confidence: 0.8 },
      { name: 'дата_события', value: 'в выходные', confidence: 0.9 },
    ];
    const dateSlot = slots.find((s) => s.name === 'дата_события');
    const enriched = enrichSlotWithDateConsideringSlots(dateSlot, slots);

    expect(enriched.dateRange).toBeDefined();
    expect(enriched.dateRange.startDate.getFullYear()).toBe(2026);
    expect(enriched.dateRange.startDate.getMonth()).toBe(3);
    expect(enriched.dateRange.startDate.getDate()).toBe(18);
    expect(enriched.dateRange.endDate.getFullYear()).toBe(2026);
    expect(enriched.dateRange.endDate.getMonth()).toBe(3);
    expect(enriched.dateRange.endDate.getDate()).toBe(19);
  });

  test('parses "следующие выходные" as the nearest upcoming weekend', () => {
    jest.setSystemTime(new Date('2026-04-10T12:00:00.000Z'));
    const slot = enrichSlotWithDate({
      name: 'дата_события',
      value: 'следующие выходные',
      confidence: 0.9,
    });
    expect(slot.dateRange).toBeDefined();
    expect(slot.dateRange.startDate.getFullYear()).toBe(2026);
    expect(slot.dateRange.startDate.getMonth()).toBe(3);
    expect(slot.dateRange.startDate.getDate()).toBe(11);
    expect(slot.dateRange.endDate.getDate()).toBe(12);
  });

  test('mergeSlotsWithImplicitDateFromUserMessage adds дата_события when slots omit date', () => {
    const merged = mergeSlotsWithImplicitDateFromUserMessage(
      [{ name: 'город', value: 'Нижний Новгород' }],
      'Хочу на рок концерт в следующие выходные'
    );
    const dateSlot = merged.find((s) => s.name === 'дата_события');
    expect(dateSlot?.value).toBe('следующие выходные');
  });

  test('parses direct phrase "в выходные на следующей неделе" as next weekend', () => {
    const slot = enrichSlotWithDate({
      name: 'дата_события',
      value: 'в выходные на следующей неделе',
      confidence: 0.9,
    });

    expect(slot.dateRange).toBeDefined();
    expect(slot.dateRange.startDate.getFullYear()).toBe(2026);
    expect(slot.dateRange.startDate.getMonth()).toBe(3);
    expect(slot.dateRange.startDate.getDate()).toBe(18);
    expect(slot.dateRange.endDate.getFullYear()).toBe(2026);
    expect(slot.dateRange.endDate.getMonth()).toBe(3);
    expect(slot.dateRange.endDate.getDate()).toBe(19);
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
});
