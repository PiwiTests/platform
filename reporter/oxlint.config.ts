import { defineConfig } from 'oxlint'
import base from '../oxlint.baseConfig'

export default defineConfig({
  ...base,
  plugins: ['typescript'],
  ignorePatterns: [...base.ignorePatterns, 'dist/**'],
})
