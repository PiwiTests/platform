/**
 * Which runs may feed which analysis: the one eligibility rule.
 *
 * A run's origin says what launched it (`metadata.piwiOrigin`, stamped by the
 * reporter from `PIWI_ORIGIN`, or by the server for imports and CI re-runs). A
 * run replaying a test under injected conditions (Flake Lab, a probe), a bisect
 * step or a reproduction at an older commit says nothing about how the suite
 * behaves today, so each use below names the origins it leaves out, whether it
 * reads complete runs only, and whether an environment incident counts.
 * `isEligibleRun` decides for a run in hand, `eligibleRunSql` and
 * `eligibleExecutionSql` decide the same in a query.
 *
 * Runs stored before the origin existed read as `probe` or `flake-lab` from
 * their lab stamp, `import` from their import record, `ci` when the reporter
 * recorded a CI provider, and `local` otherwise.
 *
 * Local runs (a developer's machine, the desktop app, an editor) count like CI
 * runs, except as the editor's CI failures while a CI run exists on the branch.
 */

import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { FLAKE_LAB_RUN_METADATA_KEY } from '@piwitests/core/flake-plan';
import {
  parseRunOrigin,
  RUN_ORIGIN_KINDS,
  RUN_ORIGIN_METADATA_KEY,
  type RunOrigin,
  type RunOriginKind,
} from '@piwitests/core/wire';
import { testRuns } from '../server/database/schema';
import { INCIDENT_RUN_METADATA_KEY } from './run-incident';

export { RUN_ORIGIN_KINDS, RUN_ORIGIN_METADATA_KEY, FLAKE_LAB_RUN_METADATA_KEY, type RunOrigin, type RunOriginKind };

/** The run-metadata flag that stamps a run as a probe run (never a real run). */
export const PROBE_RUN_METADATA_KEY = 'piwiProbe';

export { INCIDENT_RUN_METADATA_KEY };

/** A run's origin kind; `other` for a stamp naming a kind this version does not know. */
export type RunOriginRead = RunOriginKind | 'other';

/** The origins of lab runs, which replay tests under conditions Piwi injected. */
export const LAB_RUN_ORIGINS = ['flake-lab', 'probe'] as const satisfies readonly RunOriginKind[];

/** The origins of runs at a commit chosen to investigate a failure, not the branch's current state. */
export const INVESTIGATION_RUN_ORIGINS = ['bisect', 'reproduce'] as const satisfies readonly RunOriginKind[];

/** The origins of CI runs, which the editor shows as the branch's CI failures. */
export const CI_RUN_ORIGINS = ['ci', 'ci-rerun'] as const satisfies readonly RunOriginKind[];

const LAB_AND_INVESTIGATION: readonly RunOriginKind[] = [...LAB_RUN_ORIGINS, ...INVESTIGATION_RUN_ORIGINS];

/** What a use reads runs for. */
export type RunUse =
  | 'baseline'
  | 'run-baseline'
  | 'fix-verification'
  | 'flakiness'
  | 'selection-catalog'
  | 'branch-failures'
  | 'change-coverage'
  | 'shared-state'
  | 'auto-heal'
  | 'bug-lifecycle'
  | 'notifications'
  | 'run-health';

export interface RunUseRule {
  /** The origins whose runs this use never reads. */
  excludes: readonly RunOriginKind[];
  /** Leave out a run flagged as an environment incident. */
  excludesIncidents: boolean;
  /** Read only complete runs: the whole suite, finished. */
  completeOnly: boolean;
  /** Leave out a historical import: a report imported after newer runs were stored. */
  excludesHistoricalImports: boolean;
}

/**
 * The rule per use. Further conditions stay with the use that owns them: fix
 * verification also needs a new commit on the cluster's branch or the default
 * branch, the editor's CI failures prefer a CI run on the branch
 * (`CI_RUN_ORIGINS`), and the bug-report lifecycle reads the default branch.
 */
