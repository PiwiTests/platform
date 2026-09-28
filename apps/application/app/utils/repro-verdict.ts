/**
 * A repro run's verdict in words, for the runs tray and its toast: the same
 * outcomes Replay names in Piwi Picker.
 */
import type { SpecRunVerdict } from '@piwitests/core/bug-report';

export interface ReproVerdictText {
  label: string;
  detail: string;
  color: 'error' | 'success' | 'warning' | 'neutral';
}

export function reproVerdictText(verdict: SpecRunVerdict | null): ReproVerdictText {
  switch (verdict?.kind) {
    case 'reproduced':
      return {
        label: 'Bug reproduced',
        detail: verdict.found
          ? `Step ${verdict.step + 1} found ${verdict.found}.`
          : `The expected result at step ${verdict.step + 1} does not hold.`,
        color: 'error',
      };
    case 'not-reproduced':
      return { label: 'Not reproduced', detail: 'Every expected result held.', color: 'success' };
    case 'diverged':
      return { label: `Diverged at step ${verdict.step + 1}`, detail: verdict.reason, color: 'warning' };
    case 'completed':
      return { label: 'Completed', detail: 'The steps ran; the report states no expected result.', color: 'neutral' };
    default:
      return { label: 'Stopped', detail: 'The run ended before a verdict.', color: 'neutral' };
  }
}
