/**
 * Turn a resolved test list into arguments Playwright understands.
 *
 * This is the selection-shaped counterpart to `buildRetryCommand`: same
 * `file-line → grep → file` fallback ladder and the same Windows-safe path
 * normalization, but it emits a structured result (bare args plus a
 * copy-pasteable command) rather than only a shell string, and it works from a
 * resolved selection rather than a set of failures.
 */
import { escapeGrep, toPosixPath } from '../retry-command';
import type { MaterializedSelection, ResolvedTest, SelectionFormat } from './types';

const MAX_CMD_LENGTH = 4096;

/** Double-quote a token for the copy-pasteable command. */
function quote(arg: string): string {
  return '"' + arg.replace(/"/g, '\\"') + '"';
}

function fileLineArgs(tests: ResolvedTest[]): string[] {
  const seen = new Set<string>();
  const args: string[] = [];
  for (const t of tests) {
    const token = t.line ? `${toPosixPath(t.filePath)}:${t.line}` : toPosixPath(t.filePath);
    if (seen.has(token)) continue;
    seen.add(token);
    args.push(token);
  }
  return args;
}

function fileArgs(tests: ResolvedTest[]): string[] {
  const seen = new Set<string>();
  const args: string[] = [];
  for (const t of tests) {
    const posix = toPosixPath(t.filePath);
    if (seen.has(posix)) continue;
    seen.add(posix);
    args.push(posix);
  }
  return args;
}

function grepArgs(tests: ResolvedTest[]): string[] {
  const escaped = [...new Set(tests.map((t) => escapeGrep(t.title)))];
  const pattern = escaped.length === 1 ? escaped[0]! : `(${escaped.join('|')})`;
  return ['--grep', pattern];
}

function buildArgs(tests: ResolvedTest[], format: Exclude<SelectionFormat, 'json'>): string[] {
  if (format === 'grep') return grepArgs(tests);
  if (format === 'files') return fileArgs(tests);
  return fileLineArgs(tests);
}

function render(base: string, args: string[]): string {
  return `${base} ${args.map(quote).join(' ')}`;
}

/**
 * Materialize a resolved test list to the requested format. Falls the format
 * down the `grep → args → files` ladder when the rendered command would exceed
 * a safe length, and reports the format it actually produced.
 */
export function materializeSelection(
  tests: ResolvedTest[],
  format: SelectionFormat = 'args',
  opts?: { pkgRunner?: string },
): MaterializedSelection {
  if (format === 'json' || tests.length === 0) {
    return { format, args: [], command: '' };
  }

  const base = `${opts?.pkgRunner ?? 'npx'} playwright test`;

  let current: Exclude<SelectionFormat, 'json'> = format;
  let args = buildArgs(tests, current);
  let command = render(base, args);

  while (command.length > MAX_CMD_LENGTH && current !== 'files') {
    current = current === 'grep' ? 'args' : 'files';
    args = buildArgs(tests, current);
    command = render(base, args);
  }

  if (command.length > MAX_CMD_LENGTH) {
    command = command.slice(0, MAX_CMD_LENGTH - 3) + '...';
  }

  return { format: current, args, command };
}
