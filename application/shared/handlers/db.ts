import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type * as schema from '../../server/database/schema.sqlite';

export type DrizzleDB = BaseSQLiteDatabase<'async', any, typeof schema>;
