import js from '@eslint/js';
import globals from 'globals';

const shared = ['Starfall', 'StarfallArt', 'StarfallSaveFormat', 'StarfallSaveRepo', 'StarfallSaves', 'StarfallShared'];

export default [
  { ignores: ['node_modules', 'release', 'dist', 'assets/generated', '.pidex'] },
  js.configs.recommended,
  {
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      // Operation names deliberately reject control characters; the regex is the point.
      'no-control-regex': 'off',
    },
  },
  {
    // Renderer scripts run as classic browser scripts with a UMD guard for Node tests.
    files: ['src/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.browser,
        module: 'readonly',
        require: 'readonly',
        ...Object.fromEntries(shared.map((name) => [name, 'readonly'])),
        StarfallOperations: 'writable',
        starfallApp: 'writable',
        starfallDesktop: 'readonly',
      },
    },
  },
  {
    files: ['electron/**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.mjs', 'eslint.config.mjs'],
    languageOptions: { sourceType: 'module', globals: { ...globals.node, ...globals.builtin } },
  },
];
