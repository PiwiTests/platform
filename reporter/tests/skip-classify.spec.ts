import { describe, it, expect } from 'vitest';
import { mergeAnnotations, classifyStatus } from '../src/internal/collect/skip-classify.js';

describe('mergeAnnotations', () => {
  it('merges test- and result-level annotations, deduped', () => {
    const merged = mergeAnnotations(
      { annotations: [{ type: 'skip', description: 'reason' }] },
      { annotations: [{ type: 'skip', description: 'reason' }, { type: 'tag', description: '@smoke' }] },
    );
    expect(merged).toEqual([
      { type: 'skip', description: 'reason' },
      { type: 'tag', description: '@smoke' },
    ]);
  });

  it('handles missing annotation arrays', () => {
    expect(mergeAnnotations({}, {})).toEqual([]);
    expect(mergeAnnotations({ annotations: [{ type: 'fixme' }] }, {})).toEqual([{ type: 'fixme' }]);
  });

  it('keeps entries with the same type but different descriptions', () => {
    const merged = mergeAnnotations(
      { annotations: [{ type: 'skip', description: 'a' }] },
      { annotations: [{ type: 'skip', description: 'b' }] },
    );
    expect(merged).toHaveLength(2);
  });
});

describe('classifyStatus', () => {
  it('passes non-skipped statuses through unchanged', () => {
    expect(classifyStatus('passed', [])).toBe('passed');
    expect(classifyStatus('failed', [])).toBe('failed');
    expect(classifyStatus('timedOut', [])).toBe('timedOut');
  });

  it('keeps an intentional skip (skip annotation) as skipped', () => {
    expect(classifyStatus('skipped', [{ type: 'skip', description: 'flaky on CI' }])).toBe('skipped');
    expect(classifyStatus('skipped', [{ type: 'skip' }])).toBe('skipped');
  });

  it('keeps a fixme as skipped', () => {
    expect(classifyStatus('skipped', [{ type: 'fixme', description: 'broken' }])).toBe('skipped');
  });

  it('reclassifies an annotation-less skip (serial cascade) as didnotrun', () => {
    expect(classifyStatus('skipped', [])).toBe('didnotrun');
    expect(classifyStatus('skipped', [{ type: 'tag', description: '@smoke' }])).toBe('didnotrun');
  });
});
