import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Checks the recorded migration history against the migrations folder before
 * migrating, and repairs a database whose history diverged from it.
 *
 * The Drizzle migrator applies every journal migration dated after the latest
 * row of `__drizzle_migrations`, and nothing else. A database that ran
 * migrations from another branch holds rows this build does not know
 * (orphaned rows): a regenerated copy of those migrations then fails on
 * objects that already exist, and a journal migration dated before the latest
 * row is never applied (a skipped migration). A migration whose file changed
 * after the database applied it (a changed migration) is not run again either.
 * In any of these cases the missing migrations are applied by identity instead
 * of by date, in one transaction, and the result is checked against the schema
 * snapshot of the last migration; any difference left rolls the whole repair
 * back.
 */

export type Dialect = 'sqlite' | 'postgres';

/** One migration of a Drizzle migrations folder, in journal order. */
export interface JournalMigration {
  tag: string;
  /** The journal `when`, which Drizzle records as `created_at` once the migration is applied. */
  createdAt: number;
  /** SHA-256 of the SQL file, as Drizzle records it. */
  hash: string;
  statements: string[];
}

/** One row of `__drizzle_migrations`. */
export interface AppliedMigration {
  hash: string;
  createdAt: number;
}

export interface MigrationHistory {
  /** Applied rows matching no journal migration: migrations from another branch, or from a newer build. */
  orphaned: AppliedMigration[];
  /** Unapplied journal migrations dated before the latest applied row, which the Drizzle migrator never runs. */
  skipped: JournalMigration[];
  /** Unapplied journal migrations dated after the latest applied row. */
  pending: JournalMigration[];
  /** Applied journal migrations whose file no longer matches the hash recorded when they ran. */
  changed: JournalMigration[];
}

const BREAKPOINT = '--> statement-breakpoint';

export function readJournal(folder: string): JournalMigration[] {
  const journal = JSON.parse(readFileSync(join(folder, 'meta/_journal.json'), 'utf8')) as {
    entries: { tag: string; when: number }[];
  };
  return journal.entries.map((entry) => {
    const sql = readFileSync(join(folder, `${entry.tag}.sql`), 'utf8');
    return {
      tag: entry.tag,
      createdAt: entry.when,
      hash: createHash('sha256').update(sql).digest('hex'),
      statements: sql.split(BREAKPOINT),
    };
  });
}

/** A migration is applied when a row carries its journal date, which is how the Drizzle migrator records it. */
export function compareMigrationHistory(applied: AppliedMigration[], journal: JournalMigration[]): MigrationHistory {
  const journalDates = new Set(journal.map((migration) => migration.createdAt));
  const appliedHashes = new Map(applied.map((row) => [row.createdAt, row.hash]));
  const latest = applied.reduce((max, row) => Math.max(max, row.createdAt), -Infinity);
  const unapplied = journal.filter((migration) => !appliedHashes.has(migration.createdAt));
  return {
    orphaned: applied.filter((row) => !journalDates.has(row.createdAt)),
    skipped: unapplied.filter((migration) => migration.createdAt <= latest),
    pending: unapplied.filter((migration) => migration.createdAt > latest),
    changed: journal.filter((migration) => {
      const hash = appliedHashes.get(migration.createdAt);
      return hash !== undefined && hash !== migration.hash;
    }),
  };
}

// ── Statements ────────────────────────────────────────────────────────────

/** The schema object a migration statement creates, when it creates one. */
export type StatementTarget =
  | { kind: 'create-table'; table: string }
  | { kind: 'create-index'; index: string; table: string }
  | { kind: 'add-column'; table: string; column: string }
  | { kind: 'add-constraint'; table: string; constraint: string }
  | { kind: 'other' };

