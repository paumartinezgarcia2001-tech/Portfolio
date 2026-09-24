// @ts-check
import js from '@eslint/js';
import astro from 'eslint-plugin-astro';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      'dist/',
      '.astro/',
      '.wrangler/',
      'node_modules/',
      'worker-configuration.d.ts',
      'test-results/',
      'playwright-report/',
      'playwright-report-admin/',
      'blob-report/',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  astro.configs['flat/recommended'],
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
