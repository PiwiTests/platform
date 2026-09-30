import { describe, test, expect } from 'vitest';

delete process.env.PIWI_DATABASE_URL;
const { shardTokenDigest, matchesShardToken, readShardTokensFromMeta } =
  await import('../../server/utils/shard-tokens');
const { runEventBus } = await import('../../server/utils/run-events');

describe('shard tokens are kept as digests', () => {
  test('a stored digest matches its token, and only its token', () => {
    const stored = new Set([shardTokenDigest('shard-token-a')]);
    expect(matchesShardToken(stored, 'shard-token-a')).toBe(true);
    expect(matchesShardToken(stored, 'shard-token-b')).toBe(false);
    // Reading the stored value back does not give a usable token.
    expect(matchesShardToken(stored, shardTokenDigest('shard-token-a'))).toBe(false);
  });

  test('a plain entry stored by an older build still matches', () => {
    const stored = readShardTokensFromMeta({ shardTokens: ['legacy-token'] });
    expect(matchesShardToken(stored, 'legacy-token')).toBe(true);
  });

  test('the in-memory run state holds digests', () => {
    runEventBus.cacheRunState(9001, { streamToken: 'primary', projectId: 1, shardTokens: new Set() });
    runEventBus.addShardToken(9001, 'shard-token-a');
    expect(runEventBus.getRunState(9001)?.shardTokens?.has('shard-token-a')).toBe(false);
    expect(runEventBus.isValidShardToken(9001, 'shard-token-a')).toBe(true);
    runEventBus.removeShardToken(9001, 'shard-token-a');
    expect(runEventBus.isValidShardToken(9001, 'shard-token-a')).toBe(false);
    runEventBus.clearRunState(9001);
  });
});
