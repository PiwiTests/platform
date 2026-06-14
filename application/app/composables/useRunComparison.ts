interface TestCaseSummary {
  title: string;
  location?: string;
  status: string;
  duration?: number | null;
}

interface RunWithCases {
  testCases?: TestCaseSummary[];
}

export interface ComparisonRow {
  title: string;
  location: string | null;
  statusA: string | null;
  statusB: string | null;
  durationA: number | null;
  durationB: number | null;
  delta: number | null;
  percentChange: number | null;
}

export interface ComparisonSummary {
  improved: number;
  regressed: number;
  unchanged: number;
  newFailures: number;
  recovered: number;
  stillFailing: number;
}

function caseKey(tc: TestCaseSummary): string {
  if (!tc.location) return tc.title;
  // location format: filepath:line:column
  // On Windows, filepath may contain a drive letter (e.g., C:\path\to\file.ts)
  // Extract filepath by removing the last two colon-separated numbers
  const match = tc.location.match(/^(.*):(\d+):(\d+)$/);
  const filePath = match ? match[1] : tc.location;
  return `${filePath}::${tc.title}`;
}

/**
 * Computes per-test-case comparison data between two runs.
 * Includes status awareness (new failures, recovered, still failing).
 */
export function useRunComparison(runA: Ref<RunWithCases | null>, runB: Ref<RunWithCases | null>) {
  const comparisonData = computed<ComparisonRow[]>(() => {
    if (!runA.value?.testCases || !runB.value?.testCases) return [];

    const mapA = new Map<string, TestCaseSummary>();
    for (const tc of runA.value.testCases) {
      mapA.set(caseKey(tc), tc);
    }

    const rows: ComparisonRow[] = [];
    for (const tcB of runB.value.testCases) {
      const tcA = mapA.get(caseKey(tcB));
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
    const keyedRows = new Set(runB.value.testCases.map(caseKey));
    for (const tcA of runA.value.testCases) {
      if (!keyedRows.has(caseKey(tcA))) {
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
  });

  const comparisonSummary = computed<ComparisonSummary>(() => {
    const threshold = 10;
    let improved = 0;
    let regressed = 0;
    let unchanged = 0;
    let newFailures = 0;
    let recovered = 0;
    let stillFailing = 0;

    for (const row of comparisonData.value) {
      // Status-aware counts
      if (row.statusA === 'passed' && row.statusB === 'failed') newFailures++;
      else if (row.statusA === 'failed' && row.statusB === 'passed') recovered++;
      else if (row.statusA === 'failed' && row.statusB === 'failed') stillFailing++;

      // Duration change counts
      if (row.percentChange === null) continue;
      if (row.percentChange < -threshold) improved++;
      else if (row.percentChange > threshold) regressed++;
      else unchanged++;
    }

    return { improved, regressed, unchanged, newFailures, recovered, stillFailing };
  });

  return { comparisonData, comparisonSummary };
}
