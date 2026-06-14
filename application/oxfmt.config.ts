import { defineConfig } from 'oxfmt';
import base from '../shared/oxfmt.baseConfig.mts';

export default defineConfig({
  ...base,
  ignorePatterns: ['.nuxt/', '.output/', 'dist/', 'node_modules'],
});
