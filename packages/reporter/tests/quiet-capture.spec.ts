import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { boxCaptureFrames, internalCall } from '../src/internal/capture/quiet-capture.js';

describe('internalCall', () => {
  it('runs the read through the owner as an internal API call', async () => {
    const wrap = vi.fn(async (run: () => Promise<unknown>, _options: { internal: boolean }) => run());
    const owner = { _wrapApiCall: wrap };

    await expect(internalCall(owner, async () => 'read')).resolves.toBe('read');
    expect(wrap).toHaveBeenCalledTimes(1);
    expect(wrap.mock.calls[0]![1]).toMatchObject({ internal: true });
    // Called on the owner, as Playwright's own code calls it.
    expect(wrap.mock.contexts[0]).toBe(owner);
  });

  it('runs the read directly when the owner has no hook', async () => {
    await expect(internalCall({}, async () => 'read')).resolves.toBe('read');
    await expect(internalCall(null, async () => 'read')).resolves.toBe('read');
  });

  it('passes a failed read through unchanged', async () => {
    await expect(
      internalCall({ _wrapApiCall: (run: () => Promise<unknown>) => run() }, async () => {
        throw new Error('page closed');
      }),
    ).rejects.toThrow('page closed');
  });
});

describe('boxCaptureFrames', () => {
  // The same module and filter the test runner uses to hide its own frames.
  const requireFromPlaywright = createRequire(
    createRequire(require.resolve('@playwright/test/package.json')).resolve('playwright/package.json'),
  );
  const { filteredStackTrace } = requireFromPlaywright('playwright-core/lib/coreBundle').utils as {
    filteredStackTrace: (lines: string[]) => Array<{ file: string }>;
  };
  const packageRoot = path.resolve(__dirname, '..');
  const frame = (file: string) => `    at fn (${file}:10:5)`;

  it("drops this package's bundled frames and keeps the test's own", () => {
    boxCaptureFrames();
    const files = filteredStackTrace([
      frame(path.join(packageRoot, 'dist', 'index.js')),
      frame(path.join(packageRoot, 'tests', 'integration', 'capture.spec.ts')),
      frame('/work/app/tests/checkout.spec.ts'),
    ]).map((f) => f.file);

    expect(files).toEqual([
      path.join(packageRoot, 'tests', 'integration', 'capture.spec.ts'),
      '/work/app/tests/checkout.spec.ts',
    ]);
  });

  it('boxes a fixtures file the caller names, and only that file', () => {
    boxCaptureFrames(['/work/app/tests/fixtures.ts']);
    const files = filteredStackTrace([
      frame('/work/app/tests/fixtures.ts'),
      frame('/work/app/tests/checkout.spec.ts'),
      frame(path.join(packageRoot, 'dist', 'index.js')),
    ]).map((f) => f.file);
    expect(files).toEqual(['/work/app/tests/checkout.spec.ts']);
  });

  it("keeps Playwright's own package boxed", () => {
    boxCaptureFrames();
    const playwrightRoot = path.dirname(
      createRequire(require.resolve('@playwright/test/package.json')).resolve('playwright/package.json'),
    );
    const files = filteredStackTrace([
      frame(path.join(playwrightRoot, 'lib', 'index.js')),
      frame('/work/app/a.spec.ts'),
    ]).map((f) => f.file);
    expect(files).toEqual(['/work/app/a.spec.ts']);
  });
});
