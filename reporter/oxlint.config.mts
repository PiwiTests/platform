import { defineConfig } from 'oxlint'
import base from '../shared/oxlint.baseConfig.mts'

export default defineConfig({
  ...base,
  plugins: ['typescript', 'unicorn', 'import'],
  ignorePatterns: [...base.ignorePatterns, 'dist/**'],
  rules: {
    ...base.rules,
    // Reporter conventions (keep the package uniform — see ARCHITECTURE.md):
    // Node built-ins are imported with the `node:` protocol and namespace style.
    'unicorn/prefer-node-protocol': 'error',
    '@typescript-eslint/consistent-type-imports': 'error',
  },
})
