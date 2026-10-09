import { describe, test, expect } from 'vitest';
import {
  parseUnifiedDiff,
  patchInCode,
  patchStillAppliesAtFix,
  storedPatchValidation,
  storedPatchValidationAtFix,
  stripAbPrefix,
  validatePatch,
  type PatchValidationAtFix,
} from '#shared/patch';

const SAMPLE = `--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
 const c = 4;
`;

describe('stripAbPrefix', () => {
  test('strips a/ and b/ prefixes', () => {
    expect(stripAbPrefix('a/src/foo.ts')).toBe('src/foo.ts');
    expect(stripAbPrefix('b/src/foo.ts')).toBe('src/foo.ts');
  });
  test('maps /dev/null to null', () => {
    expect(stripAbPrefix('/dev/null')).toBeNull();
  });
  test('leaves prefix-less paths untouched', () => {
    expect(stripAbPrefix('tests/x.spec.ts')).toBe('tests/x.spec.ts');
  });
});

describe('parseUnifiedDiff', () => {
  test('parses a single-file, single-hunk diff', () => {
    const parsed = parseUnifiedDiff(SAMPLE);
    expect(parsed.files).toHaveLength(1);
    const f = parsed.files[0]!;
    expect(f.oldPath).toBe('a/src/foo.ts');
    expect(f.newPath).toBe('b/src/foo.ts');
    expect(f.hunks).toHaveLength(1);
    expect(f.hunks[0]!.oldStart).toBe(1);
    expect(f.hunks[0]!.lines).toHaveLength(4);
  });

  test('tolerates a diff --git preamble and multiple files', () => {
    const multi = `diff --git a/x.ts b/x.ts
--- a/x.ts
+++ b/x.ts
@@ -1 +1 @@
-a
+b
diff --git a/y.ts b/y.ts
--- a/y.ts
+++ b/y.ts
@@ -1 +1 @@
-c
+d
`;
    const parsed = parseUnifiedDiff(multi);
    expect(parsed.files.map((f) => f.newPath)).toEqual(['b/x.ts', 'b/y.ts']);
  });

  test('returns no files for non-diff text', () => {
    expect(parseUnifiedDiff('just some prose').files).toHaveLength(0);
  });
});

describe('validatePatch', () => {
  const fooContent = 'const a = 1;\nconst b = 2;\nconst c = 4;\n';

  test('applies cleanly when context matches at the stated position', () => {
    const res = validatePatch(SAMPLE, { 'src/foo.ts': fooContent });
    expect(res.status).toBe('applies');
    expect(res.filesChecked).toBe(1);
    expect(res.filesInPatch).toBe(1);
  });

  test('reports offset when the hunk matches at a shifted line', () => {
    const shifted = '// header\n// added line\n' + fooContent;
    const res = validatePatch(SAMPLE, { 'src/foo.ts': shifted });
    expect(res.status).toBe('applies-with-offset');
  });

  test('reports stale-file when context does not match', () => {
    const diverged = 'const a = 1;\nconst b = 999;\nconst c = 4;\n';
    const res = validatePatch(SAMPLE, { 'src/foo.ts': diverged });
    expect(res.status).toBe('stale-file');
    expect(res.errors.length).toBeGreaterThan(0);
  });

  test('is unchecked when we do not have the target file', () => {
    const res = validatePatch(SAMPLE, { 'src/other.ts': 'x' });
    expect(res.status).toBe('unchecked');
    expect(res.filesChecked).toBe(0);
  });

  test('is invalid for unparseable patch text', () => {
    const res = validatePatch('not a patch at all', { 'src/foo.ts': fooContent });
    expect(res.status).toBe('invalid');
  });

  test('is unchecked for a null/empty patch', () => {
    expect(validatePatch(null, {}).status).toBe('unchecked');
    expect(validatePatch('', {}).status).toBe('unchecked');
  });

  test('resolves via unambiguous suffix when the model drops a leading dir', () => {
    const patch = `--- a/foo.ts\n+++ b/foo.ts\n@@ -1,3 +1,3 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n const c = 4;\n`;
    const res = validatePatch(patch, { 'src/foo.ts': fooContent });
    expect(res.status).toBe('applies');
    expect(res.filesChecked).toBe(1);
  });

  test('handles a multi-file patch, flagging the stale one', () => {
    const patch = `--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-x\n+y\n--- a/b.ts\n+++ b/b.ts\n@@ -1 +1 @@\n-old\n+new\n`;
    const res = validatePatch(patch, { 'a.ts': 'x\n', 'b.ts': 'DIFFERENT\n' });
    expect(res.filesChecked).toBe(2);
    expect(res.status).toBe('stale-file');
  });
});

