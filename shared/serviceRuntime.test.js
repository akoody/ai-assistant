import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServiceApp, positiveIntegerFromEnv, runService } from './serviceRuntime.js';

const silentLog = { log() {}, error() {} };

function fakeProcess() {
  const emitter = new EventEmitter();
  emitter.exitCode = undefined;
  emitter.exit = (code) => {
    emitter.exited = code;
  };
  return emitter;
}

function fakeApp({ failListen = false } = {}) {
  const server = new EventEmitter();
  server.listening = false;
  server.close = (callback) => {
    server.listening = false;
    server.closed = true;
    callback();
  };
  return {
    server,
    listen(port, callback) {
      server.port = port;
      queueMicrotask(() => {
        if (failListen) {
          server.emit('error', new Error('EADDRINUSE'));
          return;
        }
        server.listening = true;
        callback();
      });
      return server;
    },
  };
}

describe('positiveIntegerFromEnv', () => {
  test('reads positive integers and falls back otherwise', () => {
    process.env.UNIT_TIMEOUT = '1500';
    assert.equal(positiveIntegerFromEnv('UNIT_TIMEOUT', 10), 1500);
    process.env.UNIT_TIMEOUT = '-3';
    assert.equal(positiveIntegerFromEnv('UNIT_TIMEOUT', 10), 10);
    delete process.env.UNIT_TIMEOUT;
    assert.equal(positiveIntegerFromEnv('UNIT_TIMEOUT', 10), 10);
  });
});

describe('createServiceApp', () => {
  test('mounts routes between the body parser and the error handlers', () => {
    const calls = [];
    const express = () => ({ use: (...args) => calls.push(args) });
    express.json = (options) => ({ json: options });
    const router = () => {};

    createServiceApp({ express, routes: [['/api/x', router]], jsonLimit: '1mb', log: silentLog });

    assert.deepEqual(calls[0], [{ json: { limit: '1mb' } }]);
    assert.deepEqual(calls[2], ['/api/x', router]);
    assert.equal(calls[3][0].length, 4, 'error handler has four parameters');
    assert.equal(calls.length, 5);
  });
});

describe('runService', () => {
  test('starts, applies timeouts and shuts down once on a signal', async () => {
    const processRef = fakeProcess();
    const app = fakeApp();
    const order = [];

    const { server } = await runService({
      name: 'unit',
      port: 4321,
      app,
      start: async () => order.push('start'),
      stop: async () => order.push('stop'),
      timeouts: { requestTimeout: 1000 },
      processRef,
      log: silentLog,
    });
    assert.equal(server.port, 4321);
    assert.equal(server.requestTimeout, 1000);

    processRef.emit('SIGTERM');
    processRef.emit('SIGINT');
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(server.closed, true);
    assert.deepEqual(order, ['start', 'stop']);
    assert.equal(processRef.exited, 0);
  });

  test('a failed start releases resources and sets a failure exit code', async () => {
    const processRef = fakeProcess();
    let stopped = false;

    const { server } = await runService({
      name: 'unit',
      port: 1,
      app: fakeApp(),
      start: async () => {
        throw new Error('MongoDB unavailable');
      },
      stop: async () => {
        stopped = true;
      },
      processRef,
      log: silentLog,
    });

    assert.equal(server, null);
    assert.equal(stopped, true);
    assert.equal(processRef.exited, 1);
  });

  test('a port that cannot be opened is reported as a failed start', async () => {
    const processRef = fakeProcess();
    await runService({
      name: 'unit',
      port: 1,
      app: fakeApp({ failListen: true }),
      processRef,
      log: silentLog,
    });
    assert.equal(processRef.exited, 1);
  });
});
