const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { parseServices } = require('./service-config.cjs');

test('service definitions select the correct entrypoints and ports', () => {
  const services = parseServices(
    '# services\r\nai-gateway:3001\r\nweb-interface:8080\r\n',
    '/project'
  );
  assert.deepEqual(services, [
    {
      name: 'ai-gateway',
      port: 3001,
      directory: path.join('/project', 'microservices', 'ai-gateway'),
      entry: 'src/index.js',
    },
    {
      name: 'web-interface',
      port: 8080,
      directory: path.join('/project', 'web-interface'),
      entry: 'server.js',
    },
  ]);
});

test('invalid, duplicate and unknown service definitions are rejected', () => {
  for (const source of [
    '',
    'ai-gateway:0',
    'ai-tools:70000',
    '../service:3001',
    'unknown:3001',
    'ai-tools:3003\nai-tools:3004',
    'ai-tools:3003\nai-planner:3003',
  ]) {
    assert.throws(() => parseServices(source, '/project'), undefined, source);
  }
});
