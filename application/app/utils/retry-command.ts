export type RetryMode = 'file-line' | 'grep' | 'file';

interface RetryCase {
  filePath: string;
  title: string;
  line?: number | null;
  projectName?: string | null;
}

const MAX_CMD_LENGTH = 4096;

function escapeGrep(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeShellArg(arg: string): string {
  return '"' + arg.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function groupByProject(cases: RetryCase[]): Map<string, RetryCase[]> {
  const groups = new Map<string, RetryCase[]>();
  for (const c of cases) {
    const key = c.projectName || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }
  return groups;
}

function dedupeFiles(cases: RetryCase[]): string[] {
  const seen = new Set<string>();
  return cases
    .filter((c) => {
      const key = c.filePath;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((c) => c.filePath);
}

export function buildRetryCommand(cases: RetryCase[], opts?: { mode?: RetryMode; pkgRunner?: string }): string {
  const mode = opts?.mode ?? 'file-line';
  const pkgRunner = opts?.pkgRunner ?? 'npx';
  const baseCmd = `${pkgRunner} playwright test`;

  if (cases.length === 0) return '';

  const groups = groupByProject(cases);
  const commands: string[] = [];

  for (const [project, projectCases] of groups) {
    let cmd: string;

    if (mode === 'file') {
      const files = dedupeFiles(projectCases);
      const args = files.map((f) => escapeShellArg(f)).join(' ');
      cmd = `${baseCmd} ${args}`;
    } else if (mode === 'file-line') {
      const seen = new Set<string>();
      const args = projectCases
        .filter((c) => {
          const key = c.filePath + ':' + c.line;
          if (c.line && seen.has(key)) return false;
          if (c.line) seen.add(key);
          return true;
        })
        .map((c) => {
          if (c.line) return escapeShellArg(`${c.filePath}:${c.line}`);
          return escapeShellArg(c.filePath);
        })
        .join(' ');
      cmd = `${baseCmd} ${args}`;
    } else {
      const escaped = projectCases.map((c) => escapeGrep(c.title));
      const grepArg = escaped.length === 1 ? escaped[0]! : `(${escaped.join('|')})`;
      cmd = `${baseCmd} --grep ${escapeShellArg(grepArg)}`;
    }

    if (project) {
      cmd += ` --project=${escapeShellArg(project)}`;
    }

    commands.push(cmd);
  }

  let result = commands.join(' && ');

  if (result.length > MAX_CMD_LENGTH) {
    if (mode === 'grep') {
      return buildRetryCommand(cases, { ...opts, mode: 'file-line' });
    }
    if (mode === 'file-line') {
      return buildRetryCommand(cases, { ...opts, mode: 'file' });
    }
    const files = dedupeFilePaths(cases);
    const args = files.join(' ');
    let cmd = `${baseCmd} ${args}`;
    if (cmd.length > MAX_CMD_LENGTH) {
      cmd = cmd.slice(0, MAX_CMD_LENGTH - 3) + '...';
    }
    return cmd;
  }

  return result;
}

function dedupeFilePaths(cases: RetryCase[]): string[] {
  const seen = new Set<string>();
  return cases.reduce<string[]>((acc, c) => {
    if (!seen.has(c.filePath)) {
      seen.add(c.filePath);
      acc.push(c.filePath);
    }
    return acc;
  }, []);
}
