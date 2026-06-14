import { defineConfig } from 'oxlint'
import base from '../oxlint.baseConfig'

export default defineConfig({
  ...base,
  plugins: ['typescript', 'vue'],
  ignorePatterns: [...base.ignorePatterns, '.nuxt/**', '.output/**'],
})
