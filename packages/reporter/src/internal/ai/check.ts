/**
 * Read-only hygiene scan over a committed entry tree, gating CI on the health of
 * the artifacts. It reports invalid files, non-canonical bytes (a file that would
 * change on a clean re-serialize), orphaned entries (their template literal is
 * gone from the spec source), and duplicate-template nudges. It never writes —
 * `piwi ai prune` does the deleting.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseEntry, serializeEntry } from './artifact.js';
import { DEFAULT_AI_DIR, normalizeTemplate } from './keys.js';

type CheckSeverity = 'error' | 'warning';
type CheckKind = 'invalid' | 'non-canonical' | 'orphan' | 'duplicate-template';

export interface CheckFinding {
  severity: CheckSeverity;
  kind: CheckKind;
  /** Entry file, relative to the scanned root. */
  file: string;
  message: string;
}

/** One discovered entry file with the spec it belongs to (per the storage layout). */
interface FoundEntry {
  file: string;
  specFile: string;
  testSlug: string;
}

/** Recursively collect entry files laid out as `<spec-dir>/<dir>/<spec-file>/<entry>.json`. */
function findEntryFiles(root: string, dir: string): FoundEntry[] {
  const out: FoundEntry[] = [];
  const walk = (current: string): void => {
    let items: fs.Dirent[];
    try {
      items = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) {
        walk(full);
      } else if (item.isFile() && item.name.endsWith('.json')) {
        // Grandparent directory named `dir` marks an entry file.
        const specFileDir = path.dirname(full);
        const dirName = path.basename(path.dirname(specFileDir));
        if (dirName !== dir) continue;
        const specDir = path.dirname(path.dirname(specFileDir));
        const specFile = path.join(specDir, path.basename(specFileDir));
        out.push({ file: full, specFile, testSlug: item.name.split('.')[0] });
      }
    }
  };
  walk(root);
  return out;
}

function readTextOr(file: string, fallback: string | null): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return fallback;
  }
}

/** Scan an entry tree rooted at `root`, returning findings sorted by file. */
export function checkAiTree(root: string, opts: { dir?: string } = {}): CheckFinding[] {
  const dir = opts.dir ?? DEFAULT_AI_DIR;
  const findings: CheckFinding[] = [];
  const rel = (file: string): string => path.relative(root, file).split(path.sep).join('/');
  const sourceCache = new Map<string, string | null>();
  const duplicates = new Map<string, string[]>();

  for (const found of findEntryFiles(root, dir)) {
    const text = readTextOr(found.file, null);
    if (text === null) continue;

    let templateNormalized: string | null = null;
    try {
      const entry = parseEntry(text);
      templateNormalized = normalizeTemplate(entry.template);

      if (serializeEntry(entry) !== text) {
        findings.push({
          severity: 'error',
          kind: 'non-canonical',
          file: rel(found.file),
          message: 'file is not in canonical form — run `piwi ai prune --apply` or re-resolve to rewrite it',
        });
      }

      if (!sourceCache.has(found.specFile)) sourceCache.set(found.specFile, readTextOr(found.specFile, null));
      const source = sourceCache.get(found.specFile) ?? null;
      if (source === null) {
        findings.push({
          severity: 'error',
          kind: 'orphan',
          file: rel(found.file),
          message: `spec file is gone (${rel(found.specFile)}) — the entry is orphaned`,
        });
      } else if (!source.includes(entry.template.trim())) {
        findings.push({
          severity: 'error',
          kind: 'orphan',
          file: rel(found.file),
          message: `template "${entry.template}" no longer appears in ${rel(found.specFile)} — the entry is orphaned`,
        });
      }
    } catch (error) {
      findings.push({
        severity: 'error',
        kind: 'invalid',
        file: rel(found.file),
        message: `not a valid entry: ${(error as Error).message}`,
      });
    }

    if (templateNormalized !== null) {
      const key = `${found.specFile}::${found.testSlug}::${templateNormalized}`;
      const list = duplicates.get(key) ?? [];
      list.push(rel(found.file));
      duplicates.set(key, list);
    }
  }

  for (const files of duplicates.values()) {
    if (files.length < 2) continue;
    for (const file of files) {
      findings.push({
        severity: 'warning',
        kind: 'duplicate-template',
        file,
        message: `duplicate template within the same test — consider distinct phrasings (${files.join(', ')})`,
      });
    }
  }

  return findings.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

/** Whether a set of findings should gate CI (any error-severity finding). */
export function hasBlockingFindings(findings: readonly CheckFinding[]): boolean {
  return findings.some((f) => f.severity === 'error');
}
