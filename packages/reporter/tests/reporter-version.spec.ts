import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getReporterVersion, findOwnPackageJson } from '../src/internal/support/reporter-version.js';

describe('getReporterVersion', () => {
  it("returns the reporter package's own version", () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));
    expect(getReporterVersion()).toBe(pkg.version);
  });

  it('is stable across repeated calls (memoized)', () => {
    expect(getReporterVersion()).toBe(getReporterVersion());
  });
});

describe('findOwnPackageJson', () => {
  function makeFakePackageRoot(version: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'piwi-reporter-version-'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@piwitests/reporter', version }));
    return dir;
  }

  it('resolves one level up — the published, bundled dist/index.js layout', () => {
    const pkgRoot = makeFakePackageRoot('9.9.9');
    const distDir = path.join(pkgRoot, 'dist');
    fs.mkdirSync(distDir);
    expect(findOwnPackageJson(distDir)?.version).toBe('9.9.9');
    expect(findOwnPackageJson(distDir)?.root).toBe(pkgRoot);
  });

  it('resolves three levels up — the unbundled src/internal/support layout', () => {
    const pkgRoot = makeFakePackageRoot('9.9.9');
    const srcDir = path.join(pkgRoot, 'src', 'internal', 'support');
    fs.mkdirSync(srcDir, { recursive: true });
    expect(findOwnPackageJson(srcDir)?.version).toBe('9.9.9');
  });

  it('ignores a package.json that is not @piwitests/reporter', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'piwi-reporter-version-'));
    const distDir = path.join(dir, 'dist');
    fs.mkdirSync(distDir);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'not-piwi', version: '1.0.0' }));
    expect(findOwnPackageJson(distDir)).toBeUndefined();
  });
});
