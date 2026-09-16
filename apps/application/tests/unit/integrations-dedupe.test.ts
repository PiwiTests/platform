import { describe, test, expect } from 'vitest';

process.env.PIWI_SECRET_KEY = 'unit-test-secret-key-not-for-production';
delete process.env.PIWI_DATABASE_URL;

const { dedupeCandidates } = await import('../../server/utils/integrations/draft');
import type { ExistingIssueCandidate } from '../../shared/integrations/types';

const c = (key: string, reason: ExistingIssueCandidate['reason']): ExistingIssueCandidate => ({
  key,
  url: `https://acme.atlassian.net/browse/${key}`,
  title: key,
  statusText: null,
  statusColor: null,
  reason,
});

describe('dedupeCandidates', () => {
  test('keeps the first (highest-priority) reason for a duplicate key', () => {
    const merged = dedupeCandidates([[c('PROJ-1', 'linked')], [c('PROJ-1', 'label')], [c('PROJ-2', 'fingerprint')]]);
    expect(merged.map((x) => [x.key, x.reason])).toEqual([
      ['PROJ-1', 'linked'],
      ['PROJ-2', 'fingerprint'],
    ]);
  });

  test('preserves priority order across lists', () => {
    const merged = dedupeCandidates([
      [], // linked
      [c('L-1', 'label')],
      [c('F-1', 'fingerprint')],
      [c('B-1', 'fixed-before')],
    ]);
    expect(merged.map((x) => x.key)).toEqual(['L-1', 'F-1', 'B-1']);
  });

  test('skips candidates without a key', () => {
    const merged = dedupeCandidates([[c('', 'linked'), c('PROJ-3', 'linked')]]);
    expect(merged.map((x) => x.key)).toEqual(['PROJ-3']);
  });
});
