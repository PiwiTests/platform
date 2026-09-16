import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error — plain-Node script, no type declarations
import { copyDemoMedia, DEMO_MEDIA_SUBDIRS } from '../../scripts/copy-demo-media.mjs';

let root: string;
let publicDemoDir: string;
let storageDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'piwi-copy-demo-media-'));
  publicDemoDir = join(root, 'public', 'demo');
  storageDir = join(root, 'storage');
  for (const sub of DEMO_MEDIA_SUBDIRS) mkdirSync(join(publicDemoDir, sub), { recursive: true });
  writeFileSync(join(publicDemoDir, 'screenshots', 'shot.png'), 'png-bytes');
  writeFileSync(join(publicDemoDir, 'traces', 'trace.zip'), 'zip-bytes');
  writeFileSync(join(publicDemoDir, 'videos', 'clip.webm'), 'webm-bytes');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('copyDemoMedia', () => {
  test('copies every media file under demo/<sub> in the storage directory', () => {
    const copied = copyDemoMedia(publicDemoDir, storageDir);

    expect(copied).toBe(3);
    expect(readFileSync(join(storageDir, 'demo', 'screenshots', 'shot.png'), 'utf8')).toBe('png-bytes');
    expect(readFileSync(join(storageDir, 'demo', 'traces', 'trace.zip'), 'utf8')).toBe('zip-bytes');
    expect(readFileSync(join(storageDir, 'demo', 'videos', 'clip.webm'), 'utf8')).toBe('webm-bytes');
  });

  test('is idempotent — a second run copies nothing and leaves files untouched', () => {
    copyDemoMedia(publicDemoDir, storageDir);
    const dest = join(storageDir, 'demo', 'screenshots', 'shot.png');
    const firstMtime = statSync(dest).mtimeMs;

    const copiedAgain = copyDemoMedia(publicDemoDir, storageDir);

    expect(copiedAgain).toBe(0);
    expect(statSync(dest).mtimeMs).toBe(firstMtime);
  });

  test('re-copies a file whose destination size no longer matches the source', () => {
    copyDemoMedia(publicDemoDir, storageDir);
    const dest = join(storageDir, 'demo', 'screenshots', 'shot.png');
    writeFileSync(dest, 'x');

    const copied = copyDemoMedia(publicDemoDir, storageDir);

    expect(copied).toBe(1);
    expect(readFileSync(dest, 'utf8')).toBe('png-bytes');
  });

  test('copies nested subdirectories', () => {
    mkdirSync(join(publicDemoDir, 'traces', 'nested'), { recursive: true });
    writeFileSync(join(publicDemoDir, 'traces', 'nested', 'inner.zip'), 'inner');

    copyDemoMedia(publicDemoDir, storageDir);

    expect(readFileSync(join(storageDir, 'demo', 'traces', 'nested', 'inner.zip'), 'utf8')).toBe('inner');
  });

  test('skips a media subdirectory that does not exist in the source', () => {
    rmSync(join(publicDemoDir, 'videos'), { recursive: true, force: true });

    const copied = copyDemoMedia(publicDemoDir, storageDir);

    expect(copied).toBe(2);
    expect(existsSync(join(storageDir, 'demo', 'videos'))).toBe(false);
  });
});
