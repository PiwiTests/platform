import { describe, it, expect } from 'vitest';
import { verifyProbeHeader, signProbeMessage, ProbeNonceCache, PROBE_TTL_MS, type PiwiProbeSpec } from '../src/probe';

const SECRET = 'shared-probe-secret';

/** Build a signed `X-Piwi-Probe` header value the way a probe run would. */
function signHeader(spec: PiwiProbeSpec, opts: { secret?: string; ts?: number; nonce?: string } = {}): string {
  const secret = opts.secret ?? SECRET;
  const ts = opts.ts ?? Date.now();
  const nonce = opts.nonce ?? 'abc123';
  const specJson = JSON.stringify(spec);
  const sig = signProbeMessage(secret, nonce, ts, specJson);
  return Buffer.from(JSON.stringify({ nonce, ts, specJson, sig })).toString('base64');
}

describe('verifyProbeHeader', () => {
  const spec: PiwiProbeSpec = { route: 'POST /api/orders', fault: 'status-500', nth: 1 };
  const now = 1_700_000_000_000;

  it('accepts a correctly signed, in-TTL header', () => {
    const header = signHeader(spec, { ts: now });
    expect(verifyProbeHeader(header, SECRET, now)).toEqual(spec);
  });

  it('rejects when no secret is configured', () => {
    const header = signHeader(spec, { ts: now });
    expect(verifyProbeHeader(header, undefined, now)).toBeNull();
  });

  it('rejects a header signed with a different secret', () => {
    const header = signHeader(spec, { ts: now, secret: 'other-secret' });
    expect(verifyProbeHeader(header, SECRET, now)).toBeNull();
  });

  it('rejects a tampered spec', () => {
    const header = signHeader(spec, { ts: now });
    const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
    decoded.specJson = JSON.stringify({ ...spec, fault: 'throw' });
    const tampered = Buffer.from(JSON.stringify(decoded)).toString('base64');
    expect(verifyProbeHeader(tampered, SECRET, now)).toBeNull();
  });

  it('rejects an expired header', () => {
    const header = signHeader(spec, { ts: now - PROBE_TTL_MS - 1 });
    expect(verifyProbeHeader(header, SECRET, now)).toBeNull();
  });

  it('rejects a clock-skewed future header', () => {
    const header = signHeader(spec, { ts: now + PROBE_TTL_MS + 1 });
    expect(verifyProbeHeader(header, SECRET, now)).toBeNull();
  });

  it('returns null for a missing or garbage header', () => {
    expect(verifyProbeHeader(undefined, SECRET, now)).toBeNull();
    expect(verifyProbeHeader('not-base64-json', SECRET, now)).toBeNull();
  });

  it('takes the first value of a repeated header', () => {
    const header = signHeader(spec, { ts: now });
    expect(verifyProbeHeader([header, 'ignored'], SECRET, now)).toEqual(spec);
  });

  it('rejects a replay of a nonce already honored within the TTL', () => {
    const seen = new ProbeNonceCache();
    const header = signHeader(spec, { ts: now, nonce: 'once' });
    expect(verifyProbeHeader(header, SECRET, now, PROBE_TTL_MS, seen)).toEqual(spec);
    // Same signed header again: the single-use nonce is rejected.
    expect(verifyProbeHeader(header, SECRET, now, PROBE_TTL_MS, seen)).toBeNull();
    // A fresh nonce still verifies.
    const other = signHeader(spec, { ts: now, nonce: 'twice' });
    expect(verifyProbeHeader(other, SECRET, now, PROBE_TTL_MS, seen)).toEqual(spec);
  });
});

describe('ProbeNonceCache', () => {
  it('accepts a nonce once, then rejects it until the TTL lapses', () => {
    const cache = new ProbeNonceCache(1000);
    expect(cache.use('n1', 0)).toBe(true);
    expect(cache.use('n1', 500)).toBe(false);
    // Past the TTL the entry is pruned, so the nonce is accepted again.
    expect(cache.use('n1', 2000)).toBe(true);
  });
});
