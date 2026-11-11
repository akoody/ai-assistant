const { spawn } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createInterface } = require('node:readline');
const { parseServices } = require('./service-config.cjs');

const root = path.resolve(__dirname, '..');
const children = new Set();
let stopping = false;
let deadline;

function stop(exitCode = 0) {
  process.exitCode = Math.max(process.exitCode || 0, exitCode);
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  if (children.size) {
    deadline = setTimeout(() => {
      for (const child of children) child.kill('SIGKILL');
    }, 10000);
  }
}

function launch(service) {
  const child = spawn(process.execPath, [service.entry], {
    cwd: service.directory,
    env: { ...process.env, PORT: String(service.port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  for (const [stream, output] of [
    [child.stdout, process.stdout],
    [child.stderr, process.stderr],
  ]) {
    createInterface({ input: stream }).on('line', (line) =>
      output.write(`[${service.name}] ${line}\n`)
    );
  }
  child.once('error', (error) => {
    console.error(`[${service.name}] ${error.message}`);
    stop(1);
  });
  child.once('close', (code, signal) => {
    children.delete(child);
    if (!stopping) {
      console.error(`[${service.name}] Process exited (code=${code}, signal=${signal})`);
      stop(code || 1);
    }
    if (!children.size) clearTimeout(deadline);
  });
}

async function main() {
  const { loadRootEnv } = await import('../shared/runtimeEnv.js');
  loadRootEnv(pathToFileURL(__filename).href);
  const services = parseServices(
    readFileSync(path.join(root, 'microservices-ports'), 'utf8'),
    root
  );
  for (const service of services) {
    console.log(`Starting ${service.name} on port ${service.port}`);
    launch(service);
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop());
main().catch((error) => {
  console.error(error.message);
  stop(1);
});
