// One-off codemod: JavaScript's \b and \B only treat [A-Za-z0-9_] as word characters,
// so a boundary next to Cyrillic text never matches. This rewrites \b / \B inside regex
// literals that contain Cyrillic into lookarounds over an explicit letter class.
//
// usage: node scripts/fix-cyrillic-word-boundaries.cjs [--write] <dir|file>...
const fs = require('node:fs');
const path = require('node:path');
const espree = require('espree');
const { RegExpParser, visitRegExpAST } = require('@eslint-community/regexpp');

const WORD = 'A-Za-zА-Яа-яЁё0-9_';
const NOT_BEFORE = `(?<![${WORD}])`;
const NOT_AFTER = `(?![${WORD}])`;
const IS_BEFORE = `(?<=[${WORD}])`;
const IS_AFTER = `(?=[${WORD}])`;
const EXACT_B = `(?:${IS_BEFORE}${NOT_AFTER}|${NOT_BEFORE}${IS_AFTER})`;
const EXACT_NB = `(?:${IS_BEFORE}${IS_AFTER}|${NOT_BEFORE}${NOT_AFTER})`;
const CYRILLIC = /[А-Яа-яЁё]/;

function isWordCodePoint(value) {
  return /[A-Za-zА-Яа-яЁё0-9_]/.test(String.fromCodePoint(value));
}

// Whether every string the element can match is non-empty and begins (edge='start')
// or ends (edge='end') with a word character.
function edgeIsWord(element, edge) {
  switch (element.type) {
    case 'Character':
      return isWordCodePoint(element.value);
    case 'CharacterClass':
      return (
        !element.negate &&
        element.elements.length > 0 &&
        element.elements.every((item) =>
          item.type === 'Character'
            ? isWordCodePoint(item.value)
            : item.type === 'CharacterClassRange'
              ? rangeIsWord(item.min.value, item.max.value)
              : item.type === 'CharacterSet' && item.kind === 'word' && !item.negate
        )
      );
    case 'CharacterSet':
      return element.kind === 'word' && !element.negate;
    case 'Group':
    case 'CapturingGroup':
      return element.alternatives.every((alternative) => alternativeEdgeIsWord(alternative, edge));
    case 'Quantifier':
      return element.min >= 1 && edgeIsWord(element.element, edge);
    default:
      return false;
  }
}

function rangeIsWord(min, max) {
  const ranges = [
    [0x30, 0x39],
    [0x41, 0x5a],
    [0x61, 0x7a],
    [0x5f, 0x5f],
    [0x410, 0x44f],
    [0x401, 0x401],
    [0x451, 0x451],
  ];
  return ranges.some(([low, high]) => min >= low && max <= high);
}

function alternativeEdgeIsWord(alternative, edge) {
  const elements = alternative.elements.filter((item) => item.type !== 'Assertion');
  if (!elements.length) return false;
  return edgeIsWord(edge === 'start' ? elements[0] : elements[elements.length - 1], edge);
}

function neighbour(assertion, direction) {
  const siblings = assertion.parent.elements;
  let index = siblings.indexOf(assertion) + direction;
  while (siblings[index]?.type === 'Assertion') index += direction;
  return siblings[index] || null;
}

function replacementFor(assertion) {
  const next = neighbour(assertion, 1);
  const previous = neighbour(assertion, -1);
  const nextIsWord = next && edgeIsWord(next, 'start');
  const previousIsWord = previous && edgeIsWord(previous, 'end');
  if (!assertion.negate) {
    if (nextIsWord) return NOT_BEFORE;
    if (previousIsWord) return NOT_AFTER;
    return EXACT_B;
  }
  if (nextIsWord) return IS_BEFORE;
  if (previousIsWord) return IS_AFTER;
  return EXACT_NB;
}

function rewritePattern(pattern, flags) {
  const parser = new RegExpParser({ ecmaVersion: 2025 });
  const ast = parser.parsePattern(pattern, 0, pattern.length, {
    unicode: flags.includes('u'),
    unicodeSets: flags.includes('v'),
  });
  const edits = [];
  visitRegExpAST(ast, {
    onAssertionEnter(node) {
      if (node.kind === 'word') edits.push([node.start, node.end, replacementFor(node)]);
    },
  });
  let result = pattern;
  for (const [start, end, text] of edits.sort((a, b) => b[0] - a[0])) {
    result = result.slice(0, start) + text + result.slice(end);
  }
  return { result, count: edits.length };
}

function rewriteFile(file) {
  const source = fs.readFileSync(file, 'utf8');
  const { tokens } = espree.parse(source, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    tokens: true,
    range: true,
  });
  const edits = [];
  let total = 0;
  for (const token of tokens) {
    if (token.type !== 'RegularExpression') continue;
    const { pattern, flags } = token.regex;
    if (!CYRILLIC.test(pattern) || !/\\[bB]/.test(pattern)) continue;
    const { result, count } = rewritePattern(pattern, flags);
    if (!count) continue;
    total += count;
    edits.push([token.range[0], token.range[1], `/${result}/${flags}`]);
  }
  let output = source;
  for (const [start, end, text] of edits.sort((a, b) => b[0] - a[0])) {
    output = output.slice(0, start) + text + output.slice(end);
  }
  return { output, total, regexes: edits.length, changed: output !== source };
}

function collect(target) {
  if (fs.statSync(target).isFile()) return /\.(?:js|mjs)$/.test(target) ? [target] : [];
  return fs
    .readdirSync(target, { withFileTypes: true })
    .flatMap((entry) =>
      ['node_modules', '.git', 'dist', 'public'].includes(entry.name)
        ? []
        : collect(path.join(target, entry.name))
    );
}

const args = process.argv.slice(2);
const write = args.includes('--write');
let files = 0;
let regexes = 0;
let boundaries = 0;
for (const file of args.filter((arg) => arg !== '--write').flatMap(collect)) {
  if (/\.test\.js$|__tests__/.test(file)) continue;
  const { output, total, regexes: count, changed } = rewriteFile(file);
  if (!changed) continue;
  files += 1;
  regexes += count;
  boundaries += total;
  console.log(`${path.relative(process.cwd(), file)}: ${count} regexes, ${total} boundaries`);
  if (write) fs.writeFileSync(file, output);
}
console.log(
  `${write ? 'Rewrote' : 'Would rewrite'} ${boundaries} boundaries in ${regexes} regexes across ${files} files`
);
