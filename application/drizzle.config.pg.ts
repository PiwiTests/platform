import type { Config } from 'drizzle-kit';

export default {
  schema: './server/database/schema.pg.ts',
  out: './server/database/migrations-pg',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://localhost:5432/piwi_dashboard',
  },
  verbose: true,
  strict: true,
} satisfies Config;
