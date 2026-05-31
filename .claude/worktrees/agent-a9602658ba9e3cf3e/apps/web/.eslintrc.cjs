/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'react-hooks', 'react-refresh'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  rules: {
    // ── React Refresh ────────────────────────────────────────────────────────
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

    // ── TypeScript ──────────────────────────────────────────────────────────
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'warn',

    // ── Aurora Navy: ban raw Tailwind palette color classes ─────────────────
    // Catches raw colors in plain JSX className string literals.
    // For dynamic expressions (cn(), template literals) use scripts/check-raw-colors.mjs
    'no-restricted-syntax': [
      'error',
      // ── bg-{color}-{shade} ────────────────────────────────────────────────
      {
        selector:
          'JSXAttribute[name.name="className"] > Literal[value=/\\b(?:bg|text|border|ring|fill|stroke|from|via|to|shadow|divide|placeholder)-(red|blue|green|emerald|slate|purple|violet|indigo|cyan|pink|rose|amber|orange|yellow|teal|lime|sky|fuchsia|gray|zinc|stone|neutral)-\\d+/]',
        message:
          'Raw Tailwind palette colors are forbidden. Use design tokens: bg-primary, text-success, border-warning, etc. See src/theme/usage.md',
      },
      // Catch hover: / focus: variants with raw colors
      {
        selector:
          'JSXAttribute[name.name="className"] > Literal[value=/\\b(?:hover|focus|focus-visible|active|disabled):\\s*(?:bg|text|border)-(red|blue|green|emerald|slate|purple|violet|indigo|cyan|pink|rose|amber|orange|yellow|teal|lime|sky|fuchsia|gray|zinc|stone|neutral)-\\d+/]',
        message:
          'Raw Tailwind palette colors (including state variants) are forbidden. See src/theme/usage.md',
      },
    ],
  },
  ignorePatterns: ['dist', 'node_modules', 'vite.config.ts'],
}
