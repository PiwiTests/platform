/**
 * A line diff of two texts, as the hunks `git diff --unified=0` would give:
 * editors compare an unsaved buffer with the committed file this way, then
 * read anchors out of the hunks like any diff.
 *
 * Common leading and trailing lines are trimmed, and the rest is diffed with
 * Myers' algorithm. Past {@link MAX_EDIT_DISTANCE} changes, the middle is
 * reported as one replaced block rather than searched further.
 */
import type { DiffFile, DiffHunk } from './diff-anchors';

/** Edit distance searched before the middle is reported as one block. */
export const MAX_EDIT_DISTANCE = 2000;

type Op = 'equal' | 'remove' | 'add';

/** Myers' shortest edit script between two line arrays, as operations in order. */
function editScript(a: string[], b: string[]): Op[] | null {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  // One spare diagonal on each side, so the window of step `max` stays in bounds.
  const offset = max + 1;
  const v = new Int32Array(2 * max + 4);
  const trace: Int32Array[] = [];
  let found = false;
  for (let d = 0; d <= Math.min(max, MAX_EDIT_DISTANCE); d++) {
    // Only the diagonals -d-1 … d+1 matter when walking back through step d.
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
    if (found) break;
  }
  if (!found) return null;
  // Walk back through the trace to recover the operations.
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d]!;
    const at = (diagonal: number) => vd[diagonal + d + 1]!;
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push('equal');
      x--;
      y--;
    }
    if (d > 0) {
      if (x === prevX) {
        ops.push('add');
        y--;
      } else {
        ops.push('remove');
        x--;
      }
    }
  }
  return ops.reverse();
}

function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** The hunks turning `before` into `after`, with no context lines. */
export function diffLines(path: string, before: string, after: string): DiffFile {
  const a = splitLines(before);
  const b = splitLines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const ops = editScript(midA, midB) ?? [...midA.map((): Op => 'remove'), ...midB.map((): Op => 'add')];

  const hunks: DiffHunk[] = [];
  let hunk: DiffHunk | null = null;
  let oldLine = start + 1;
  let newLine = start + 1;
  let i = 0;
  let j = 0;
  for (const op of ops) {
    if (op === 'equal') {
      hunk = null;
      oldLine++;
      newLine++;
      i++;
      j++;
      continue;
    }
    if (!hunk) {
      hunk = { oldStart: oldLine, newStart: newLine, removed: [], added: [] };
      hunks.push(hunk);
    }
    if (op === 'remove') hunk.removed.push({ line: oldLine++, text: midA[i++]! });
    else hunk.added.push({ line: newLine++, text: midB[j++]! });
  }
  for (const h of hunks) {
    // A pure insertion is placed after the line before it, as git reports it.
    if (h.removed.length === 0) h.oldStart = h.oldStart - 1;
    if (h.added.length === 0) h.newStart = h.newStart - 1;
  }
  return { path, status: 'modified', hunks };
}
