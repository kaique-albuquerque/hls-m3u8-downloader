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
      // -- Existentes (manter) --
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-fallthrough': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],

      // -- Novas (Sprint 3.1) --
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'warn',
      'no-var': 'error',
      'prefer-template': 'warn',
      'complexity': ['warn', 25],
      'max-lines-per-function': ['warn', { max: 150, skipBlankLines: true, skipComments: true }],
      'no-shadow': 'warn',
      'no-throw-literal': 'error',
      'no-self-compare': 'error',
      'no-template-curly-in-string': 'warn',
      'symbol-description': 'warn',
    },
  },
];
