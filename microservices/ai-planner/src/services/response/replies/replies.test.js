// Contracts of routing handlers that can either answer or let routing continue with
// updated state: { kind: 'reply' } | { kind: 'continue', ...state } | null.
import { afterAll, beforeEach, describe, expect, jest, test } from '@jest/globals';

const probeResult = { hasMatchingEvents: false, slots: [], events: [] };
const savedSlots = [];
jest.unstable_mockModule('../eventProbe.js', () => ({
  probeKassirEventsForOffTopicCandidate: jest.fn(async () => probeResult),
  summarizeOffTopicProbeEvent: () => null,
}));
jest.unstable_mockModule('../../slotsService.js', () => ({
  getCurrentSessionSlots: jest.fn(async () => [{ name: 'город', value: 'Москва' }]),
  saveSlotToDatabase: jest.fn(async (userId, slot) => savedSlots.push(slot)),
}));
jest.unstable_mockModule('../../sessionService.js', () => ({
  updateOffTopicContextResetPending: jest.fn(async () => {}),
}));

const { respondToOffTopicCandidate } = await import('./respondToOffTopicCandidate.js');
const { respondToSmalltalk } = await import('./respondToSmalltalk.js');

const consoleSpies = ['log', 'warn', 'error'].map((method) =>
  jest.spyOn(console, method).mockImplementation(() => {})
);
afterAll(() => consoleSpies.forEach((spy) => spy.mockRestore()));

const offTopicInput = (overrides = {}) => ({
  userId: 'u1',
  sessionId: 's1',
  userMessage: 'Щелкунчик',
  requestId: null,
  offTopicIntent: { name: 'off_topic', confidence: 0.95 },
  detectedIntents: [{ name: 'off_topic', confidence: 0.95 }],
  recommendationsIntent: null,
  slotExtractionResult: null,
  session: {},
  slashCommand: null,
  preferenceMemoryRequest: { wantsAnyPreferenceMemory: false },
  hasExplicitCategoryInUserMessage: false,
  hasExplicitSeniorCompanion: false,
  hasNonCityExtractedSlot: false,
  recoveredUiSlot: null,
  isShowMoreRequest: false,
  isEventDetailsRequest: false,
  isQuickCategorySelection: false,
  isButtonEcho: false,
  isBuyTicketsUiCommand: false,
  ...overrides,
});

beforeEach(() => {
  savedSlots.length = 0;
  Object.assign(probeResult, { hasMatchingEvents: false, slots: [], events: [] });
  process.env.OFFTOPIC_REDIRECT_USE_LLM = '0';
});

describe('respondToOffTopicCandidate', () => {
  test('is not applicable to messages that are not off-topic', async () => {
    expect(await respondToOffTopicCandidate(offTopicInput({ offTopicIntent: null }))).toBeNull();
  });

  test('continues the search with probe slots when the catalog has matching events', async () => {
    Object.assign(probeResult, {
      hasMatchingEvents: true,
      slots: [
        { name: 'город', value: 'Москва' },
        { name: 'название_мероприятия', value: 'Щелкунчик' },
      ],
      events: [{ title: 'Щелкунчик' }],
    });
    const input = offTopicInput();

    const outcome = await respondToOffTopicCandidate(input);

    expect(outcome).toMatchObject({
      kind: 'continue',
      slotExtractionResult: {
        slots: [{ name: 'название_мероприятия', value: 'Щелкунчик' }],
      },
      recommendationsIntent: {
        name: 'recommendations_request',
        source: 'offtopic_event_probe',
      },
    });
    expect(savedSlots).toEqual([{ name: 'название_мероприятия', value: 'Щелкунчик' }]);
    expect(input.detectedIntents.map((intent) => intent.name)).toContain('recommendations_request');
  });

  test('answers with a redirect and marks the context reset when nothing is on sale', async () => {
    const input = offTopicInput({ userMessage: 'какая погода завтра?' });

    const outcome = await respondToOffTopicCandidate(input);

    expect(outcome.kind).toBe('reply');
    expect(typeof outcome.response.message).toBe('string');
    expect(input.session.offTopicContextResetPending).toBe(true);
  });
});

describe('respondToSmalltalk', () => {
  const smalltalkInput = (overrides = {}) => ({
    userId: 'u1',
    sessionId: 's1',
    requestId: null,
    hasRecommendationsIntent: false,
    smalltalkIntent: { name: 'smalltalk', kind: 'ack' },
    slotExtractionResult: { slots: [], intents: [] },
    session: {
      clarificationAsked: true,
      slotsSnapshot: [{ name: 'исполнитель', value: 'Земфира' }],
    },
    userMessage: 'да',
    ...overrides,
  });

  test('is not applicable without a smalltalk intent', async () => {
    expect(await respondToSmalltalk(smalltalkInput({ smalltalkIntent: null }))).toBeNull();
  });

  test('a "да" during clarification continues the search with the inferred event type', async () => {
    const outcome = await respondToSmalltalk(smalltalkInput());

    expect(outcome).toEqual({
      kind: 'continue',
      slotExtractionResult: {
        slots: [{ name: 'тип_мероприятия', value: 'концерты', confidence: 0.9 }],
        intents: [],
      },
    });
  });

  test('creates the extraction result when slot extraction returned nothing', async () => {
    const outcome = await respondToSmalltalk(smalltalkInput({ slotExtractionResult: null }));

    expect(outcome.kind).toBe('continue');
    expect(outcome.slotExtractionResult.slots).toEqual([
      { name: 'тип_мероприятия', value: 'концерты', confidence: 0.9 },
    ]);
  });
});
