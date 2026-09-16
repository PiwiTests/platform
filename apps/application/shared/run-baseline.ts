/**
 * The run-level baseline: which earlier passing run a run is compared against
 * by the Changes tab, the stored regression signals, the CI gate, pull-request
 * feedback and the AI diagnosis. The selection itself is a database query
 * (`server/utils/branch-baseline.ts`); this module holds the shapes that
 * describe the outcome and the one sentence every surface uses to explain it.
 */

/**
 * How the baseline relates to the run it is compared against.
 *
 * `branch` — `same`: the run's own branch; `fallback`: the branch the run's
 * branch forked from (the pull request's target, else the project default);
 * `chosen`: the base branch a user picked; `any`: some other branch, because
 * none of the above had a passing run; `null`: the run has no branch, so the
 * branch was not a criterion.
 *
 * `environment` — `same`: the run's own environment label; `other`: another
 * label, because the run's environment has no passing run; `null`: the run has
 * no environment label, so the environment was not a criterion.
 */
export interface RunBaselineMatch {
  branch: 'same' | 'fallback' | 'chosen' | 'any' | null;
  environment: 'same' | 'other' | null;
}

/** The branch the automatic ladder falls back to, and where it came from. */
export interface RunBaselineFallback {
  branch: string;
  source: 'pull-request' | 'default';
}

export interface RunBaselineScope {
  branch: string | null;
  environment: string | null;
}

/**
 * One piece of the baseline sentence: plain words, a branch name or an
 * environment label — so the dashboard can render names with their icon while
 * the API, the MCP tool and the AI context read the same words as one string.
 */
export type RunBaselinePart =
  | { kind: 'text'; text: string }
  | { kind: 'branch'; name: string }
  | { kind: 'environment'; name: string };

const text = (t: string): RunBaselinePart => ({ kind: 'text', text: t });
const branch = (name: string): RunBaselinePart => ({ kind: 'branch', name });
const environment = (name: string): RunBaselinePart => ({ kind: 'environment', name });

/** "the default branch main" / "the pull request's target branch develop". */
function fallbackParts(fallback: RunBaselineFallback | null): RunBaselinePart[] {
  if (!fallback) return [text('the default branch')];
  const source = fallback.source === 'pull-request' ? "the pull request's target branch " : 'the default branch ';
  return [text(source), branch(fallback.branch)];
}

/** ", from the production environment" / ", from a run with no environment label". */
function fromEnvironmentParts(name: string | null): RunBaselinePart[] {
  return name
    ? [text(', from the '), environment(name), text(' environment')]
    : [text(', from a run with no environment label')];
}

/**
 * The sentence saying why this baseline was chosen, as parts — for the Changes
 * tab, which renders branch and environment names with their icon. Examples,
 * joined: "The last passing run on feature/x in staging." / "No passing
 * staging run exists on feature/x; the last passing run on the default branch
 * main in staging." / "No passing staging run exists; the last passing run on
 * feature/x, from the production environment."
 */
export function describeRunBaselineParts(input: {
  run: RunBaselineScope;
  baseline: RunBaselineScope;
  match: RunBaselineMatch;
  fallback: RunBaselineFallback | null;
}): RunBaselinePart[] {
  const { run, baseline, match, fallback } = input;
  const env = run.environment;
  const sameEnv = match.environment === 'same' && env;
  const inEnv: RunBaselinePart[] = sameEnv ? [text(' in '), environment(env)] : [];
  const otherEnv: RunBaselinePart[] = match.environment === 'other' ? fromEnvironmentParts(baseline.environment) : [];
  const envWord: RunBaselinePart[] = sameEnv ? [environment(env), text(' ')] : [];

  // The subject: which passing run was picked.
  let picked: RunBaselinePart[];
  switch (match.branch) {
    case 'same':
      picked = [text('the last passing run on '), branch(run.branch!), ...inEnv, ...otherEnv];
      break;
    case 'fallback':
      picked = [text('the last passing run on '), ...fallbackParts(fallback), ...inEnv, ...otherEnv];
      break;
    case 'chosen':
      picked = [
        text('the last passing run on '),
        branch(baseline.branch!),
        ...inEnv,
        text(', the base branch you chose'),
        ...otherEnv,
      ];
      break;
    case 'any': {
      const from: RunBaselinePart[] = baseline.branch ? [branch(baseline.branch)] : [text('a run with no branch')];
      const where: RunBaselinePart[] =
        match.environment === 'other'
          ? baseline.environment
            ? [text(' in '), environment(baseline.environment)]
            : [text(' in no environment')]
          : [];
      picked = [text('the most recent passing run'), ...inEnv, text(', from '), ...from, ...where];
      break;
    }
    default:
      picked = sameEnv
        ? [text('the last passing '), ...envWord, text('run')]
        : [text('the most recent passing run'), ...otherEnv];
  }

  // The reasons a closer candidate was not available.
  const reasons: RunBaselinePart[][] = [];
  if (match.branch === null && match.environment !== null) reasons.push([text('this run has no branch')]);
  if (match.environment === 'other' && env) {
    reasons.push(
      match.branch === 'chosen'
        ? [text('no passing '), environment(env), text(' run exists on '), branch(baseline.branch!)]
        : [text('no passing '), environment(env), text(' run exists')],
    );
  }
  if (match.branch === 'fallback') {
    reasons.push([text('no passing '), ...envWord, text('run exists on '), branch(run.branch!)]);
  }
  if (match.branch === 'any' && run.branch) {
    const or: RunBaselinePart[] = fallback ? [branch(fallback.branch)] : [text('the default branch')];
    reasons.push([text('no passing '), ...envWord, text('run exists on '), branch(run.branch), text(' or '), ...or]);
  }

  const parts: RunBaselinePart[] = [];
  if (reasons.length === 0) parts.push(...picked);
  else {
    reasons.forEach((reason, i) => parts.push(...(i > 0 ? [text(', and ')] : []), ...reason));
    parts.push(text('; '), ...picked);
  }
  parts.push(text('.'));

  // Capitalize the first word of the sentence.
  const first = parts[0]!;
  if (first.kind === 'text') parts[0] = text(first.text.charAt(0).toUpperCase() + first.text.slice(1));
  return mergeText(parts);
}

/** Collapse adjacent plain-text parts so consumers see the fewest pieces. */
function mergeText(parts: RunBaselinePart[]): RunBaselinePart[] {
  const merged: RunBaselinePart[] = [];
  for (const part of parts) {
    const last = merged[merged.length - 1];
    if (part.kind === 'text' && last?.kind === 'text') merged[merged.length - 1] = text(last.text + part.text);
    else merged.push(part);
  }
  return merged;
}

/** The parts joined into one plain sentence — what the API, MCP and AI context carry. */
export function describeRunBaseline(input: Parameters<typeof describeRunBaselineParts>[0]): string {
  return describeRunBaselineParts(input)
    .map((part) => (part.kind === 'text' ? part.text : part.name))
    .join('');
}
