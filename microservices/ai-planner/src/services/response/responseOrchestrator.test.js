import { afterAll, beforeEach, describe, expect, jest, test } from '@jest/globals';

process.env.DETERMINISTIC_CLARIFICATION = '1';
let databaseCalls = [];
let session;
const cursor = {
  sort() {
    return this;
  },
  limit() {
    return this;
  },
  async toArray() {
    return [];
  },
};
const getCollection = jest.fn(async (name) => ({
  async findOne() {
    return name === 'sessions' ? session : null;
  },
  find() {
    return cursor;
  },
  async updateOne(...args) {
    databaseCalls.push({ name, args });
    return { matchedCount: 1 };
  },
  async deleteMany(...args) {
    databaseCalls.push({ name, args });
    return { deletedCount: 0 };
  },
  async insertOne(...args) {
    databaseCalls.push({ name, args });
    return { insertedId: 'unit-id' };
  },
}));
jest.unstable_mockModule('../database.js', () => ({ getCollection }));
const { generateResponse } = await import('./responseOrchestrator.js');
const originalFetch = globalThis.fetch;
const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 10, 10, 12));
const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.25);
const consoleSpies = ['log', 'warn', 'error'].map((method) =>
  jest.spyOn(console, method).mockImplementation(() => {})
);

function reset() {
  databaseCalls = [];
  session = {
    userId: 'unit-user',
    sessionId: 'unit-session',
    quickOfferSent: false,
    finalOfferSent: false,
    slotsSnapshot: [],
  };
  getCollection.mockClear();
  globalThis.fetch = jest.fn(async (url) => {
    if (String(url).includes('/api/chat/completions')) {
      const json = {
        choices: [
          {
            message: {
              content: JSON.stringify({
                text: 'Помогу подобрать мероприятие. Что вам интересно?',
                buttons: ['Концерты', 'Театры', 'Выставки'],
              }),
            },
          },
        ],
      };
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify(json),
        json: async () => json,
      };
    }
    if (String(url).includes('/api/tools/')) {
      const json = { success: true, events: [], data: { activities: [], events: [] } };
      return {
        ok: true,
        status: 200,
        json: async () => json,
        text: async () => JSON.stringify(json),
        headers: new Headers(),
      };
    }
    throw new Error(`Unexpected external request: ${url}`);
  });
}
beforeEach(reset);
afterAll(() => {
  globalThis.fetch = originalFetch;
  randomSpy.mockRestore();
  dateSpy.mockRestore();
  for (const spy of consoleSpies) spy.mockRestore();
});

const scenarios = [
  { name: 'declining further recommendations', message: 'Может, позже', slots: [], intents: [] },
  { name: 'slash command', message: '/info', slots: [], intents: [] },
  { name: 'assistant identity', message: 'Кто ты?', slots: [], intents: [] },
  {
    name: 'greeting',
    message: 'привет',
    slots: [],
    intents: [{ name: 'smalltalk', kind: 'greeting', confidence: 0.99 }],
  },
  {
    name: 'mood without a city',
    message: 'хочу развеяться',
    slots: [{ name: 'настроение', value: 'весёлое' }],
    intents: [{ name: 'recommendations_request', confidence: 0.99 }],
  },
  {
    name: 'health complaint',
    message: 'у меня болит голова',
    slots: [],
    intents: [{ name: 'health_complaint', confidence: 0.99 }],
  },
  {
    name: 'search with empty catalog',
    message: 'покажи рок концерты в Москве',
    slots: [
      { name: 'город', value: 'Москва' },
      { name: 'тип_мероприятия', value: 'концерты' },
      { name: 'жанр', value: 'рок' },
    ],
    intents: [{ name: 'recommendations_request', confidence: 0.99 }],
  },
];

describe('response workflow characterization', () => {
  for (const scenario of scenarios) {
    test(scenario.name, async () => {
      const extraction = { slots: scenario.slots, intents: scenario.intents };
      const response = await generateResponse(
        'unit-user',
        'unit-session',
        scenario.message,
        structuredClone(extraction)
      );
      expect(response).toMatchSnapshot();
      if (scenario.name === 'declining further recommendations')
        expect(getCollection).not.toHaveBeenCalled();
    });
  }
});
