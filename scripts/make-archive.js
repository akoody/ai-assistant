const { mkdirSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { shouldArchive } = require('./archive-policy.cjs');

const args = process.argv.slice(2);
function readArg(flag, fallback) {
  const index = args.indexOf(flag);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
  return value;
}

function run(command, commandArgs, options) {
  const result = spawnSync(command, commandArgs, options);
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed (${result.status}): ${result.stderr || ''}`);
  return result;
}

try {
  const root = path.resolve(__dirname, '..');
  const output = path.resolve(root, readArg('--output', 'dist'));
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14);
  const name = readArg('--name', `widget-project-${timestamp}.zip`);
  if (path.basename(name) !== name || !name.endsWith('.zip'))
    throw new Error('Archive name must be a .zip filename');
  const archive = path.join(output, name);
  const outputRelative = path.relative(root, output).split(path.sep).join('/');
  const listed = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'utf8',
  });
  const files = [...new Set(listed.stdout.split('\0').filter(Boolean))]
    .filter((file) => shouldArchive(file, outputRelative))
    .filter((file) => require('node:fs').existsSync(path.join(root, file)));
  if (!files.length) throw new Error('No project files to archive');
  mkdirSync(output, { recursive: true });
  run(
    process.platform === 'win32' ? 'tar.exe' : 'tar',
    ['-a', '-cf', archive, '--null', '-T', '-'],
    {
      cwd: root,
      input: files.join('\0') + '\0',
      encoding: 'utf8',
    }
  );
  console.log(`Archive created: ${archive} (${files.length} files)`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
