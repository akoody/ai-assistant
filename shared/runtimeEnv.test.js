import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleUrl = new URL('./runtimeEnv.js', import.meta.url).href;
function run(source, env = {}) {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { resolveInternalApiKey, loadRootEnv } from ${JSON.stringify(moduleUrl)}; ${source}`,
    ],
    {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, NODE_ENV: 'test', ...env },
    }
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

const options = JSON.stringify({
  serviceName: 'unit',
  settingName: 'key',
  envName: 'SERVICE_KEY',
  configuredValue: 'database-secret',
});

test('service environment key takes priority over shared key and database value', () => {
  assert.equal(
    run(`console.log(resolveInternalApiKey(${options}));`, {
      SERVICE_KEY: ' service-secret ',
      INTERNAL_API_KEY: 'shared-secret',
    }),
    'service-secret'
  );
  assert.equal(
    run(`console.log(resolveInternalApiKey(${options}));`, { INTERNAL_API_KEY: 'shared-secret' }),
    'shared-secret'
  );
  assert.equal(run(`console.log(resolveInternalApiKey(${options}));`), 'database-secret');
});

test('non-test runtimes reject missing and known development keys', () => {
  for (const NODE_ENV of ['development', 'production']) {
    assert.equal(
      run(
        `try { resolveInternalApiKey({serviceName:'unit',settingName:'key'}); } catch { console.log('rejected'); }`,
        { NODE_ENV }
      ),
      'rejected'
    );
    assert.equal(
      run(
        `try { resolveInternalApiKey({serviceName:'unit',settingName:'key'}); } catch { console.log('rejected'); }`,
        { NODE_ENV, INTERNAL_API_KEY: 'test-api-key-123' }
      ),
      'rejected'
    );
  }
});

test('root environment supports quotes, comments and existing environment overrides', () => {
  const directory = mkdtempSync(join(tmpdir(), 'widget-env-'));
  try {
    mkdirSync(join(directory, 'shared'));
    mkdirSync(join(directory, 'microservices', 'unit'), { recursive: true });
    writeFileSync(
      join(directory, '.env'),
      'UNIT_A="hello world"\nexport UNIT_B=value # comment\nUNIT_KEEP=file\n'
    );
    const start = pathToFileURL(join(directory, 'microservices', 'unit', 'index.js')).href;
    assert.equal(
      run(
        `loadRootEnv(${JSON.stringify(start)}); console.log(JSON.stringify([process.env.UNIT_A,process.env.UNIT_B,process.env.UNIT_KEEP]));`,
        { UNIT_KEEP: 'environment' }
      ),
      '["hello world","value","environment"]'
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
