import { describe, expect, test } from 'vitest';
import { findLiveBisect } from '../../app/composables/useDesktopLocalRuns';

const firstBad = (sha: string) => ({ sha, subject: `commit ${sha}`, author: null, date: null });
const bisectRun = (clusterId: number | null, sha: string | null, projectId = '1') => ({
  kind: 'bisect' as const,
  projectId,
  bisect: { step: null, stepsEstimate: null, candidates: [], firstBad: sha ? firstBad(sha) : null },
  bisectTarget: { clusterId, repositoryUrl: null },
});

describe('the bisected commit a cluster page shows from a live bisect', () => {
  test('is the one bisected for this cluster, not another cluster of the same project', () => {
    // Newest first, as the runs store keeps them.
    const runs = [bisectRun(8, 'bbb222'), bisectRun(7, 'aaa111')];
    expect(findLiveBisect(runs, 1, 7)?.sha).toBe('aaa111');
    expect(findLiveBisect(runs, 1, 8)?.sha).toBe('bbb222');
    expect(findLiveBisect(runs, 1, 9)).toBeNull();
  });

  test('skips a bisect still running and a bisect of another project', () => {
    const runs = [bisectRun(7, null), bisectRun(7, 'ccc333', '2'), bisectRun(7, 'aaa111')];
    expect(findLiveBisect(runs, 1, 7)?.sha).toBe('aaa111');
  });

  test('a bisect started without a cluster matches only a page without one', () => {
    const runs = [bisectRun(null, 'ddd444')];
    expect(findLiveBisect(runs, 1, null)?.sha).toBe('ddd444');
    expect(findLiveBisect(runs, 1, 7)).toBeNull();
  });
});
