/**
 * Turns the suite's raw samples into verdicts. A timing regresses when the
 * head's median is slower by more than both a relative and an absolute floor
 * and the Mann–Whitney test says the two sets differ (p < 0.01); a count (SQL
 * statements, bytes, requests) is deterministic, so it regresses as soon as it
 * grows past its floors. Improvements mirror regressions.
 */
import { median, mannWhitneyP, mode } from './stats.mjs';

export const SIGNIFICANCE = 0.01;

/** Every metric the report compares, with its regression floors. */
export const METRICS = {
  ssrMs: { label: 'Server render', unit: 'ms', kind: 'timing', rel: 0.1, abs: 15 },
  ssrStatements: { label: 'SQL per render', unit: 'count', kind: 'count', rel: 0.1, abs: 3 },
  ssrBlocks: { label: 'DB pages read per render', unit: 'blocks', kind: 'count', rel: 0.25, abs: 1000 },
  htmlBytes: { label: 'HTML size', unit: 'bytes', kind: 'count', rel: 0.1, abs: 20_000 },
  lcpMs: { label: 'Largest paint', unit: 'ms', kind: 'timing', rel: 0.1, abs: 50 },
  loadMs: { label: 'Full load', unit: 'ms', kind: 'timing', rel: 0.1, abs: 75 },
  loadStatements: { label: 'SQL per full load', unit: 'count', kind: 'count', rel: 0.1, abs: 5 },
  apiRequests: { label: 'API calls', unit: 'count', kind: 'count', rel: 0.25, abs: 3 },
  blockingMs: { label: 'Main-thread blocking', unit: 'ms', kind: 'timing', rel: 0.25, abs: 50 },
  domNodes: { label: 'DOM nodes', unit: 'count', kind: 'count', rel: 0.15, abs: 1000 },
  apiMs: { label: 'Response time', unit: 'ms', kind: 'timing', rel: 0.15, abs: 5 },
  apiStatements: { label: 'SQL', unit: 'count', kind: 'count', rel: 0.1, abs: 2 },
  apiBytes: { label: 'Response size', unit: 'bytes', kind: 'count', rel: 0.1, abs: 20_000 },
};

const finite = (values) => (values ?? []).filter(Number.isFinite);

/**
 * Compare one metric's samples. Returns the two central values, the change,
 * and a verdict: `regression`, `improvement`, `unchanged`, or `missing` when a
 * side has no data (a build that cannot report it).
 */
export function compareMetric(key, baseSamples, headSamples) {
  const def = METRICS[key];
  const a = finite(baseSamples);
  const b = finite(headSamples);
  const central = def.kind === 'timing' ? median : mode;
  const base = a.length ? central(a) : null;
  const head = b.length ? central(b) : null;
  if (base === null || head === null) return { key, base, head, delta: null, ratio: null, p: null, verdict: 'missing' };
  const delta = head - base;
  const ratio = base === 0 ? (head === 0 ? 0 : Infinity) : delta / base;
  const p = def.kind === 'timing' ? mannWhitneyP(a, b) : 0;
  const large = Math.abs(delta) >= def.abs && Math.abs(ratio) >= def.rel;
  const significant = p < SIGNIFICANCE;
  const verdict = large && significant ? (delta > 0 ? 'regression' : 'improvement') : 'unchanged';
  return { key, base, head, delta, ratio, p: def.kind === 'timing' ? p : null, verdict };
}

/** A single side's central value, for a report with one target. */
export function single(key, samples) {
  const values = finite(samples);
  if (!values.length) return null;
  return METRICS[key].kind === 'timing' ? median(values) : mode(values);
}

/**
 * The whole comparison of `results` between targets `base` and `head`: one
 * row per page and per API call, each metric compared, and the tallies.
 */
export function compareResults(results, base, head) {
  const pages = results.pages.map((page) => {
    const a = page.targets[base] ?? {};
    const b = page.targets[head] ?? {};
    return {
      id: page.id,
      label: page.label,
      path: page.path,
      metrics: {
        ssrMs: compareMetric('ssrMs', a.ssr?.ms, b.ssr?.ms),
        ssrStatements: compareMetric('ssrStatements', a.ssr?.statements, b.ssr?.statements),
        ssrBlocks: compareMetric('ssrBlocks', a.ssr?.blocks, b.ssr?.blocks),
        htmlBytes: compareMetric('htmlBytes', a.ssr?.bytes, b.ssr?.bytes),
        lcpMs: compareMetric('lcpMs', a.load?.lcpMs, b.load?.lcpMs),
        loadMs: compareMetric('loadMs', a.load?.ms, b.load?.ms),
        loadStatements: compareMetric('loadStatements', a.load?.statements, b.load?.statements),
        apiRequests: compareMetric('apiRequests', a.load?.apiRequests, b.load?.apiRequests),
        blockingMs: compareMetric('blockingMs', a.load?.blockingMs, b.load?.blockingMs),
        domNodes: compareMetric('domNodes', a.load?.domNodes, b.load?.domNodes),
      },
      sql: { render: [a.ssr?.sql ?? null, b.ssr?.sql ?? null], load: [a.load?.sql ?? null, b.load?.sql ?? null] },
      status: [a.ssr?.status ?? null, b.ssr?.status ?? null],
    };
  });
  const apis = results.apis.map((api) => {
    const a = api.targets[base] ?? {};
    const b = api.targets[head] ?? {};
    return {
      path: api.path,
      metrics: {
        apiMs: compareMetric('apiMs', a.ms, b.ms),
        apiStatements: compareMetric('apiStatements', a.statements, b.statements),
        apiBytes: compareMetric('apiBytes', a.bytes, b.bytes),
      },
      sql: [a.sql ?? null, b.sql ?? null],
      status: [a.status ?? null, b.status ?? null],
      calledBy: [a.calledBy ?? [], b.calledBy ?? []],
    };
  });
  const all = [...pages, ...apis].flatMap((row) => Object.values(row.metrics));
  const tally = { regression: 0, improvement: 0, unchanged: 0, missing: 0 };
  for (const m of all) tally[m.verdict]++;
  return { pages, apis, tally };
}

/**
 * A statement's shape: its whitespace folded and every list of parameters
 * collapsed, so one query read with 5 ids and with 200 counts as one statement.
 */
export function queryShape(query) {
  return query
    .replace(/\s+/g, ' ')
    .replace(/\(\s*(?:\$\d+|\?)(?:\s*,\s*(?:\$\d+|\?))+\s*\)/g, '(…)')
    .trim();
}

/**
 * The statements whose call counts differ between two SQL breakdowns, by
 * shape, largest change first; a statement on one side only counts as zero on
 * the other.
 */
export function sqlDiff(baseSql, headSql) {
  const rows = new Map();
  const add = (q, side) => {
    const query = queryShape(q.query);
    const row = rows.get(query) ?? { query, base: 0, head: 0, baseMs: 0, headMs: 0 };
    row[side] += q.calls;
    row[`${side}Ms`] += q.ms;
    rows.set(query, row);
  };
  for (const q of baseSql?.queries ?? []) add(q, 'base');
  for (const q of headSql?.queries ?? []) add(q, 'head');
  return [...rows.values()]
    .filter((r) => r.base !== r.head)
    .sort((x, y) => Math.abs(y.head - y.base) - Math.abs(x.head - x.base) || y.head - x.head);
}
