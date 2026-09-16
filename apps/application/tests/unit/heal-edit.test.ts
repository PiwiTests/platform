import { describe, test, expect } from 'vitest';
import { buildHealEdit, buildUnifiedLineDiff, applyLineEdit } from '#shared/heal-edit';

describe('buildUnifiedLineDiff', () => {
  test('emits a git-applyable single-line hunk', () => {
    const diff = buildUnifiedLineDiff(
      'tests/checkout.spec.ts',
      42,
      "  a.getByRole('button')",
      "  a.getByTestId('pay')",
    );
    expect(diff).toBe(
      [
        '--- a/tests/checkout.spec.ts',
        '+++ b/tests/checkout.spec.ts',
        '@@ -42,1 +42,1 @@',
        "-  a.getByRole('button')",
        "+  a.getByTestId('pay')",
      ].join('\n'),
    );
  });
});

describe('buildHealEdit', () => {
  const base = {
    location: 'tests/checkout.spec.ts:42:5',
    sourceLine: { line: 42, text: "  await page.getByRole('button', { name: 'Pay' }).click();" },
    failingMethod: 'getByRole',
    recommendedLocator: "getByTestId('pay-btn')",
  };

  test('rewrites the line and produces an applyable diff with the parsed file path', () => {
    const edit = buildHealEdit(base);
    expect(edit).not.toBeNull();
    expect(edit!.filePath).toBe('tests/checkout.spec.ts');
    expect(edit!.line).toBe(42);
    expect(edit!.oldLine).toBe("  await page.getByRole('button', { name: 'Pay' }).click();");
    expect(edit!.newLine).toBe("  await page.getByTestId('pay-btn').click();");
    expect(edit!.unifiedDiff).toContain('--- a/tests/checkout.spec.ts');
    expect(edit!.unifiedDiff).toContain("+  await page.getByTestId('pay-btn').click();");
  });

  test('falls back to the provided file path when the location carries none', () => {
    const edit = buildHealEdit({ ...base, location: null, fallbackFilePath: 'tests/checkout.spec.ts' });
    expect(edit!.filePath).toBe('tests/checkout.spec.ts');
    expect(edit!.unifiedDiff).toContain('--- a/tests/checkout.spec.ts');
  });

  test('returns a null diff but keeps the rewrite when no file path is known', () => {
    const edit = buildHealEdit({ ...base, location: null });
    expect(edit!.filePath).toBeNull();
    expect(edit!.unifiedDiff).toBeNull();
    expect(edit!.newLine).toBe("  await page.getByTestId('pay-btn').click();");
  });

  test('returns null when there is no source line to rewrite', () => {
    expect(buildHealEdit({ ...base, sourceLine: null })).toBeNull();
  });

  test('returns null when the rewrite would be a no-op (method absent on the line)', () => {
    expect(buildHealEdit({ ...base, sourceLine: { line: 42, text: '  await page.click();' } })).toBeNull();
  });

  test('returns null without a recommendation or failing method', () => {
    expect(buildHealEdit({ ...base, recommendedLocator: null })).toBeNull();
    expect(buildHealEdit({ ...base, failingMethod: null })).toBeNull();
  });

  test('builds a context-bearing diff from the captured source snippet', () => {
    const edit = buildHealEdit({
      location: 'tests/pay.spec.ts:9:5',
      sourceLine: { line: 9, text: "  await page.getByRole('button', { name: 'Pay' }).click();" },
      failingMethod: 'getByRole',
      recommendedLocator: "getByTestId('pay-btn')",
      testSource: [
        "   8 | test('pay flow', async ({ page }) => {",
        ">  9 |   await page.getByRole('button', { name: 'Pay' }).click();",
        '  10 | });',
      ].join('\n'),
    });
    expect(edit!.unifiedDiff).toBe(
      [
        '--- a/tests/pay.spec.ts',
        '+++ b/tests/pay.spec.ts',
        '@@ -8,3 +8,3 @@',
        " test('pay flow', async ({ page }) => {",
        "-  await page.getByRole('button', { name: 'Pay' }).click();",
        "+  await page.getByTestId('pay-btn').click();",
        ' });',
      ].join('\n'),
    );
  });

  test('falls back to a context-free diff when the snippet has no neighbor for the target', () => {
    const edit = buildHealEdit({
      ...base,
      testSource: ">  42 |   await page.getByRole('button', { name: 'Pay' }).click();",
    });
    expect(edit!.unifiedDiff).toContain('@@ -42,1 +42,1 @@');
  });
});

describe('applyLineEdit', () => {
  const file =
    "import { test } from '@playwright/test';\n\ntest('x', async ({ page }) => {\n  await page.getByRole('button').click();\n});\n";

  test('rewrites the target line and preserves the trailing newline', () => {
    const r = applyLineEdit(file, {
      line: 4,
      oldLine: "  await page.getByRole('button').click();",
      newLine: "  await page.getByTestId('b').click();",
    });
    expect(r.kind).toBe('applied');
    if (r.kind === 'applied') {
      expect(r.content).toContain("  await page.getByTestId('b').click();");
      expect(r.content.endsWith('\n')).toBe(true);
      expect(r.content).not.toContain("getByRole('button')");
    }
  });

  test('preserves CRLF line endings', () => {
    const crlf = file.replace(/\n/g, '\r\n');
    const r = applyLineEdit(crlf, {
      line: 4,
      oldLine: "  await page.getByRole('button').click();",
      newLine: "  await page.getByTestId('b').click();",
    });
    expect(r.kind).toBe('applied');
    if (r.kind === 'applied') {
      expect(r.content.includes('\r\n')).toBe(true);
      expect(r.content).not.toMatch(/[^\r]\n/); // every LF is preceded by CR
    }
  });

  test('finds the line even when the recorded number drifted', () => {
    const r = applyLineEdit(file, {
      line: 1, // wrong line — the code moved
      oldLine: "  await page.getByRole('button').click();",
      newLine: "  await page.getByTestId('b').click();",
    });
    expect(r.kind).toBe('applied');
  });

  test('is a no-op (already-applied) when the new line is already present', () => {
    const healed = file.replace("getByRole('button')", "getByTestId('b')");
    const r = applyLineEdit(healed, {
      line: 4,
      oldLine: "  await page.getByRole('button').click();",
      newLine: "  await page.getByTestId('b').click();",
    });
    expect(r.kind).toBe('already-applied');
  });

  test('is stale when the old line is gone and not already healed', () => {
    const r = applyLineEdit(file, {
      line: 4,
      oldLine: "  await page.getByRole('link').click();",
      newLine: "  await page.getByTestId('b').click();",
    });
    expect(r.kind).toBe('stale');
  });

  test('applies at the recorded line even when the same text repeats elsewhere', () => {
    // The recorded line number is authoritative — a duplicate elsewhere is not
    // ambiguity when we know the exact line.
    const dup = '  a();\n  a();\n';
    const r = applyLineEdit(dup, { line: 1, oldLine: '  a();', newLine: '  b();' });
    expect(r.kind).toBe('applied');
    if (r.kind === 'applied') expect(r.content).toBe('  b();\n  a();\n');
  });

  test('is stale when the recorded line drifted and the old text matches ambiguously', () => {
    const dup = '  a();\n  a();\n';
    const r = applyLineEdit(dup, { line: 9, oldLine: '  a();', newLine: '  b();' });
    expect(r.kind).toBe('stale');
  });
});
