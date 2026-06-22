/**
 * Canonical list of evidence sections that can feed an AI diagnosis. Single
 * source of truth shared by:
 *  - the server "Data Coverage" block (server/utils/ai-context.ts)
 *  - the result's evidence citation chips (DiagnosisResult.vue)
 *  - the context modal's coverage panel (DiagnosisContextModal.vue)
 *
 * `label` is the long human name; `short` is used on compact citation chips.
 */
export interface DiagnosisSectionMeta {
  id: string;
  label: string;
  short: string;
}

export const DIAGNOSIS_SECTIONS: DiagnosisSectionMeta[] = [
  { id: 'clusterSummary', label: 'Failure cluster summary', short: 'Cluster' },
  { id: 'sampleError', label: 'Raw error message', short: 'Error' },
  { id: 'executionError', label: 'Representative execution error', short: 'Error' },
  { id: 'affectedTests', label: 'Affected tests', short: 'Tests' },
  { id: 'testSource', label: 'Test source code', short: 'Source' },
  { id: 'steps', label: 'Test steps', short: 'Steps' },
  { id: 'failingSteps', label: 'Failing steps', short: 'Steps' },
  { id: 'console', label: 'Browser console logs', short: 'Console' },
  { id: 'networkRequests', label: 'Network requests', short: 'Network' },
  { id: 'serverLogs', label: 'Backend server logs', short: 'Server logs' },
  { id: 'webVitals', label: 'Web vitals', short: 'Web vitals' },
  { id: 'ariaSnapshot', label: 'ARIA snapshot', short: 'ARIA' },
  { id: 'browserDistribution', label: 'Browser distribution', short: 'Browsers' },
  { id: 'recurrenceFlakiness', label: 'Recurrence & flakiness', short: 'Flakiness' },
  { id: 'passedPeers', label: 'Passing peers in same file', short: 'Peers' },
  { id: 'scmInvestigation', label: 'SCM diff since last green', short: 'SCM diff' },
  { id: 'selectedCommits', label: 'Manually selected commits', short: 'Commits' },
  { id: 'priorDiagnosis', label: 'Prior diagnosis & triage', short: 'Prior' },
  { id: 'tracePointers', label: 'Trace files', short: 'Traces' },
];

const SECTION_IDS = new Set(DIAGNOSIS_SECTIONS.map((s) => s.id));

/** Short label for a section id (falls back to the id itself). */
export const DIAGNOSIS_SECTION_SHORT: Record<string, string> = Object.fromEntries(
  DIAGNOSIS_SECTIONS.map((s) => [s.id, s.short]),
);

export function isKnownSectionId(id: string): boolean {
  return SECTION_IDS.has(id);
}

/**
 * Extract the `[sectionId]` citations the model embedded in evidence strings.
 * Returns the unique, known section ids in first-seen order.
 */
export function extractCitedSectionIds(texts: Array<string | null | undefined>): string[] {
  const found = new Set<string>();
  for (const t of texts) {
    if (!t) continue;
    for (const m of String(t).matchAll(/\[([a-zA-Z][a-zA-Z0-9]*)\]/g)) {
      if (SECTION_IDS.has(m[1]!)) found.add(m[1]!);
    }
  }
  return [...found];
}
