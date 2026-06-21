import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { MetadataCollector } from '../src/metadata-collector.js';

/** Build a fake describe suite chain: root → parent → child (the test's parent). */
function fakeSuiteChain(opts: { parallelMode?: string; annotations?: any[]; titles?: string[] } = {}): any {
  const titles = opts.titles ?? ['Outer', 'Inner'];
  const make = (title: string, parent: any, mode?: string, annotations?: any[]): any => ({
    type: 'describe',
    title,
    parent,
    _parallelMode: mode,
    _annotations: annotations,
  });
  const root = make('', undefined, undefined, undefined);
  root.type = 'project'; // root is not a describe
  let current = root;
  const outer = make(titles[0], current, opts.parallelMode ?? 'serial', opts.annotations);
  current = outer;
  const inner = make(titles[1] ?? '', current, 'parallel', []);
  return { root, outer, inner };
}

describe('MetadataCollector.getSuiteInfo', () => {
  it('walks the describe chain collecting titles and per-level config', () => {
    const mc = new MetadataCollector();
    const { inner } = fakeSuiteChain({
      parallelMode: 'serial',
      annotations: [{ type: 'skip', description: 'flaky' }],
      titles: ['Outer', 'Inner'],
    });
    const test = { parent: inner } as any;
    const info = mc.getSuiteInfo(test);
    assert.deepEqual(info.suitePath, ['Outer', 'Inner']);
    assert.equal(info.suiteConfig.length, 2);
    assert.equal(info.suiteConfig[0].mode, 'serial');
    assert.deepEqual(info.suiteConfig[0].annotations, [{ type: 'skip', description: 'flaky' }]);
    assert.equal(info.suiteConfig[1].mode, 'parallel');
  });

  it('defaults unknown mode to "default"', () => {
    const mc = new MetadataCollector();
    const { outer } = fakeSuiteChain({ parallelMode: undefined, titles: ['Solo'] });
    const inner = { type: 'describe', title: 'Inner', parent: outer, _parallelMode: undefined, _annotations: [] };
    const test = { parent: inner } as any;
    const info = mc.getSuiteInfo(test);
    assert.equal(info.suiteConfig[info.suiteConfig.length - 1].mode, 'default');
  });

  it('skips suites with empty titles', () => {
    const mc = new MetadataCollector();
    const root = { type: 'project', title: '', parent: undefined };
    const empty = { type: 'describe', title: '', parent: root, _parallelMode: 'parallel', _annotations: [] };
    const named = { type: 'describe', title: 'Named', parent: empty, _parallelMode: 'serial', _annotations: [] };
    const test = { parent: named } as any;
    const info = mc.getSuiteInfo(test);
    assert.deepEqual(info.suitePath, ['Named']);
  });

  it('returns empty arrays when the test has no describe parents', () => {
    const mc = new MetadataCollector();
    const root = { type: 'project', title: '', parent: undefined };
    const test = { parent: root } as any;
    const info = mc.getSuiteInfo(test);
    assert.deepEqual(info.suitePath, []);
    assert.deepEqual(info.suiteConfig, []);
  });
});

describe('MetadataCollector.getBrowserConfig', () => {
  it('walks up to find a project() and returns a browser config', () => {
    const mc = new MetadataCollector();
    const project = { name: 'chromium', use: { browserName: 'chromium', viewport: { width: 1280, height: 720 } } };
    const suite = { parent: { project: () => project } };
    const test = { parent: suite } as any;
    const cfg = mc.getBrowserConfig(test);
    assert.equal(cfg?.projectName, 'chromium');
    assert.equal(cfg?.browserName, 'chromium');
    assert.deepEqual(cfg?.viewport, { width: 1280, height: 720 });
  });

  it('returns null when no project() is found within the depth limit', () => {
    const mc = new MetadataCollector();
    const test = { parent: { parent: { parent: undefined } } } as any;
    assert.equal(mc.getBrowserConfig(test), null);
  });
});
