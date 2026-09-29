import type { FlakeExperimentRecord, FlakeLabTestState } from '#shared/flake-lab';

const VERDICT_WORDS: Record<string, string> = {
  reproduced: 'reproduced',
  amplified: 'amplified',
  'not-reproduced': 'not reproduced',
  verified: 'fix verified',
  'still-fails': 'still fails',
  inconclusive: 'inconclusive',
};

/** An experiment or arm verdict in words. */
export function flakeVerdictWord(verdict: string | null): string {
  return verdict ? (VERDICT_WORDS[verdict] ?? verdict) : 'no verdict';
}

/** A p-value as the lab prints it. */
export function formatFlakePValue(p: number | null): string {
  if (p == null) return '';
  return p < 0.001 ? 'p < 0.001' : `p = ${p.toFixed(3)}`;
}

/** The experiment in one sentence: what reproduced it, or what the verify rerun found. */
export function flakeExperimentSentence(e: FlakeExperimentRecord): string {
  const control = e.arms.find((a) => a.key === 'control');
  const against = control ? ` against ${control.matchingFailures}/${control.runs}` : '';
  if (e.kind === 'verify') {
    const arm = e.arms.find((a) => a.key === 'verify');
    if (!arm) return `Verify: ${flakeVerdictWord(e.verdict)}`;
    return `Verify: ${flakeVerdictWord(e.verdict)} (${arm.matchingFailures}/${arm.runs} under ${arm.label}${against})`;
  }
  const arm = e.arms.find((a) => a.id === e.reproducingArmId);
  if (arm) {
    return `Reproduced by ${arm.label} (${arm.matchingFailures}/${arm.runs}${against}, ${formatFlakePValue(arm.pValue)})`;
  }
  const tried = e.arms.filter((a) => a.key !== 'control').length;
  return `${flakeVerdictWord(e.verdict).replace(/^./, (c) => c.toUpperCase())} (${tried} arm${tried === 1 ? '' : 's'}${against})`;
}

/** Where a test stands in the lab, in a few words. */
export const FLAKE_LAB_STATE_WORDS: Record<FlakeLabTestState, string> = {
  untested: 'Not tested in the lab',
  'not-reproduced': 'Not reproduced',
  amplified: 'Amplified, not reproduced',
  reproduced: 'Reproduced, fix not verified',
  'still-fails': 'Still fails after a fix',
  inconclusive: 'Fix verify inconclusive',
  verified: 'Verified fixed',
  'flaked-again': 'Flaky again after a verified fix',
};