export const RUN_USES: Record<RunUse, RunUseRule> = {
  /** Execution baselines: the environment, visual and page diffs, the AI's baseline comparison, the last pass. */
  baseline: {
    excludes: LAB_AND_INVESTIGATION,
    excludesIncidents: true,
    completeOnly: false,
    excludesHistoricalImports: false,
  },
  /** Run baselines: a run compared with a whole earlier run. */
  'run-baseline': {
    excludes: LAB_AND_INVESTIGATION,
    excludesIncidents: true,
    completeOnly: true,
    excludesHistoricalImports: false,
  },
  'fix-verification': {
    excludes: LAB_AND_INVESTIGATION,
    excludesIncidents: true,
    completeOnly: false,
    excludesHistoricalImports: false,
  },
  flakiness: {
    excludes: LAB_AND_INVESTIGATION,
    excludesIncidents: true,
    completeOnly: false,
    excludesHistoricalImports: false,
  },
  /** Pass rates, last statuses, recent failures and durations behind selections and their suggestions. */
  'selection-catalog': {
    excludes: LAB_AND_INVESTIGATION,
    excludesIncidents: true,
    completeOnly: false,
    excludesHistoricalImports: false,
  },
  /** What the editor shows as the branch's CI failures. */
  'branch-failures': {
    excludes: LAB_AND_INVESTIGATION,
    excludesIncidents: true,
    completeOnly: true,
    excludesHistoricalImports: false,
  },
  /** Change coverage and every "not reached in the last N runs" analysis. */
  'change-coverage': {
    excludes: LAB_AND_INVESTIGATION,
    excludesIncidents: false,
    completeOnly: true,
    excludesHistoricalImports: false,
  },
  /** Locator snapshots, the locator index, test metadata and green samples. */
  'shared-state': {
    excludes: LAB_AND_INVESTIGATION,
    excludesIncidents: false,
    completeOnly: false,
    excludesHistoricalImports: true,
  },
  'auto-heal': {
    excludes: LAB_AND_INVESTIGATION,
    excludesIncidents: true,
    completeOnly: false,
    excludesHistoricalImports: false,
  },
  'bug-lifecycle': {
    excludes: ['bug', ...LAB_AND_INVESTIGATION],
    excludesIncidents: false,
    completeOnly: false,
    excludesHistoricalImports: false,
  },
  /**
   * Notifications, pull-request feedback, the gate and the other finalize side
   * effects. An environment incident sends one `environment.incident` event
   * instead, and the gate reads it as inconclusive.
   */
  notifications: {
    excludes: LAB_RUN_ORIGINS,
    excludesIncidents: true,
    completeOnly: false,
    excludesHistoricalImports: false,
  },
  /** The runs the incident classifier judges, and the runs of other projects it compares them with. */
  'run-health': {
    excludes: LAB_RUN_ORIGINS,
    excludesIncidents: false,
    completeOnly: false,
    excludesHistoricalImports: false,
  },
};

/** Statuses of a run that has not finished yet. */
export const UNFINISHED_RUN_STATUSES = ['initializing', 'running', 'finalizing'] as const;

function record(metadata: unknown): Record<string, unknown> | null {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : null;
}

function isObject(value: unknown): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** True when a run's metadata stamps it as a probe run. */
export function isProbeRun(metadata: unknown): boolean {
  return record(metadata)?.[PROBE_RUN_METADATA_KEY] === true;
}

/** True when a run's metadata stamps it as a flake-lab run. */
export function isFlakeLabRun(metadata: unknown): boolean {
  const stamp = record(metadata)?.[FLAKE_LAB_RUN_METADATA_KEY];
  return !!stamp && typeof stamp === 'object';
}

/** True when a run is flagged as an environment incident. */
export function isIncidentRun(metadata: unknown): boolean {
  return isObject(record(metadata)?.[INCIDENT_RUN_METADATA_KEY]);
}

/** What launched a run, read from its metadata. */
export function runOrigin(metadata: unknown): RunOriginRead {
  const meta = record(metadata);
  if (isProbeRun(meta)) return 'probe';
  if (isFlakeLabRun(meta)) return 'flake-lab';
  if (meta && RUN_ORIGIN_METADATA_KEY in meta && isObject(meta[RUN_ORIGIN_METADATA_KEY])) {
    return parseRunOrigin(meta[RUN_ORIGIN_METADATA_KEY])?.kind ?? 'other';
  }
  if (isObject(meta?.import)) return 'import';
  if (isObject(meta?.ci)) return 'ci';
  return 'local';
}

/** What a run was launched for (a dispatch, a cluster, a bug report), when its origin names it. */
export function runOriginRef(metadata: unknown): string | null {
  return parseRunOrigin(record(metadata)?.[RUN_ORIGIN_METADATA_KEY])?.ref ?? null;
}

