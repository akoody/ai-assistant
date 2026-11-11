// End-to-end check of POST /api/chat/message: HTTP, auth, slot extraction, the response
// pipeline, the Kassir search and offer delivery run for real. Only MongoDB (in memory) and
// the neighbouring services (via fetch) are replaced.
import { afterAll, beforeEach, describe, expect, jest, test } from '@jest/globals';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.DETERMINISTIC_CLARIFICATION = '1';

function matches(document, query = {}) {
  return Object.entries(query).every(([key, expected]) => {
    const actual = key.split('.').reduce((value, part) => value?.[part], document);
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      if ('$in' in expected) return expected.$in.includes(actual);
      if ('$ne' in expected) return actual !== expected.$ne;
      if ('$exists' in expected) return (actual !== undefined) === expected.$exists;
      if ('$gte' in expected || '$lte' in expected || '$gt' in expected || '$lt' in expected) {
        return (
          (!('$gte' in expected) || actual >= expected.$gte) &&
          (!('$lte' in expected) || actual <= expected.$lte) &&
          (!('$gt' in expected) || actual > expected.$gt) &&
          (!('$lt' in expected) || actual < expected.$lt)
        );
      }
    }
    return JSON.stringify(actual) === JSON.stringify(expected);
  });
}

function applyUpdate(document, update) {
  const isOperatorUpdate = Object.keys(update).some((key) => key.startsWith('$'));
  if (!isOperatorUpdate) return { ...update };
  const next = { ...document };
  Object.assign(next, update.$set || {});
  for (const [key, value] of Object.entries(update.$push || {})) {
    const items = value && typeof value === 'object' && '$each' in value ? value.$each : [value];
    next[key] = [...(next[key] || []), ...items];
  }
  for (const [key, value] of Object.entries(update.$inc || {}))
    next[key] = (next[key] || 0) + value;
  for (const key of Object.keys(update.$unset || {})) delete next[key];
  return next;
}

