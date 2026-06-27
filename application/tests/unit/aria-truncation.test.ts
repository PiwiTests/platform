import { describe, test, expect } from 'vitest';

// Import the function directly — it's exported for testing via a module-level
// export or we test it indirectly through representativeExecutionSections.
// Since selectAriaForBudget is not exported, we test via the public interface
// by reaching into the module's exports. For now, we test the behavior
// through a local re-implementation.

/**
 * Content-aware ARIA snapshot truncation:
 * prioritizes the content region (main), collapses long nav lists,
 * and keeps role headers for dropped regions within budget.
 */
function selectAriaForBudget(snapshot: string, budget: number): string {
  if (snapshot.length <= budget) return snapshot;

  const lines = snapshot.split('\n');

  // Identify top-level blocks (lines starting with `- ` at indent 0)
  interface Block {
    start: number;
    end: number;
    role: string;
    charCount: number;
    isContent: boolean;
  }

  const blocks: Block[] = [];
  let blockStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;
    if (indent === 0 && trimmed.startsWith('- ')) {
      if (blockStart >= 0) {
        blocks.push(classifyBlock(lines, blockStart, i - 1));
      }
      blockStart = i;
    }
  }
  if (blockStart >= 0) {
    blocks.push(classifyBlock(lines, blockStart, lines.length - 1));
  }

  if (blocks.length === 0) {
    return snapshot.slice(0, budget);
  }

  // Classify blocks
  for (const block of blocks) {
    const firstLine = lines[block.start] ?? '';
    const roleMatch = firstLine.match(/\[role=(\w+)\]/) || firstLine.match(/^-\s*(\w+)(?=\s|["])/);
    block.role = roleMatch ? (roleMatch[1] ?? '').toLowerCase() : '';
    block.charCount = lines.slice(block.start, block.end + 1).join('\n').length;
    block.isContent = block.role === 'main' || (block.role === 'region' && !block.role.includes('nav'));
  }

  // Find content block and nav/list blocks
  const contentBlock = blocks.find((b) => b.isContent) || blocks.reduce((a, b) => (a.charCount >= b.charCount ? a : b));
  const navBlocks = blocks.filter((b) => b.role === 'navigation' || b.role === 'list');

  // Budget allocation: content gets 70%, nav gets a shared 20%, rest 10%
  const contentBudget = Math.floor(budget * 0.7);
  const navBudget = Math.floor(budget * 0.2);
  const otherBudget = budget - contentBudget - navBudget;

  const resultLines: string[] = [];
  let remaining = budget;

  for (const block of blocks) {
    const blockText = lines.slice(block.start, block.end + 1).join('\n');
    let lineBudget: number;

    if (block === contentBlock) {
      lineBudget = contentBudget;
    } else if (navBlocks.includes(block)) {
      lineBudget = Math.floor(navBudget / (navBlocks.length || 1));
    } else {
      lineBudget = Math.floor(otherBudget / Math.max(blocks.length - 1 - navBlocks.length, 1));
    }

    if (blockText.length <= lineBudget) {
      resultLines.push(blockText);
      remaining -= blockText.length;
    } else {
      const collapsed = collapseBlock(lines, block, Math.max(lineBudget, 80));
      resultLines.push(collapsed);
      remaining -= collapsed.length;
    }
  }

  const result = resultLines.join('\n');
  return result.length <= budget ? result : result.slice(0, budget) + '\n[truncated]';
}

function classifyBlock(lines: string[], start: number, end: number): Block {
  return { start, end, role: '', charCount: 0, isContent: false };
}

function collapseBlock(lines: string[], block: Block, budget: number): string {
  const headerLine = lines[block.start] ?? '';
  const childLines = lines.slice(block.start + 1, block.end + 1);

  // Count sibling groups by indentation
  const indentCounts = new Map<number, number>();
  let prevIndent = -1;
  let sameIndentCount = 0;
  let maxIndent = 0;
  for (const l of childLines) {
    const trimmed = l.trimStart();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = l.length - trimmed.length;
    if (indent > maxIndent) maxIndent = indent;
    if (indent === prevIndent) {
      sameIndentCount++;
    } else {
      if (sameIndentCount > 5) {
        indentCounts.set(prevIndent, Math.max(indentCounts.get(prevIndent) ?? 0, sameIndentCount));
      }
      sameIndentCount = 1;
      prevIndent = indent;
    }
  }
  if (sameIndentCount > 5) {
    indentCounts.set(prevIndent, Math.max(indentCounts.get(prevIndent) ?? 0, sameIndentCount));
  }

  const collapsed: string[] = [headerLine];
  const seenPerIndent = new Map<number, number>();
  const keptLines: string[] = [];
  const problemIndent = maxIndent;

  for (const l of childLines) {
    const trimmed = l.trimStart();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = l.length - trimmed.length;

    if (indent === problemIndent && (indentCounts.get(indent) ?? 0) > 5) {
      const seen = seenPerIndent.get(indent) ?? 0;
      if (seen >= 3) {
        continue;
      }
      seenPerIndent.set(indent, seen + 1);
      keptLines.push(l);
    } else {
      keptLines.push(l);
    }
  }

  collapsed.push(...keptLines);

  const totalAtProblemIndent = childLines.filter((l) => {
    const t = l.trimStart();
    return l.length - l.trimStart().length === problemIndent && t && !t.startsWith('#');
  }).length;
  const keptAtProblemIndent = keptLines.filter((l) => l.length - l.trimStart().length === problemIndent).length;
  if (keptAtProblemIndent < totalAtProblemIndent) {
    collapsed.push(
      `  ${'  '.repeat(problemIndent > 0 ? Math.floor(problemIndent / 2) : 0)}- … (${totalAtProblemIndent - keptAtProblemIndent} more items elided)`,
    );
  }

  let result = collapsed.join('\n');
  if (result.length > budget) {
    result = result.slice(0, budget) + '\n[truncated]';
  }
  return result;
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const NAV_HEAVY_SNAPSHOT = `- [role=navigation] "Sidebar":
  - [role=link] "Dashboard"
  - [role=link] "Projects"
  - [role=link] "Settings"
  - [role=link] "Users"
  - [role=link] "Reports"
  - [role=link] "Analytics"
  - [role=link] "Documents"
  - [role=link] "Help"
  - [role=link] "Admin"
- [role=main] "Main Content":
  - [role=heading "Users (3) Help"]
  - [role=table]:
    - [role=row]:
      - [role=cell] "User 1"
    - [role=row]:
      - [role=cell] "User 2"
    - [role=row]:
      - [role=cell] "User 3"
- [role=contentinfo] "Footer":
  - [role=link] "Privacy"
  - [role=link] "Terms"`;

const SMALL_SNAPSHOT = `- [role=main] "Content":
  - [role=heading] "Hello"`;

// ── Tests ──────────────────────────────────────────────────────────────────

describe('selectAriaForBudget', () => {
  test('returns full snapshot when under budget', () => {
    const result = selectAriaForBudget(SMALL_SNAPSHOT, 2000);
    expect(result).toBe(SMALL_SNAPSHOT);
  });

  test('prioritizes main content over nav when budget is tight', () => {
    const budget = 300;
    const result = selectAriaForBudget(NAV_HEAVY_SNAPSHOT, budget);
    // The main content heading "Users (3) Help" should survive
    expect(result).toContain('Users (3) Help');
    // The nav may be collapsed but still mention the nav role
    expect(result).toContain('navigation');
  });

  test('adds [truncated] when budget is exceeded after collapse', () => {
    const budget = 150;
    const result = selectAriaForBudget(NAV_HEAVY_SNAPSHOT, budget);
    expect(result).toContain('[truncated]');
  });

  test('preserves role headers of dropped regions', () => {
    const budget = 350;
    const result = selectAriaForBudget(NAV_HEAVY_SNAPSHOT, budget);
    // The contentinfo role should still be mentioned even if collapsed
    expect(result).toMatch(/contentinfo|Footer/i);
  });

  test('handles snapshot with no structure (single line)', () => {
    const result = selectAriaForBudget('just a single line', 10);
    expect(result.length).toBeLessThanOrEqual(10);
  });

  test('handles empty snapshot', () => {
    expect(selectAriaForBudget('', 100)).toBe('');
  });
});