const IDENTIFIER = String.raw`(?:\`[^\`]+\`|"[^"]+"|[\w$]+)`;
/** An identifier, optionally schema-qualified; the capture group holds the unqualified name. */
const NAME = String.raw`(?:${IDENTIFIER}\s*\.\s*)?(${IDENTIFIER})`;
const CREATE_TABLE = new RegExp(String.raw`^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${NAME}`, 'i');
const CREATE_INDEX = new RegExp(
  String.raw`^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?${NAME}\s+ON\s+(?:ONLY\s+)?${NAME}`,
  'i',
);
const ADD_CONSTRAINT = new RegExp(String.raw`^ALTER\s+TABLE\s+(?:ONLY\s+)?${NAME}\s+ADD\s+CONSTRAINT\s+${NAME}`, 'i');
const ADD_COLUMN = new RegExp(
  String.raw`^ALTER\s+TABLE\s+(?:ONLY\s+)?${NAME}\s+ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?!(?:CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK|EXCLUDE)\b)${NAME}`,
  'i',
);

/** Drop the leading `--` comment lines and blank space of a statement. */
function withoutLeadingComments(statement: string): string {
  return statement.replace(/^(?:\s*--[^\n]*(?:\n|$))*\s*/, '');
}

/** Unquoted names fold to lower case, as PostgreSQL does; SQLite compares names case-insensitively anyway. */
function unquote(identifier: string): string {
  const quoted = /^[`"](.*)[`"]$/.exec(identifier);
  return quoted ? quoted[1]! : identifier.toLowerCase();
}

export function classifyStatement(statement: string): StatementTarget {
  const sql = withoutLeadingComments(statement);
  let match = CREATE_TABLE.exec(sql);
  if (match) return { kind: 'create-table', table: unquote(match[1]!) };
  match = CREATE_INDEX.exec(sql);
  if (match) return { kind: 'create-index', index: unquote(match[1]!), table: unquote(match[2]!) };
  match = ADD_CONSTRAINT.exec(sql);
  if (match) return { kind: 'add-constraint', table: unquote(match[1]!), constraint: unquote(match[2]!) };
  match = ADD_COLUMN.exec(sql);
  if (match) return { kind: 'add-column', table: unquote(match[1]!), column: unquote(match[2]!) };
  return { kind: 'other' };
}

export function isBlankStatement(statement: string): boolean {
  return withoutLeadingComments(statement).length === 0;
}

/** Rewrite a `CREATE TABLE` statement to create a temporary table named `name` instead. */
export function asTemporaryTable(statement: string, name: string): string {
  return withoutLeadingComments(statement).replace(CREATE_TABLE, `CREATE TEMP TABLE ${quoteIdentifier(name)}`);
}

export function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

// ── Schema shape ──────────────────────────────────────────────────────────

export interface ColumnShape {
  notNull: boolean;
  hasDefault: boolean;
}

export interface IndexShape {
  table: string;
  unique: boolean;
}

/**
 * The parts of a schema the application depends on. PostgreSQL unique
 * constraints are listed with the indexes, since each one is backed by a unique
 * index of the same name.
 */
export interface SchemaShape {
  tables: Map<string, Map<string, ColumnShape>>;
  indexes: Map<string, IndexShape>;
  /** One key per foreign key, from {@link foreignKeyKey}. */
  foreignKeys: Set<string>;
}

export interface ForeignKeyShape {
  name: string;
  tableFrom: string;
  columnsFrom: string[];
  tableTo: string;
  columnsTo: string[];
}

/**
 * PostgreSQL keys foreign keys by name. SQLite does not keep their names, so
 * they are keyed by columns there, without the ON UPDATE / ON DELETE actions:
 * drizzle-kit leaves those out of the `ALTER TABLE … ADD … REFERENCES` it
 * generates for SQLite, so a migrated database does not carry the actions its
 * snapshot declares.
 */
export function foreignKeyKey(fk: ForeignKeyShape, dialect: Dialect): string {
  if (dialect === 'postgres') return `${fk.tableFrom}.${postgresName(fk.name)}`;
  return `${fk.tableFrom}(${fk.columnsFrom.join(', ')}) -> ${fk.tableTo}(${fk.columnsTo.join(', ')})`;
}

/** PostgreSQL truncates identifiers to 63 bytes. */
export function postgresName(name: string): string {
  return name.slice(0, 63);
}

interface SnapshotColumn {
  name: string;
  type: string;
  primaryKey: boolean;
  notNull: boolean;
  default?: unknown;
  identity?: unknown;
  generated?: unknown;
}

interface SnapshotTable {
  name: string;
  columns: Record<string, SnapshotColumn>;
  indexes: Record<string, { name: string; isUnique: boolean }>;
  foreignKeys: Record<string, ForeignKeyShape>;
  compositePrimaryKeys: Record<string, { columns: string[] }>;
  uniqueConstraints?: Record<string, { name: string }>;
}

/** The part of a drizzle-kit schema snapshot (`meta/NNNN_snapshot.json`) read here. */
export interface DrizzleSnapshot {
  tables: Record<string, SnapshotTable>;
}

/** The snapshot of the most recent migration, which describes the schema the whole folder builds. */
export function readLatestSnapshot(folder: string): DrizzleSnapshot {
  const meta = join(folder, 'meta');
  const latest = readdirSync(meta)
    .filter((file) => /^\d+_snapshot\.json$/.test(file))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
    .at(-1);
  if (!latest) throw new Error(`no schema snapshot in ${meta}`);
  return JSON.parse(readFileSync(join(meta, latest), 'utf8')) as DrizzleSnapshot;
}

export function snapshotShape(snapshot: DrizzleSnapshot, dialect: Dialect): SchemaShape {
  const indexName = (name: string) => (dialect === 'postgres' ? postgresName(name) : name);
  const shape: SchemaShape = { tables: new Map(), indexes: new Map(), foreignKeys: new Set() };
  for (const table of Object.values(snapshot.tables)) {
    const keyColumns = new Set(Object.values(table.compositePrimaryKeys).flatMap((key) => key.columns));
    const columns = new Map<string, ColumnShape>();
    for (const column of Object.values(table.columns)) {
      columns.set(column.name, {
        notNull: column.notNull || column.primaryKey || keyColumns.has(column.name),
        hasDefault:
          column.default !== undefined ||
          Boolean(column.identity) ||
          Boolean(column.generated) ||
          (dialect === 'postgres' && /serial$/i.test(column.type)),
      });
    }
    shape.tables.set(table.name, columns);
    for (const index of Object.values(table.indexes)) {
      shape.indexes.set(indexName(index.name), { table: table.name, unique: index.isUnique });
    }
    for (const unique of Object.values(table.uniqueConstraints ?? {})) {
      shape.indexes.set(indexName(unique.name), { table: table.name, unique: true });
    }
    for (const fk of Object.values(table.foreignKeys)) shape.foreignKeys.add(foreignKeyKey(fk, dialect));
  }
  return shape;
}

export interface SchemaDifferences {
  /** Differences the application would trip over: the repair is rolled back. */
  blocking: string[];
  /** Objects this build does not use and that cannot get in its way: kept. */
  extra: string[];
}

export function diffSchema(expected: SchemaShape, actual: SchemaShape): SchemaDifferences {
  const blocking: string[] = [];
  const extra: string[] = [];
  for (const [table, columns] of expected.tables) {
    const actualColumns = actual.tables.get(table);
    if (!actualColumns) {
      blocking.push(`table ${table} is missing`);
      continue;
    }
    for (const [name, column] of columns) {
      const found = actualColumns.get(name);
      if (!found) {
        blocking.push(`column ${table}.${name} is missing`);
        continue;
      }
      if (found.notNull !== column.notNull) {
        blocking.push(`column ${table}.${name} should be ${column.notNull ? 'NOT NULL' : 'nullable'}`);
      }
      if (found.hasDefault !== column.hasDefault) {
        blocking.push(`column ${table}.${name} should ${column.hasDefault ? 'have a default' : 'have no default'}`);
      }
    }
    for (const [name, column] of actualColumns) {
      if (columns.has(name)) continue;
      if (column.notNull && !column.hasDefault) {
        blocking.push(`column ${table}.${name} is not in this build and is NOT NULL without a default`);
      } else {
        extra.push(`column ${table}.${name}`);
      }
    }
  }
  for (const table of actual.tables.keys()) {
    if (!expected.tables.has(table)) extra.push(`table ${table}`);
  }
  for (const [name, index] of expected.indexes) {
    const found = actual.indexes.get(name);
    if (!found) blocking.push(`index ${name} is missing`);
    else if (found.table !== index.table || found.unique !== index.unique) blocking.push(`index ${name} differs`);
  }
  for (const [name, index] of actual.indexes) {
    if (expected.indexes.has(name)) continue;
    if (index.unique && expected.tables.has(index.table)) blocking.push(`unique index ${name} is not in this build`);
    else extra.push(`index ${name}`);
  }
  for (const fk of expected.foreignKeys) {
    if (!actual.foreignKeys.has(fk)) blocking.push(`foreign key ${fk} is missing`);
  }
  for (const fk of actual.foreignKeys) {
    if (!expected.foreignKeys.has(fk)) extra.push(`foreign key ${fk}`);
  }
  return { blocking, extra };
}

// ── Repair ────────────────────────────────────────────────────────────────

export interface ColumnDefinition {
  name: string;
  type: string;
  notNull: boolean;
  /** The SQL expression of the default, as the database reports it. */
  defaultValue: string | null;
  primaryKey: boolean;
  references: { table: string; column: string; onUpdate: string; onDelete: string } | null;
}

/** The database operations a repair runs, all inside one transaction. */
export interface RepairSession {
  run(sql: string): Promise<void>;
  tableExists(table: string): Promise<boolean>;
  indexExists(index: string): Promise<boolean>;
  constraintExists(table: string, constraint: string): Promise<boolean>;
  columns(table: string): Promise<ColumnDefinition[]>;
  /** The columns a `CREATE TABLE` statement declares, read from a temporary copy of the table. */
  declaredColumns(createTable: string): Promise<ColumnDefinition[]>;
  addColumn(table: string, column: ColumnDefinition): Promise<void>;
  dropIndex(index: string): Promise<void>;
  dropConstraint(table: string, constraint: string): Promise<void>;
  describe(): Promise<SchemaShape>;
  /** Record `migration` in `__drizzle_migrations`. */
  record(migration: JournalMigration): Promise<void>;
  /** Replace the recorded hash of an applied migration with the hash of its file. */
  rehash(migration: JournalMigration): Promise<void>;
  /** Delete an orphaned row from `__drizzle_migrations`. */
  forget(row: AppliedMigration): Promise<void>;
}

export interface MigrationTarget {
  dialect: Dialect;
  /** Rows of `__drizzle_migrations`; empty on a fresh database. */
  readApplied(): Promise<AppliedMigration[]>;
  /** Run the Drizzle migrator. */
  migrate(): Promise<void>;
  /** Run `work` in one transaction, rolled back if it throws. */
  repair(work: (session: RepairSession) => Promise<void>): Promise<void>;
  /** How to reset this database, for the message shown when a repair is not possible. */
  resetHint: string;
}

/** Scratch table used to read the columns a `CREATE TABLE` statement declares. */
export const SCRATCH_TABLE = '__piwi_declared_columns';

interface MigrationAdjustments {
  keptTables: string[];
  addedColumns: string[];
  keptColumns: string[];
  rebuiltIndexes: number;
  rebuiltConstraints: number;
}

/**
 * Apply one migration over objects that may already exist: an existing table
 * is kept and completed with the columns the statement declares, an existing
 * column is kept, and an existing index or constraint is rebuilt from its
 * statement. Everything else runs as written.
 */
async function replayMigration(session: RepairSession, migration: JournalMigration): Promise<MigrationAdjustments> {
  const adjustments: MigrationAdjustments = {
    keptTables: [],
    addedColumns: [],
    keptColumns: [],
    rebuiltIndexes: 0,
    rebuiltConstraints: 0,
  };
  for (const statement of migration.statements) {
    if (isBlankStatement(statement)) continue;
    const target = classifyStatement(statement);
    try {
      if (target.kind === 'create-table' && (await session.tableExists(target.table))) {
        const present = new Set((await session.columns(target.table)).map((column) => column.name));
        for (const column of await session.declaredColumns(statement)) {
          if (present.has(column.name)) continue;
          await session.addColumn(target.table, column);
          adjustments.addedColumns.push(`${target.table}.${column.name}`);
        }
        adjustments.keptTables.push(target.table);
        continue;
      }
      if (target.kind === 'add-column') {
        const columns = await session.columns(target.table);
        if (columns.some((column) => column.name === target.column)) {
          adjustments.keptColumns.push(`${target.table}.${target.column}`);
          continue;
        }
      }
      if (target.kind === 'create-index' && (await session.indexExists(target.index))) {
        await session.dropIndex(target.index);
        adjustments.rebuiltIndexes++;
      }
      if (target.kind === 'add-constraint' && (await session.constraintExists(target.table, target.constraint))) {
        await session.dropConstraint(target.table, target.constraint);
        adjustments.rebuiltConstraints++;
      }
      await session.run(statement);
    } catch (error) {
      const excerpt = withoutLeadingComments(statement).replace(/\s+/g, ' ').slice(0, 160);
      throw new Error(`${migration.tag} failed on "${excerpt}": ${errorMessage(error)}`, { cause: error });
    }
  }
  return adjustments;
}

/**
 * A migration that only creates tables, columns, indexes and constraints can
 * run again over its own objects; one that changes data cannot.
 */
export function isSchemaOnly(migration: JournalMigration): boolean {
  return migration.statements.every(
    (statement) => isBlankStatement(statement) || classifyStatement(statement).kind !== 'other',
  );
}

/** A unique index this build does not declare, on a table it does, would reject rows the application writes. */
async function dropStrayUniqueIndexes(session: RepairSession, expected: SchemaShape): Promise<string[]> {
  const dropped: string[] = [];
  for (const [name, index] of (await session.describe()).indexes) {
    if (!index.unique || expected.indexes.has(name) || !expected.tables.has(index.table)) continue;
    await session.dropIndex(name);
    dropped.push(name);
  }
  return dropped;
}

function describeAdjustments(tag: string, adjustments: MigrationAdjustments): string | null {
  const parts: string[] = [];
  if (adjustments.keptTables.length) parts.push(`kept existing tables ${adjustments.keptTables.join(', ')}`);
  if (adjustments.addedColumns.length) parts.push(`added columns ${adjustments.addedColumns.join(', ')}`);
  if (adjustments.keptColumns.length) parts.push(`kept existing columns ${adjustments.keptColumns.join(', ')}`);
  if (adjustments.rebuiltIndexes) parts.push(`rebuilt ${adjustments.rebuiltIndexes} existing index(es)`);
  if (adjustments.rebuiltConstraints) parts.push(`rebuilt ${adjustments.rebuiltConstraints} existing constraint(s)`);
  return parts.length ? `${tag}: ${parts.join('; ')}` : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function listDates(rows: AppliedMigration[]): string {
  return listItems(rows.map((row) => `${new Date(row.createdAt).toISOString().slice(0, 16).replace('T', ' ')} UTC`));
}

function listTags(migrations: JournalMigration[]): string {
  return listItems(migrations.map((migration) => migration.tag));
}

function listItems(items: string[], max = 10): string {
  return items.length > max ? `${items.slice(0, max).join(', ')} and ${items.length - max} more` : items.join(', ');
}

type Logger = Pick<Console, 'log' | 'warn'>;

/**
 * Bring the database up to the migrations folder. A history that matches the
 * journal goes through the Drizzle migrator unchanged; a diverged one is
 * repaired, or the startup stops with an error naming the difference.
 */
export async function applyMigrations(target: MigrationTarget, folder: string, log: Logger = console): Promise<void> {
  const journal = readJournal(folder);
  const history = compareMigrationHistory(await target.readApplied(), journal);
  const { orphaned, skipped, pending, changed } = history;
  if (!orphaned.length && !skipped.length && !changed.length) {
    await target.migrate();
    return;
  }
  if (!skipped.length && !pending.length && !changed.length) {
    log.warn(
      `[Database] ${orphaned.length} applied migration(s) are not in this build (another branch, or a newer ` +
        `version), nothing to apply: ${listDates(orphaned)}`,
    );
    return;
  }

  log.warn('[Database] The migration history of this database does not match this build.');
  if (orphaned.length) {
    log.warn(`[Database]   Applied, not in this build (another branch, or a newer version): ${listDates(orphaned)}`);
  }
  if (skipped.length) {
    log.warn(`[Database]   Dated before the latest applied migration, never run by the migrator: ${listTags(skipped)}`);
  }
  if (changed.length) log.warn(`[Database]   Changed after this database applied them: ${listTags(changed)}`);
  if (pending.length) log.warn(`[Database]   Not applied yet: ${listTags(pending)}`);
  log.warn('[Database] Applying the missing migrations and checking the result against the schema of this build.');

  const missing = new Set([...skipped, ...pending]);
  const replayed = new Set(changed.filter(isSchemaOnly));
  const notes: string[] = [];
  let extra: string[] = [];
  try {
    const expected = snapshotShape(readLatestSnapshot(folder), target.dialect);
    await target.repair(async (session) => {
      for (const migration of journal) {
        if (!missing.has(migration) && !replayed.has(migration)) continue;
        const note = describeAdjustments(migration.tag, await replayMigration(session, migration));
        if (note) notes.push(note);
        if (missing.has(migration)) await session.record(migration);
      }
      const dropped = await dropStrayUniqueIndexes(session, expected);
      if (dropped.length) notes.push(`dropped unique indexes this build does not declare: ${dropped.join(', ')}`);
      const differences = diffSchema(expected, await session.describe());
      if (differences.blocking.length) {
        throw new Error(`the resulting schema differs from this build: ${differences.blocking.join('; ')}`);
      }
      extra = differences.extra;
      for (const migration of changed) await session.rehash(migration);
      for (const row of orphaned) await session.forget(row);
    });
  } catch (error) {
    throw new Error(
      `Migration history repair failed, the database is unchanged. ${errorMessage(error)}. ` +
        `Restore a backup taken before this database ran the migrations listed above, or reset it: ${target.resetHint}.`,
      { cause: error },
    );
  }
  for (const note of notes) log.warn(`[Database]   ${note}`);
  const unreplayed = changed.filter((migration) => !replayed.has(migration));
  if (unreplayed.length) {
    log.warn(`[Database]   Changed migrations that modify data, checked but not run again: ${listTags(unreplayed)}`);
  }
  if (extra.length) log.warn(`[Database]   Kept, unused by this build: ${listItems(extra)}`);
  const summary = [
    missing.size && `${missing.size} migration(s) applied`,
    replayed.size && `${replayed.size} changed migration(s) run again`,
    orphaned.length && `${orphaned.length} orphaned record(s) removed`,
  ].filter(Boolean);
  log.warn(`[Database] Migration history repaired: ${summary.join(', ') || 'schema checked'}.`);
}
