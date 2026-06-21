export interface TestCaseSummary {
  title: string;
  location?: string;
  status: string;
  duration?: number | null;
}

export function extractCaseKey(title: string, location?: string): string {
  if (!location) return title;
  const match = location.match(/^(.*):(\d+):(\d+)$/);
  const filePath = match ? match[1] : location;
  return `${filePath}::${title}`;
}

export function matchCases(
  runA: TestCaseSummary[],
  runB: TestCaseSummary[],
): Array<{
  title: string;
  location: string | null;
  statusA: string | null;
  statusB: string | null;
  durationA: number | null;
  durationB: number | null;
  delta: number | null;
  percentChange: number | null;
}> {
  const mapA = new Map<string, TestCaseSummary>();
  for (const tc of runA) {
    mapA.set(extractCaseKey(tc.title, tc.location), tc);
  }

  const rows: Array<{
    title: string;
    location: string | null;
    statusA: string | null;
    statusB: string | null;
    durationA: number | null;
    durationB: number | null;
    delta: number | null;
    percentChange: number | null;
  }> = [];

  for (const tcB of runB) {
    const key = extractCaseKey(tcB.title, tcB.location);
    const tcA = mapA.get(key);
    const durationA = tcA?.duration ?? null;
    const durationB = tcB.duration ?? null;

    let delta: number | null = null;
    let percentChange: number | null = null;
    if (durationA !== null && durationB !== null) {
      delta = durationB - durationA;
      percentChange = durationA > 0 ? Math.round(((durationB - durationA) / durationA) * 100) : null;
    }

    rows.push({
      title: tcB.title,
      location: tcB.location ?? null,
      statusA: tcA?.status ?? null,
      statusB: tcB.status,
      durationA,
      durationB,
      delta,
      percentChange,
    });
  }

  // Add tests only in run A (removed in run B)
  const keyedRows = new Set(runB.map((tc) => extractCaseKey(tc.title, tc.location)));
  for (const tcA of runA) {
    if (!keyedRows.has(extractCaseKey(tcA.title, tcA.location))) {
      rows.push({
        title: tcA.title,
        location: tcA.location ?? null,
        statusA: tcA.status,
        statusB: null,
        durationA: tcA.duration ?? null,
        durationB: null,
        delta: null,
        percentChange: null,
      });
    }
  }

  return rows.sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0));
}

export interface ClassificationChanges {
  newFailures: number;
  recovered: number;
  stillFailing: number;
  regressed: number;
  improved: number;
  unchanged: number;
}

export function classifyChanges(
  rows: Array<{ statusA: string | null; statusB: string | null; percentChange: number | null }>,
): ClassificationChanges {
  const threshold = 10;
  let improved = 0;
  let regressed = 0;
  let unchanged = 0;
  let newFailures = 0;
  let recovered = 0;
  let stillFailing = 0;

  for (const row of rows) {
    if (row.statusA === 'passed' && row.statusB === 'failed') newFailures++;
    else if (row.statusA === 'failed' && row.statusB === 'passed') recovered++;
    else if (row.statusA === 'failed' && row.statusB === 'failed') stillFailing++;

    if (row.percentChange === null) continue;
    if (row.percentChange < -threshold) improved++;
    else if (row.percentChange > threshold) regressed++;
    else unchanged++;
  }

  return { improved, regressed, unchanged, newFailures, recovered, stillFailing };
}