/**
 * True for a lab run, one that replays tests under conditions Piwi injected: a
 * probe run or a flake-lab run. A lab run never counts as a real run, so no use
 * reads it.
 */
export function isLabRun(metadata: unknown): boolean {
  return (LAB_RUN_ORIGINS as readonly string[]).includes(runOrigin(metadata));
}

/** The fields of a run the rule reads. */
export interface EligibleRunInput {
  metadata?: unknown;
  /** 1 (or true) when the run covered the whole suite. */
  isFullRun?: number | boolean | null;
  status?: string | null;
  /**
   * True for a historical import: a report imported after newer runs of the
   * project were stored. Known only to the caller, which has looked it up;
   * the SQL form cannot tell, so a use excluding it filters it where it is known.
   */
  historicalImport?: boolean;
}

/** True for a run that covered the whole suite and finished. */
export function isCompleteRun(run: EligibleRunInput): boolean {
  const full = run.isFullRun === undefined || run.isFullRun === null ? true : Boolean(run.isFullRun);
  return full && !(UNFINISHED_RUN_STATUSES as readonly string[]).includes(run.status ?? '');
}

/** True when `run` may feed `use`. */
export function isEligibleRun(run: EligibleRunInput, use: RunUse): boolean {
  const rule = RUN_USES[use];
  if ((rule.excludes as readonly string[]).includes(runOrigin(run.metadata))) return false;
  if (rule.excludesIncidents && isIncidentRun(run.metadata)) return false;
  if (rule.completeOnly && !isCompleteRun(run)) return false;
  if (rule.excludesHistoricalImports && run.historicalImport) return false;
  return true;
}

// ── The same rule in SQL ─────────────────────────────────────────────────────
//
// Metadata is JSON text on SQLite and `jsonb` on PostgreSQL, and the demo's
// database is SQLite in the browser, so keys are matched in the serialized
// text, in both spellings: SQLite keeps the text as written (`"k":v`), and
// `jsonb` puts a space after each colon and comma and sorts an object's keys
// shortest first (`{"ref": "…", "kind": "…"}`). The server writes the origin
// as `{ kind, ref? }`, kind first, and its ref holds no quote.

function text(metadata: SQLWrapper): SQL {
  return sql`COALESCE(CAST(${metadata} AS TEXT), '')`;
}

function likeAny(value: SQL, patterns: string[]): SQL {
  return sql.join(
    patterns.map((p) => sql`${value} LIKE ${p}`),
    sql` OR `,
  );
}

/** The text holds an object (or a value) under `key`, in either spelling. */
function hasKey(value: SQL, key: string, opening: string): SQL {
  return sql`(${likeAny(value, [`%"${key}":${opening}%`, `%"${key}": ${opening}%`])})`;
}

