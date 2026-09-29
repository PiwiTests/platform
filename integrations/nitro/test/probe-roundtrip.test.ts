import { describe, it, expect } from 'vitest';
import { verifyProbeHeader } from '../src/probe';
// The reporter signs the header; the instrumentation verifies it. This pins the
// two independent implementations to one wire format.
import { buildProbeHeader } from '../../../packages/reporter/src/internal/probe/sign';

const SECRET = 'shared-probe-secret';

describe('reporter → instrumentation probe header round-trip', () => {
  it('a reporter-signed header verifies against the instrumentation verifier', () => {
    const now = Date.now();
    const header = buildProbeHeader(SECRET, { route: 'POST /api/orders', fault: 'status', nth: 2 }, now);
    const spec = verifyProbeHeader(header, SECRET, now);
    expect(spec).not.toBeNull();
    expect(spec).toMatchObject({ route: 'POST /api/orders', fault: 'status', nth: 2 });
  });

  it('a wrong secret is rejected', () => {
    const now = Date.now();
    const header = buildProbeHeader(SECRET, { fault: 'throw' }, now);
    expect(verifyProbeHeader(header, 'other-secret', now)).toBeNull();
  });

  it('an expired header is rejected', () => {
    const issued = Date.now() - 120_000;
    const header = buildProbeHeader(SECRET, { fault: 'throw' }, issued);
    expect(verifyProbeHeader(header, SECRET, Date.now())).toBeNull();
  });
});
