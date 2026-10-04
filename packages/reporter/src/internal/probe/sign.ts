/**
 * Sign the `X-Piwi-Probe` header for a server probe (Test Map, level two). The
 * reporter picks the fault; the instrumentation verifies the signature with the
 * shared `PIWI_PROBE_SECRET` and applies the fault to that one request. The
 * envelope and HMAC scheme match the instrumentation packages'
 * `verifyProbeHeader` exactly (`${nonce}.${ts}.${specJson}` over HMAC-SHA256).
 */

import { createHmac, randomBytes } from 'node:crypto';

/** A server fault instruction sent with one request. */
export interface ServerProbeSpec {
  /** Route key `METHOD /pattern` the fault targets. */
  route?: string;
  /** The server fault class to apply. */
  fault: string;
  /** Apply to the Nth matching request (1-based). */
  nth?: number;
  /** Dependency name a dependency fault targets. */
  dependency?: string;
}

/** The HMAC-SHA256 signature over the canonical message, hex-encoded. */
export function signProbeMessage(secret: string, nonce: string, ts: number, specJson: string): string {
  return createHmac('sha256', secret).update(`${nonce}.${ts}.${specJson}`).digest('hex');
}

/**
 * Build the base64 `X-Piwi-Probe` header value for a spec, signed with the shared
 * secret. Each call uses a fresh nonce and the current timestamp, so the header
 * is single-use and short-lived (the instrumentation enforces a 60s TTL).
 *
 * Single-use is enforced by a per-process nonce cache in the instrumentation, so
 * the replay guard is exact only against one server instance: a header replayed
 * to a different instance (behind a load balancer) or after a restart is bounded
 * only by the signature and the TTL. Probe runs target a single instance, so
 * this is not a concern in practice.
 */
export function buildProbeHeader(secret: string, spec: ServerProbeSpec, now: number = Date.now()): string {
  const nonce = randomBytes(8).toString('hex');
  const specJson = JSON.stringify(spec);
  const sig = signProbeMessage(secret, nonce, now, specJson);
  return Buffer.from(JSON.stringify({ nonce, ts: now, specJson, sig }), 'utf8').toString('base64');
}
