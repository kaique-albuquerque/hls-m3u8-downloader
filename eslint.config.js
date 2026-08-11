export default [
  {
    ignores: ['node_modules/**', 'vendor/**', 'tools/**', 'dist/**', 'out/**', 'coverage/**', 'tests/fixtures/**'],
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-fallthrough': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
    },
  },
];
