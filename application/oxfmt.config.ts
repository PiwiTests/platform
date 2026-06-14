import { defineConfig } from 'oxfmt'
import base from '../oxfmt.baseConfig'

export default defineConfig({
  ...base,
  ignorePatterns: ['.nuxt/', '.output/', 'dist/', 'node_modules'],
})
