import { defineConfig } from 'oxfmt'
import base from '../shared/oxfmt.baseConfig.mts'

export default defineConfig({
  ...base,
  ignorePatterns: ['dist/', 'node_modules'],
})