function originKindIs(value: SQL, kind: RunOriginKind): SQL {
  const key = RUN_ORIGIN_METADATA_KEY;
  return sql`(${likeAny(value, [
    `%"${key}":{"kind":"${kind}"}%`,
    `%"${key}":{"kind":"${kind}","ref":%`,
    `%"${key}": {"kind": "${kind}"}%`,
    `%"${key}": {"ref": "%", "kind": "${kind}"}%`,
  ])})`;
}

/**
 * SQL predicate: the run's origin is exactly `kind` with `ref`, in either
 * spelling. A ref holds no quote and no LIKE wildcard (`parseRunOriginRef`).
 */
export function runOriginIs(metadata: SQLWrapper, kind: RunOriginKind, ref: string): SQL {
  const key = RUN_ORIGIN_METADATA_KEY;
  return sql`(${likeAny(text(metadata), [
    `%"${key}":{"kind":"${kind}","ref":"${ref}"}%`,
    `%"${key}": {"ref": "${ref}", "kind": "${kind}"}%`,
  ])})`;
}

/**
 * SQL predicate: the run's origin (`runOrigin`) is one of `kinds`. `metadata`
 * is the run's metadata column.
 */
export function runOriginIn(metadata: SQLWrapper, kinds: readonly RunOriginKind[]): SQL {
  if (kinds.length === 0) return sql`1 = 0`;
  const value = text(metadata);
  const probe = hasKey(value, PROBE_RUN_METADATA_KEY, 'true');
  const flake = hasKey(value, FLAKE_LAB_RUN_METADATA_KEY, '{');
  const stamped = sql`(${probe} OR ${flake})`;
  const hasOrigin = hasKey(value, RUN_ORIGIN_METADATA_KEY, '{');
  const importKey = hasKey(value, 'import', '{');
  const ciKey = hasKey(value, 'ci', '{');

  const each = kinds.map((kind) => {
    const legacy =
      kind === 'import'
        ? importKey
        : kind === 'ci'
          ? sql`(NOT ${importKey} AND ${ciKey})`
          : kind === 'local'
            ? sql`(NOT ${importKey} AND NOT ${ciKey})`
            : null;
    const unstamped = legacy
      ? sql`(NOT ${stamped} AND (${originKindIs(value, kind)} OR (NOT ${hasOrigin} AND ${legacy})))`
      : sql`(NOT ${stamped} AND ${originKindIs(value, kind)})`;
    if (kind === 'probe') return sql`(${probe} OR ${unstamped})`;
    if (kind === 'flake-lab') return sql`((NOT ${probe} AND ${flake}) OR ${unstamped})`;
    return unstamped;
  });
  return sql`(${sql.join(each, sql` OR `)})`;
}

/** SQL predicate: the run is flagged as an environment incident (`isIncidentRun`). */
export function incidentRunSql(metadata: SQLWrapper): SQL {
  return hasKey(text(metadata), INCIDENT_RUN_METADATA_KEY, '{');
}

/** The run columns `eligibleRunSql` reads; `test_runs`' own by default. */
export interface EligibleRunColumns {
  metadata: SQLWrapper;
  isFullRun: SQLWrapper;
  status: SQLWrapper;
}

const TEST_RUN_COLUMNS: EligibleRunColumns = {
  metadata: testRuns.metadata,
  isFullRun: testRuns.isFullRun,
  status: testRuns.status,
};

/** SQL predicate keeping only runs that may feed `use`: the SQL form of `isEligibleRun`. */
export function eligibleRunSql(use: RunUse, columns: EligibleRunColumns = TEST_RUN_COLUMNS): SQL {
  const rule = RUN_USES[use];
  const parts = [sql`NOT ${runOriginIn(columns.metadata, rule.excludes)}`];
  if (rule.excludesIncidents) parts.push(sql`NOT ${incidentRunSql(columns.metadata)}`);
  if (rule.completeOnly) {
    const unfinished = sql.join(
      UNFINISHED_RUN_STATUSES.map((s) => sql`${s}`),
      sql`, `,
    );
    parts.push(sql`${columns.isFullRun} = 1 AND ${columns.status} NOT IN (${unfinished})`);
  }
  return sql`(${sql.join(parts, sql` AND `)})`;
}

/**
 * SQL predicate on an execution's run id keeping only executions of runs that
 * may feed `use`, for queries over `test_runs_cases` that do not join
 * `test_runs` (a left join from test cases, a correlated subquery).
 */
export function eligibleExecutionSql(use: RunUse, testRunId: SQLWrapper): SQL {
  return sql`EXISTS (SELECT 1 FROM ${testRuns} WHERE ${testRuns.id} = ${testRunId} AND ${eligibleRunSql(use)})`;
}

/** SQL predicate keeping only runs that are not lab runs: the SQL form of `!isLabRun(metadata)`. */
export function notLabRun(metadata: SQLWrapper): SQL {
  return sql`NOT ${runOriginIn(metadata, LAB_RUN_ORIGINS)}`;
}

/** `notLabRun` on an execution's run id, for queries over `test_runs_cases` that do not join `test_runs`. */
export function notLabExecution(testRunId: SQLWrapper): SQL {
  return sql`EXISTS (SELECT 1 FROM ${testRuns} WHERE ${testRuns.id} = ${testRunId} AND ${notLabRun(testRuns.metadata)})`;
}

/**
 * `notLabExecution` for a query over one project's executions: the project's
 * runs that are not lab runs are listed once for the query, and each execution
 * is matched against that list, so the metadata of a run is read once rather
 * than once per execution.
 */
export function notLabExecutionInProject(projectId: number, testRunId: SQLWrapper): SQL {
  return sql`${testRunId} IN (SELECT ${testRuns.id} FROM ${testRuns} WHERE ${testRuns.projectId} = ${projectId} AND ${notLabRun(testRuns.metadata)})`;
}