function createCollection(documents = []) {
  return {
    documents,
    async findOne(query) {
      return documents.find((document) => matches(document, query)) || null;
    },
    find(query) {
      let result = documents.filter((document) => matches(document, query));
      const cursor = {
        sort(order = {}) {
          const [[field, direction] = []] = Object.entries(order);
          if (field) {
            result = [...result].sort((a, b) => (a[field] > b[field] ? direction : -direction));
          }
          return cursor;
        },
        limit(count) {
          result = result.slice(0, count);
          return cursor;
        },
        async toArray() {
          return result;
        },
      };
      return cursor;
    },
    async insertOne(document) {
      documents.push({ _id: `id-${documents.length + 1}`, ...document });
      return { insertedId: documents.at(-1)._id };
    },
    async updateOne(filter, update, options = {}) {
      const index = documents.findIndex((document) => matches(document, filter));
      if (index === -1) {
        if (!options.upsert) return { matchedCount: 0, modifiedCount: 0 };
        documents.push(applyUpdate({ ...filter, ...(update.$setOnInsert || {}) }, update));
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
      }
      documents[index] = applyUpdate(documents[index], update);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async deleteOne(filter) {
      const index = documents.findIndex((document) => matches(document, filter));
      if (index !== -1) documents.splice(index, 1);
      return { deletedCount: index === -1 ? 0 : 1 };
    },
    async deleteMany(filter) {
      const before = documents.length;
      documents.splice(
        0,
        documents.length,
        ...documents.filter((document) => !matches(document, filter))
      );
      return { deletedCount: before - documents.length };
    },
  };
}

const SEARCH_EXTRACTION = {
  slots: [
    { name: 'город', value: 'Москва', confidence: 0.98 },
    { name: 'тип_мероприятия', value: 'концерты', confidence: 0.97 },
    { name: 'жанр_музыки', value: 'рок', confidence: 0.95 },
  ],
  intents: [{ name: 'recommendations_request', confidence: 0.99 }],
};
let slotExtraction;
let collections;
const getCollection = jest.fn(async (name) => {
  collections[name] ||= createCollection();
  return collections[name];
});
jest.unstable_mockModule('../services/database.js', () => ({
  getCollection,
  getDatabase: async () => ({ collection: getCollection }),
  getClient: async () => ({}),
  closeConnection: async () => {},
}));

const statusUpdates = [];
jest.unstable_mockModule('../services/statusService.js', () => ({
  createStatus: (requestId, status) => statusUpdates.push({ requestId, status }),
  updateStatus: (requestId, status) => statusUpdates.push({ requestId, status }),
  removeStatus: () => {},
  addStatusListener: () => {},
  getStatus: () => null,
  cleanupOldStatuses: () => {},
}));

const { createApp } = await import('../app.js');
const { getTestApiKey } = await import('../services/configService.js');
const API_KEY = getTestApiKey();

const consoleSpies = ['log', 'warn', 'error', 'info'].map((method) =>
  jest.spyOn(console, method).mockImplementation(() => {})
);
const originalFetch = globalThis.fetch;
const externalCalls = [];

const KASSIR_EVENTS = [
  {
    object: {
      id: 101,
      title: 'Рок-концерт «Северный ветер»',
      beginsAt: '2026-11-20T19:00:00+03:00',
      endsAt: '2026-11-20T21:00:00+03:00',
      url: 'https://msk.kassir.ru/koncert/severnyy-veter',
      cityName: 'Москва',
      venue: { name: 'Клуб «Арена»' },
      priceRange: { min: 1500, max: 3500 },
      description: 'Большой концерт рок-группы с новой программой и хитами прошлых лет.',
    },
  },
  {
    object: {
      id: 102,
      title: 'Рок-фестиваль «Город огней»',
      beginsAt: '2026-11-22T18:00:00+03:00',
      endsAt: '2026-11-22T23:00:00+03:00',
      url: 'https://msk.kassir.ru/koncert/gorod-ogney',
      cityName: 'Москва',
      venue: { name: 'Концертный зал «Восток»' },
      priceRange: { min: 2000, max: 5000 },
      description: 'Вечер живой рок-музыки: несколько групп на одной сцене.',
    },
  },
];

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function llmResponse(content) {
  return jsonResponse({ choices: [{ message: { content } }] });
}

async function fakeFetch(url, options = {}) {
  const target = String(url);
  const body = options.body ? JSON.parse(options.body) : null;
  externalCalls.push({ url: target, body });

  if (target.endsWith('/api/slots/extract')) {
    return jsonResponse({ success: true, ...slotExtraction });
  }
  if (target.endsWith('/api/tools/kassir-api/search')) {
    return jsonResponse({
      success: true,
      data: {
        items: KASSIR_EVENTS,
        pagination: { pagesCount: 1, currentPage: 1 },
        meta: {},
      },
    });
  }
  if (target.includes('/api/tools/')) {
    return jsonResponse({ success: true, data: null });
  }
  if (target.endsWith('/api/chat/completions')) {
    return llmResponse(
      JSON.stringify({
        text: 'Нашёл для вас рок-концерты в Москве на ближайшие дни.',
        buttons: ['Показать другие варианты'],
      })
    );
  }
  throw new TypeError(`Unexpected external request in chat flow test: ${target}`);
}

beforeEach(() => {
  collections = {};
  slotExtraction = SEARCH_EXTRACTION;
  statusUpdates.length = 0;
  externalCalls.length = 0;
  globalThis.fetch = jest.fn(fakeFetch);
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  for (const spy of consoleSpies) spy.mockRestore();
});

describe('POST /api/chat/message', () => {
  test('rejects requests without the internal API key', async () => {
    const response = await request(createApp())
      .post('/api/chat/message')
      .send({ userId: 'flow-user', message: 'привет' });

    expect(response.status).toBe(401);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('turns a search request into an offer with Kassir events', async () => {
    const response = await request(createApp())
      .post('/api/chat/message')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({
        userId: 'flow-user',
        message: 'покажи рок концерты в Москве',
        requestId: 'flow-request',
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.requestId).toBe('flow-request');

    const offerEvents = response.body.offer?.events || [];
    expect(offerEvents.map((event) => event.title)).toEqual(
      expect.arrayContaining(['Рок-концерт «Северный ветер»'])
    );

    const searchCall = externalCalls.find((call) => call.url.endsWith('/kassir-api/search'));
    expect(searchCall.body).toMatchObject({ domain: 'msk.kassir.ru' });
    expect(searchCall.body.context.requestId).toBe('flow-request');

    // The progress status reported while candidate events are analysed.
    expect(statusUpdates).toContainEqual({
      requestId: 'flow-request',
      status: 'Анализируем афиши...',
    });

    const messages = collections.messages?.documents || [];
    expect(messages.map((message) => message.role)).toEqual(
      expect.arrayContaining(['user', 'assistant'])
    );
  }, 30000);
  test('an off-topic guess that names an event on sale continues as a search', async () => {
    slotExtraction = {
      slots: [{ name: 'город', value: 'Москва', confidence: 0.98 }],
      intents: [{ name: 'off_topic', confidence: 0.9 }],
    };

    const response = await request(createApp())
      .post('/api/chat/message')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({ userId: 'flow-user', message: 'Северный ветер', requestId: 'flow-offtopic' });

    expect(response.status).toBe(200);
    expect((response.body.offer?.events || []).map((event) => event.title)).toContain(
      'Рок-концерт «Северный ветер»'
    );
  }, 30000);
});