describe('storedPatchValidation', () => {
  const applies = { status: 'applies', filesChecked: 1, filesInPatch: 1, errors: [] };
  const stale = { status: 'stale-file', filesChecked: 1, filesInPatch: 1, errors: ['a.ts: did not apply'] };

  test("reads Piwi's diagnosis, which stores it at the top of the details", () => {
    expect(storedPatchValidation({ patchValidation: applies, suggestedFix: { patch: SAMPLE } })).toEqual(applies);
  });

  test("reads an agent's diagnosis, which stores it inside the suggested fix", () => {
    expect(storedPatchValidation({ suggestedFix: { patch: SAMPLE, patchValidation: stale } })).toEqual(stale);
  });

  test("prefers the suggested fix's when both are stored", () => {
    expect(storedPatchValidation({ patchValidation: applies, suggestedFix: { patchValidation: stale } })).toEqual(
      stale,
    );
  });

  test('skips a malformed value for the other place', () => {
    expect(storedPatchValidation({ patchValidation: applies, suggestedFix: { patchValidation: 'applies' } })).toEqual(
      applies,
    );
  });

  test('is null when nothing usable is stored', () => {
    expect(storedPatchValidation(null)).toBeNull();
    expect(storedPatchValidation('applies')).toBeNull();
    expect(storedPatchValidation({ suggestedFix: { patch: SAMPLE } })).toBeNull();
    expect(storedPatchValidation({ patchValidation: { status: 3 } })).toBeNull();
    expect(storedPatchValidation({ suggestedFix: null, patchValidation: null })).toBeNull();
  });
});

describe('patchInCode', () => {
  test("is true once every hunk's post-image is in its file", () => {
    expect(patchInCode(SAMPLE, { 'src/foo.ts': 'const a = 1;\nconst b = 3;\nconst c = 4;\n' })).toBe(true);
    expect(patchInCode(SAMPLE, { 'src/foo.ts': 'const a = 1;\nconst b = 2;\nconst c = 4;\n' })).toBe(false);
  });

  test('tells an applied addition from one that still dry-runs as applying', () => {
    // Context on one side only: the pre-image is still in the file once applied.
    const addImport = `--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1,2 +1,3 @@\n+import x from 'x';\n const a = 1;\n const b = 2;\n`;
    const applied = "import x from 'x';\nconst a = 1;\nconst b = 2;\n";
    expect(validatePatch(addImport, { 'src/foo.ts': applied }).status).toBe('applies-with-offset');
    expect(patchInCode(addImport, { 'src/foo.ts': applied })).toBe(true);
    expect(patchInCode(addImport, { 'src/foo.ts': 'const a = 1;\nconst b = 2;\n' })).toBe(false);
  });

  test('is false when a file is missing or the patch does not parse', () => {
    expect(patchInCode(SAMPLE, {})).toBe(false);
    expect(patchInCode('not a diff', { 'src/foo.ts': 'x' })).toBe(false);
    expect(patchInCode(null, {})).toBe(false);
  });
});

describe('the patch checked at a verified fix', () => {
  const check = (over: Partial<PatchValidationAtFix> = {}): PatchValidationAtFix => ({
    status: 'applies',
    filesChecked: 1,
    filesInPatch: 1,
    errors: [],
    inCode: false,
    runId: 62,
    commit: 'abc1234',
    ...over,
  });

  test('reads the check stored on the details', () => {
    expect(storedPatchValidationAtFix({ patchValidationAtFix: check() })).toEqual(check());
    expect(storedPatchValidationAtFix({ patchValidation: check() })).toBeNull();
    expect(storedPatchValidationAtFix({ patchValidationAtFix: { status: 'applies' } })).toBeNull();
    expect(storedPatchValidationAtFix(null)).toBeNull();
  });

  test('still applies only for the fix it was made for, its change not in the code', () => {
    expect(patchStillAppliesAtFix(check(), 62)).toBe(true);
    expect(patchStillAppliesAtFix(check({ status: 'applies-with-offset' }), 62)).toBe(true);
    expect(patchStillAppliesAtFix(check(), 70)).toBe(false);
    expect(patchStillAppliesAtFix(check(), null)).toBe(false);
    expect(patchStillAppliesAtFix(check({ inCode: true }), 62)).toBe(false);
    for (const status of ['stale-file', 'invalid', 'unchecked'] as const) {
      expect(patchStillAppliesAtFix(check({ status }), 62)).toBe(false);
    }
    expect(patchStillAppliesAtFix(null, 62)).toBe(false);
  });
});
