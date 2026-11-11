import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMongoConnection } from './mongoConnection.js';

function fixture() {
  const clients = [];
  class Client {
    constructor() {
      this.closed = 0;
      clients.push(this);
    }
    async connect() {
      await Promise.resolve();
      return this;
    }
    async close() {
      this.closed += 1;
    }
    db(name) {
      return { name, collection: (collection) => ({ collection, client: this }) };
    }
  }
  return {
    clients,
    Client,
    connection: createMongoConnection({
      MongoClient: Client,
      uri: 'mongodb://test',
      databaseName: 'unit',
    }),
  };
}

test('concurrent database requests share a connected client', async () => {
  const { clients, connection } = fixture();
  const collections = await Promise.all(
    Array.from({ length: 20 }, () => connection.getCollection('events'))
  );
  assert.equal(clients.length, 1);
  assert.ok(collections.every((item) => item.client === clients[0]));
  await connection.closeConnection();
});

test('failed connections are closed and can be retried', async () => {
  const { clients, Client, connection } = fixture();
  const connect = Client.prototype.connect;
  Client.prototype.connect = async function () {
    if (clients.length === 1) throw new Error('connection failed');
    return connect.call(this);
  };
  await assert.rejects(connection.getClient(), /connection failed/);
  const client = await connection.getClient();
  assert.equal(clients.length, 2);
  assert.equal(clients[0].closed, 1);
  assert.equal(client, clients[1]);
  await connection.closeConnection();
});

test('shutdown during connection waits and closes once', async () => {
  const { clients, connection } = fixture();
  const pending = connection.getClient();
  await Promise.all([connection.closeConnection(), connection.closeConnection()]);
  await pending;
  assert.equal(clients[0].closed, 1);
  const client = await connection.getClient();
  assert.equal(client, clients[1]);
  await connection.closeConnection();
});

test('missing database configuration fails before constructing a client', async () => {
  const { Client, clients } = fixture();
  const connection = createMongoConnection({ MongoClient: Client });
  await assert.rejects(connection.getClient(), /MONGODB_URI and DB_NAME/);
  assert.equal(clients.length, 0);
});
