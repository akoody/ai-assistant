const { readdirSync, readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const espree = require('espree');

const root = path.resolve(__dirname, '..');
const ignored = new Set(['node_modules', '.git', 'dist', 'coverage', '.idea', '.vscode']);
function collect(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignored.has(entry.name)) return [];
    const filename = path.join(directory, entry.name);
    return entry.isDirectory()
      ? collect(filename)
      : /\.(?:js|mjs|cjs)$/.test(entry.name)
        ? [filename]
        : [];
  });
}

// JavaScript's \b treats only [A-Za-z0-9_] as word characters, so it never matches next to
// Cyrillic letters. Browser bundles in public/ are skipped together with node_modules.
function findCyrillicWordBoundaries(source) {
  let tokens;
  try {
    ({ tokens } = espree.parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      tokens: true,
      loc: true,
    }));
  } catch {
    return [];
  }
  return tokens
    .filter(
      (token) =>
        token.type === 'RegularExpression' &&
        /[А-Яа-яЁё]/.test(token.regex.pattern) &&
        /(?<!\\)(?:\\\\)*\\[bB]/.test(token.regex.pattern.replace(/\[(?:\\.|[^\]])*\]/g, ''))
    )
    .map((token) => token.loc.start.line);
}

const files = collect(root);
const graph = new Map();
let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failed = true;
    console.error(result.stderr || result.error?.message);
  }
  const source = readFileSync(file, 'utf8');
  const dependencies = [];
  for (const match of source.matchAll(
    /\b(?:import|export)\s+(?:[^;'"`]+?\s+from\s+)?['"](\.[^'"]+)['"]/g
  )) {
    const target = path.resolve(path.dirname(file), match[1]);
    if (!existsSync(target)) {
      failed = true;
      console.error(`Missing import: ${path.relative(root, file)} -> ${match[1]}`);
    }
    dependencies.push(target);
  }
  // Dynamic imports are resolved at runtime, so a stale relative path is otherwise invisible.
  for (const match of source.matchAll(/\bimport\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
    if (!existsSync(path.resolve(path.dirname(file), match[1]))) {
      failed = true;
      console.error(`Missing dynamic import: ${path.relative(root, file)} -> ${match[1]}`);
    }
  }
  for (const line of findCyrillicWordBoundaries(source)) {
    failed = true;
    console.error(
      `ASCII-only \\b next to Cyrillic: ${path.relative(root, file)}:${line} ` +
        '(run node scripts/fix-cyrillic-word-boundaries.cjs --write <path>)'
    );
  }
  graph.set(file, dependencies);
}
const visited = new Set();
const visiting = new Set();
function visit(file, route = []) {
  if (visiting.has(file)) {
    failed = true;
    console.error(
      `Circular import: ${[...route, file].map((name) => path.relative(root, name)).join(' -> ')}`
    );
    return;
  }
  if (visited.has(file)) return;
  visiting.add(file);
  for (const dependency of graph.get(file) || []) visit(dependency, [...route, file]);
  visiting.delete(file);
  visited.add(file);
}
for (const file of files) visit(file);
console.log(`Checked syntax and local imports: ${files.length} files`);
if (failed) process.exitCode = 1;
