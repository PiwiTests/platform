/**
 * Pure unified-diff parser and dry-run applier used to validate an AI-suggested
 * `suggestedFix.patch` against the real file content the model was shown. No
 * dependencies, no filesystem — safe to run on the server (and, later, the UI).
 *
 * The goal is a trustworthy signal, not a full `git apply` reimplementation:
 * we parse the hunks, then check that each hunk's context/deletion lines can be
 * located in the target file (at its stated position, or shifted — "offset"),
 * so the UI can badge a patch as verified rather than taking it on faith.
 */

export interface PatchHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Body lines including their leading marker (' ' context, '+' add, '-' delete). */
  lines: string[];
}

export interface PatchFile {
  /** Path from `--- a/…` (null for /dev/null, i.e. a newly added file). */
  oldPath: string | null;
  /** Path from `+++ b/…` (null for /dev/null, i.e. a deleted file). */
  newPath: string | null;
  hunks: PatchHunk[];
}

export interface ParsedPatch {
  files: PatchFile[];
}

export type PatchValidationStatus = 'applies' | 'applies-with-offset' | 'stale-file' | 'invalid' | 'unchecked';

export interface PatchValidation {
  status: PatchValidationStatus;
  /** How many target files we actually had content for and could check. */
  filesChecked: number;
  /** How many distinct files the patch touches. */
  filesInPatch: number;
  /** Human-readable reasons, one per problem file. */
  errors: string[];
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * The patch validation stored on a diagnosis's details. An agent's diagnosis
 * keeps it inside its suggested fix, Piwi's own diagnosis at the top of the
 * details; the suggested fix's wins when both are present. `null` when neither
 * holds an object with a string `status`.
 */
export function storedPatchValidation(details: unknown): PatchValidation | null {
  const d = details as { suggestedFix?: { patchValidation?: unknown } | null; patchValidation?: unknown } | null;
  for (const candidate of [d?.suggestedFix?.patchValidation, d?.patchValidation]) {
    if (candidate && typeof candidate === 'object' && typeof (candidate as { status?: unknown }).status === 'string') {
      return candidate as PatchValidation;
    }
  }
  return null;
}

/** Strip a leading `a/` or `b/` diff prefix; leave other paths untouched. `/dev/null` → null. */
export function stripAbPrefix(path: string | null | undefined): string | null {
  if (!path) return null;
  const p = path.trim();
  if (p === '/dev/null') return null;
  return p.replace(/^[ab]\//, '');
}

/**
 * Parse a unified diff into files and hunks. Tolerant of `diff --git` preamble
 * lines and of hunks that omit the count (defaulting to 1). Returns
 * `{ files: [] }` when nothing parseable is found.
 */
export function parseUnifiedDiff(text: string): ParsedPatch {
  const files: PatchFile[] = [];
  const lines = text.split('\n');
  let current: PatchFile | null = null;
  let hunk: PatchHunk | null = null;

  const closeHunk = () => {
    if (current && hunk) current.hunks.push(hunk);
    hunk = null;
  };
  const closeFile = () => {
    closeHunk();
    if (current && current.hunks.length > 0) files.push(current);
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (line.startsWith('--- ')) {
      closeFile();
      current = { oldPath: parsePathLine(line.slice(4)), newPath: null, hunks: [] };
      continue;
    }
    if (line.startsWith('+++ ') && current) {
      current.newPath = parsePathLine(line.slice(4));
      continue;
    }

    const m = HUNK_RE.exec(line);
    if (m && current) {
      closeHunk();
      hunk = {
        oldStart: parseInt(m[1]!, 10),
        oldLines: m[2] != null ? parseInt(m[2], 10) : 1,
        newStart: parseInt(m[3]!, 10),
        newLines: m[4] != null ? parseInt(m[4], 10) : 1,
        lines: [],
      };
      continue;
    }

    if (hunk) {
      const c = line[0];
      if (c === ' ' || c === '+' || c === '-') {
        hunk.lines.push(line);
        continue;
      }
      if (c === '\\') continue; // "\ No newline at end of file"
      // Anything else ends the hunk (and, if not a new file/hunk marker, the file).
      closeHunk();
    }
  }
  closeFile();

  return { files };
}

/** Extract the path token from a `--- ` / `+++ ` line (drops a trailing tab-timestamp). */
function parsePathLine(rest: string): string | null {
  const token = rest.split('\t')[0]!.trim();
  return token === '/dev/null' ? null : token;
}

/** Lines of the pre-image (context + deletions), marker stripped. */
function oldBlock(hunk: PatchHunk): string[] {
  return hunk.lines.filter((l) => l[0] === ' ' || l[0] === '-').map((l) => l.slice(1));
}

/** Lines of the post-image (context + additions), marker stripped. */
function newBlock(hunk: PatchHunk): string[] {
  return hunk.lines.filter((l) => l[0] === ' ' || l[0] === '+').map((l) => l.slice(1));
}

function normalize(line: string): string {
  return line.replace(/\r$/, '');
}

/** Find `block` in `lines`, preferring the match closest to `expected`. -1 if none. */
function findBlock(lines: string[], block: string[], expected: number): number {
  if (block.length === 0) return Math.max(0, Math.min(expected, lines.length));
  let best = -1;
  let bestDist = Infinity;
  const last = lines.length - block.length;
  for (let i = 0; i <= last; i++) {
    let match = true;
    for (let j = 0; j < block.length; j++) {
      if (normalize(lines[i + j]!) !== normalize(block[j]!)) {
        match = false;
        break;
      }
    }
    if (!match) continue;
    const dist = Math.abs(i - expected);
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
      if (dist === 0) break;
    }
  }
  return best;
}

interface ApplyResult {
  ok: boolean;
  offset: boolean;
  reason?: string;
}

/** Dry-run apply a file's hunks against its content, tracking whether any hunk shifted. */
function applyHunks(content: string, hunks: PatchHunk[]): ApplyResult {
  let lines = content.split('\n');
  let offset = false;

  for (const hunk of hunks) {
    const oldB = oldBlock(hunk);
    const newB = newBlock(hunk);
    const expected = Math.max(0, hunk.oldStart - 1);
    const idx = findBlock(lines, oldB, expected);
    if (idx === -1) {
      return { ok: false, offset, reason: `hunk @@ -${hunk.oldStart} context did not match the file` };
    }
    if (oldB.length > 0 && idx !== expected) offset = true;
    lines = [...lines.slice(0, idx), ...newB, ...lines.slice(idx + oldB.length)];
  }

  return { ok: true, offset };
}

/** Case-exact lookup with an unambiguous path-suffix fallback (model may drop leading dirs). */
function lookupContent(files: Map<string, string>, target: string): string | null {
  const direct = files.get(target);
  if (direct != null) return direct;
  const matches: string[] = [];
  for (const key of files.keys()) {
    if (key === target || key.endsWith('/' + target) || target.endsWith('/' + key)) matches.push(key);
  }
  if (matches.length === 1) return files.get(matches[0]!) ?? null;
  return null;
}

/**
 * Validate an AI-suggested unified-diff patch against the file content the model
 * was shown (repo-relative path → content). Files not present in `available`
 * are counted but not judged, so a partially-grounded patch degrades to
 * `unchecked` rather than a false failure.
 */
export function validatePatch(
  patch: string | null | undefined,
  available: Map<string, string> | Record<string, string>,
): PatchValidation {
  if (!patch || !patch.trim()) {
    return { status: 'unchecked', filesChecked: 0, filesInPatch: 0, errors: [] };
  }

  const files = available instanceof Map ? available : new Map(Object.entries(available));
  const parsed = parseUnifiedDiff(patch);

  if (parsed.files.length === 0) {
    return { status: 'invalid', filesChecked: 0, filesInPatch: 0, errors: ['Could not parse a unified diff.'] };
  }

  const errors: string[] = [];
  let filesChecked = 0;
  let sawOffset = false;
  let sawStale = false;

  for (const f of parsed.files) {
    const target = stripAbPrefix(f.newPath) ?? stripAbPrefix(f.oldPath);
    if (!target) continue; // pure deletion of /dev/null etc. — nothing to verify
    const content = lookupContent(files, target);
    if (content == null) continue; // we don't have this file — leave it unchecked
    filesChecked++;
    const res = applyHunks(content, f.hunks);
    if (!res.ok) {
      sawStale = true;
      errors.push(`${target}: ${res.reason ?? 'did not apply'}`);
    } else if (res.offset) {
      sawOffset = true;
    }
  }

  let status: PatchValidationStatus;
  if (filesChecked === 0) status = 'unchecked';
  else if (sawStale) status = 'stale-file';
  else if (sawOffset) status = 'applies-with-offset';
  else status = 'applies';

  return { status, filesChecked, filesInPatch: parsed.files.length, errors };
}
