import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { chromiumManifest } from '../../scripts/build.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));

describe('the manifests the build writes', () => {
  it('keeps Firefox’s background script in the source manifest, which AMO requires', () => {
    expect(manifest.background).toEqual({ service_worker: 'background.js', scripts: ['background.js'] });
  });

  it('leaves it out for Chrome and Edge, and changes nothing else', () => {
    const chromium = chromiumManifest(manifest);
    expect(chromium.background).toEqual({ service_worker: 'background.js' });
    expect({ ...chromium, background: manifest.background }).toEqual(manifest);
  });
});
