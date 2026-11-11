const { test } = require('node:test');
const assert = require('node:assert/strict');
const { shouldArchive } = require('./archive-policy.cjs');
const { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('archives exclude secrets and generated files, including tracked environment files', () => {
  for (const file of [
    '.env',
    '.env.production',
    'web/.env.local',
    'private.pem',
    'ssh-key-prod',
    '.git/config',
    'node_modules/a/index.js',
    'dist/old.zip',
    'web/server.log',
  ]) {
    assert.equal(shouldArchive(file), false, file);
  }
  for (const file of ['.env.example', 'shared/runtimeEnv.js', 'web-interface/src/config.js']) {
    assert.equal(shouldArchive(file), true, file);
  }
});

test('archive CLI packages current files and excludes a tracked secret', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'widget-archive-'));
  try {
    mkdirSync(path.join(directory, 'scripts'));
    for (const file of ['make-archive.js', 'archive-policy.cjs'])
      copyFileSync(path.join(__dirname, file), path.join(directory, 'scripts', file));
    execFileSync('git', ['init', '-q'], { cwd: directory });
    writeFileSync(path.join(directory, '.env.production'), 'SECRET=must-not-be-packaged');
    writeFileSync(path.join(directory, '.env.example'), 'SECRET=');
    writeFileSync(path.join(directory, 'source.js'), 'original');
    execFileSync('git', ['add', '.'], { cwd: directory });
    writeFileSync(path.join(directory, 'source.js'), 'modified');
    execFileSync(process.execPath, ['scripts/make-archive.js', '--name', 'unit.zip'], {
      cwd: directory,
    });
    const archive = path.join(directory, 'dist', 'unit.zip');
    const listing = execFileSync('tar', ['-tf', archive], { encoding: 'utf8' }).split('\n');
    assert.ok(listing.includes('.env.example'));
    assert.ok(!listing.includes('.env.production'));
    assert.equal(
      execFileSync('tar', ['-xOf', archive, 'source.js'], { encoding: 'utf8' }),
      'modified'
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
