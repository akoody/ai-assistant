import globals from 'globals';

const sharedRules = {
  'no-undef': 'error',
  'no-unused-vars': [
    'error',
    {
      args: 'after-used',
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrors: 'none',
      ignoreRestSiblings: true,
    },
  ],
};

export default [
  {
    ignores: ['**/node_modules/**', 'dist/**', '**/coverage/**', '.idea/**', '.vscode/**'],
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser, ...globals.jest },
    },
    rules: sharedRules,
  },
  {
    files: ['scripts/*.js', '**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
    rules: sharedRules,
  },
];
