const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const suites = [
  ['shared', process.execPath, ['--test', 'shared/*.test.js', 'scripts/*.test.cjs'], root],
  ...['ai-gateway', 'ai-planner', 'ai-slots', 'ai-tools'].map((name) => [
    name,
    npm,
    ['test', '--', '--runInBand'],
    path.join(root, 'microservices', name),
  ]),
  ['web-interface', npm, ['test'], path.join(root, 'web-interface')],
];
let failed = false;
for (const [name, command, args, cwd] of suites) {
  console.log(`\nRunning ${name} tests`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test' },
    shell: process.platform === 'win32',
  });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) failed = true;
}
if (failed) process.exitCode = 1;
