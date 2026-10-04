/**
 * Shared result shape for the `init` / `skills` commands.
 *
 * Every step a command performs — wrapping the config, creating fixtures,
 * writing a skill — reports one `StepResult`. The command prints them as a
 * human summary by default and as JSON under `--json`, so an agent driving the
 * command reads the exact same outcomes a person sees in the terminal.
 */

type StepStatus =
  /** A file that did not exist was written. */
  | 'created'
  /** An existing file was edited in place. */
  | 'updated'
  /** Nothing to do — the desired state was already present. */
  | 'already'
  /** The tool could not do it safely; `detail` carries the exact change to apply by hand. */
  | 'manual'
  /** Deliberately not done (e.g. a target exists and `--force` was not passed). */
  | 'skipped'
  /** The step was attempted and failed; `detail` carries the error. */
  | 'error';

export interface StepResult {
  /** Machine id of the step, e.g. `config`, `fixtures`, `env`, `skill:investigate-failure`. */
  step: string;
  /** Repo-relative path the step touched, when it maps to a single file. */
  file?: string;
  status: StepStatus;
  /** One-line explanation — always safe to print, never secret-bearing. */
  detail: string;
}

const STATUS_MARK: Record<StepStatus, string> = {
  created: '+',
  updated: '~',
  already: '=',
  manual: '!',
  skipped: '-',
  error: 'x',
};

/** Render one result as a single aligned terminal line. */
export function formatStep(result: StepResult): string {
  const where = result.file ? ` ${result.file}` : '';
  return `  ${STATUS_MARK[result.status]} [${result.status}] ${result.step}${where} — ${result.detail}`;
}
