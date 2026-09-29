/**
 * The execution timeline's step table, read as Playwright's step tree: which
 * steps it lists, how deep each one sits, which step failed (and which errors
 * the test caught), and the setup and teardown sections (hooks and fixtures)
 * that fold around the test body.
 */
import type { PerformanceStep } from '~~/types/api';
import {
  failingStepIndex,
  isCaptureStep,
  isPhaseContainer,
  stepFailureRoles,
  stepHookName,
  stepParents,
  stepPhases,
  type StepFailureRole,
  type StepPhase,
} from '#shared/step-tree';

/** A folded section of the table: what ran before or after the test body. */
export interface StepSectionSummary {
  /** Wall-clock time of the section, from Playwright's `Before Hooks` / `After Hooks` spans. */
  durationMs: number;
  /** The hooks it ran, by short name (`beforeAll`, `hook "seed"`), in order. */
  hooks: string[];
  /** The fixtures it set up or tore down, by name, in order. */
  fixtures: string[];
  /** Whether a step in it failed; an error the test caught does not count. */
  failed: boolean;
}

export interface StepTreeView {
  phases: StepPhase[];
  /** The step that failed — the innermost of the failing chain — or null. */
  failingIndex: number | null;
  /** Each step's part in the failure (null for a step that passed), see `stepFailureRoles`. */
  roles: Array<StepFailureRole | null>;
  /** Steps the table never lists: the capture's own and the phase containers. */
  hidden: Set<number>;
  /** How deep each step sits, not counting the phase containers. */
  level: number[];
  /** Steps that hold other steps (a `test.step`, a hook, a fixture). */
  groups: Set<number>;
  sections: { setup: StepSectionSummary | null; teardown: StepSectionSummary | null };
}

/** A fixture's name out of its short name (`fixture "db"` → `db`). */
function fixtureName(hookName: string): string {
  return /^fixture "(.+)"$/.exec(hookName)?.[1] ?? hookName;
}

/**
 * Read a stored step list as a tree: phases, levels, the failing step and the
 * folded sections. `error` is the execution's error text, which tells the step
 * that failed the test from an error the test caught.
 */
export function buildStepTreeView(steps: PerformanceStep[], error?: string | null): StepTreeView {
  const parents = stepParents(steps);
  const phases = stepPhases(steps, parents);
  const failingIndex = failingStepIndex(steps, parents, error);
  const roles = stepFailureRoles(steps, error, parents, failingIndex);
  const hidden = new Set<number>();
  const groups = new Set<number>();
  steps.forEach((step, i) => {
    if (isCaptureStep(step) || isPhaseContainer(step)) hidden.add(i);
    if (parents[i] !== -1) groups.add(parents[i]!);
  });

  const level = steps.map((_, i) => {
    let depth = 0;
    for (let p = parents[i]!; p !== -1; p = parents[p]!) if (!isPhaseContainer(steps[p]!)) depth++;
    return depth;
  });

  const summarize = (phase: 'setup' | 'teardown'): StepSectionSummary | null => {
    const indices = steps.map((_, i) => i).filter((i) => phases[i] === phase);
    if (indices.length === 0) return null;
    const hooks: string[] = [];
    const fixtures: string[] = [];
    let durationMs = 0;
    let failed = false;
    for (const i of indices) {
      const step = steps[i]!;
      if (isPhaseContainer(step) && parents[i] === -1) durationMs += step.duration || 0;
      if (hidden.has(i)) continue;
      if (roles[i] && roles[i] !== 'recovered') failed = true;
      const name = stepHookName(step);
      if (!name) continue;
      if (step.category === 'fixture') {
        const fixture = fixtureName(name);
        if (!fixtures.includes(fixture)) fixtures.push(fixture);
      } else if (!hooks.includes(name)) {
        hooks.push(name);
      }
    }
    return { durationMs, hooks, fixtures, failed };
  };

  return {
    phases,
    failingIndex,
    roles,
    hidden,
    level,
    groups,
    sections: { setup: summarize('setup'), teardown: summarize('teardown') },
  };
}

/** One line naming what a folded section ran: `beforeAll · beforeEach · 3 fixtures`. */
export function sectionSummaryText(summary: StepSectionSummary): string {
  const parts = [...summary.hooks];
  const n = summary.fixtures.length;
  if (n > 0) parts.push(n <= 2 ? `fixture${n === 1 ? '' : 's'} ${summary.fixtures.join(', ')}` : `${n} fixtures`);
  return parts.join(' · ');
}

/** A run of consecutive table rows that belong to one section. */
export interface RowBlock<R> {
  section: StepPhase;
  rows: R[];
}

/**
 * Split the table rows, already in time order, into consecutive section blocks.
 * A step row belongs to its step's phase; any other row (a request, a console
 * entry) joins the step row before it — or, at the top, the first one after it.
 */
export function groupRowsBySection<R>(rows: R[], stepPhase: (row: R) => StepPhase | null): Array<RowBlock<R>> {
  const own = rows.map(stepPhase);
  const firstKnown = own.find((phase): phase is StepPhase => phase !== null) ?? 'body';
  const blocks: Array<RowBlock<R>> = [];
  let current: StepPhase = firstKnown;
  rows.forEach((row, i) => {
    current = own[i] ?? current;
    const last = blocks[blocks.length - 1];
    if (last && last.section === current) last.rows.push(row);
    else blocks.push({ section: current, rows: [row] });
  });
  return blocks;
}
