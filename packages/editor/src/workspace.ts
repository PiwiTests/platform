/**
 * The workspace as the editor service sees it: the Playwright configs it
 * holds (each one a context: call sites resolve against its directory), the
 * git repository around them, and the committed version of a file.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isTranslationFile, parseTranslationFile } from '@piwitests/core/diff-anchors';

const run = promisify(execFile);

const CONFIG_NAMES = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs', 'playwright.config.cjs'];
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.output',
  '.nuxt',
  '.next',
  'coverage',
  'test-results',
]);
/** Directory levels searched below a workspace folder for Playwright configs. */
const MAX_DEPTH = 4;

/** The directories under `root` (itself included) that hold a Playwright config. */
export function findPlaywrightRoots(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.isFile() && CONFIG_NAMES.includes(e.name))) found.push(dir);
    if (depth >= MAX_DEPTH) return;
    for (const e of entries) {
      if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(path.join(dir, e.name), depth + 1);
    }
  };
  walk(path.resolve(root), 0);
  return found;
}

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run('git', args, { cwd, maxBuffer: 64 * 1024 * 1024, encoding: 'utf-8' });
    return stdout;
  } catch {
    return null;
  }
}

/** The repository root around `dir`; `dir` itself outside a repository. */
export async function repositoryRoot(dir: string): Promise<string> {
  const out = await git(dir, ['rev-parse', '--show-toplevel']);
  return out ? path.resolve(out.trim()) : path.resolve(dir);
}

/** The checked-out branch; null on a detached head or outside a repository. */
export async function currentBranch(repoRoot: string): Promise<string | null> {
  const out = (await git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']))?.trim();
  return out && out !== 'HEAD' ? out : null;
}

/** The commit `HEAD` names; null outside a repository. */
export async function headCommit(repoRoot: string): Promise<string | null> {
  return (await git(repoRoot, ['rev-parse', 'HEAD']))?.trim() || null;
}

/** A file as `HEAD` holds it; null when it is new or outside a repository. */
export async function committedText(repoRoot: string, relativePath: string): Promise<string | null> {
  return git(repoRoot, ['show', `HEAD:${relativePath.split(path.sep).join('/')}`]);
}

/** A path relative to `root`, with forward slashes; null when it is outside. */
export function relativeTo(root: string, file: string): string | null {
  const rel = path.relative(root, file);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

/**
 * Translation values by key for one side of a change: the working tree
 * (`new`) or `HEAD` (`old`). Built once per side and repository state; the
 * files of `locale` come first.
 */
export async function translationValues(
  repoRoot: string,
  side: 'old' | 'new',
  locale = 'en',
): Promise<Map<string, string>> {
  const listed = (await git(repoRoot, ['ls-files']))?.split('\n').filter((f) => f && isTranslationFile(f)) ?? [];
  const prefers = (f: string) => {
    const parts = f.toLowerCase().split('/');
    const stem = parts[parts.length - 1]!.replace(/\.[^.]+$/, '');
    return parts.includes(locale) || stem === locale || stem.endsWith(`.${locale}`);
  };
  listed.sort((a, b) => Number(prefers(b)) - Number(prefers(a)) || a.localeCompare(b));
  const map = new Map<string, string>();
  for (const file of listed) {
    const text =
      side === 'new'
        ? await fs.promises.readFile(path.join(repoRoot, file), 'utf-8').catch(() => null)
        : await committedText(repoRoot, file);
    if (text === null) continue;
    for (const entry of parseTranslationFile(file, text)) {
      if (!map.has(entry.key)) map.set(entry.key, entry.value);
      const dot = entry.key.indexOf('.');
      if (dot > 0 && !map.has(entry.key.slice(dot + 1))) map.set(entry.key.slice(dot + 1), entry.value);
    }
  }
  return map;
}
