import { defineConfig } from 'oxlint'
import base from '../shared/oxlint.baseConfig.mts'

export default defineConfig({
  ...base,
  plugins: ['typescript'],
  ignorePatterns: [...base.ignorePatterns, 'dist/**'],
})
