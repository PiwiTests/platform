import type { Config } from 'drizzle-kit';

export default {
  schema: './server/database/schema.ts',
  out: './server/database/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DATABASE_PATH || '.data/piwi.db',
  },
  verbose: true,
  strict: true,
} satisfies Config;
