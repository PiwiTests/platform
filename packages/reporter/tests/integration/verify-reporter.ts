import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

/**
 * Inspects the real `piwi-*` testInfo attachments produced by the capture
 * fixtures (`piwiFixtures`) at the end of each test and fails the whole
 * `playwright test` run on a mismatch. This is the integration-level
 * counterpart to the unit tests in `tests/capture-fixtures.spec.ts` and
 * `tests/locator-healing.spec.ts` — it exercises the real Proxy-wrapped
 * locator, network, console, web-vitals, and failure-time (ARIA snapshot +
 * locator suggestion) capture end to end against a live browser, which those
 * (necessarily mocked) unit tests cannot.
 *
 * Test roles are keyed off `test.expectedStatus`/title:
 *   - `expectedStatus === 'failed'` → the failure-capture test (ARIA + suggestion);
 *   - title starting `teardown race guard` → the teardown-race stress runs;
 *   - title starting `assertion-only` → the assertion-capture test (`_expect`);
 *   - title starting `seeded probe` → the in-page probe install (asserts in the test itself);
 *   - otherwise → the main capture test (locators + network + console + web vitals).
 */
export default class VerifyCaptureReporter implements Reporter {
  private failures: string[] = [];
  private sawMainCapture = false;
  private sawFailureCapture = false;
  private sawAssertionCapture = false;
  private sawSeededProbe = false;
  private stressRuns = 0;

  onTestEnd(test: TestCase, result: TestResult): void {
    const byName = (name: string) => result.attachments.find((a) => a.name === name);
    const assert = (cond: boolean, msg: string) => {
      if (!cond) this.fail(`[${test.title}] ${msg}`);
    };

    // ── Failure-only capture: ARIA snapshot + fresh locator suggestion ──────
    // These are produced only when a test actually fails, so this one is marked
    // test.fail() and its "failed" status is the expected outcome.
    if (test.expectedStatus === 'failed') {
      assert(result.status === 'failed', `expected an actual failure to drive failure capture, got ${result.status}`);

      assert(!!byName('piwi-aria-snapshot'), 'expected a piwi-aria-snapshot attachment on the failing test');

      const suggestion = byName('piwi-locator-suggestion');
      assert(!!suggestion, 'expected a piwi-locator-suggestion attachment on the failing test');
      if (suggestion?.body) {
        const parsed = JSON.parse(suggestion.body.toString('utf8')) as { failing?: string; suggestions?: string[] };
        assert(
          Array.isArray(parsed.suggestions) && parsed.suggestions.length > 0,
          'suggestion should list at least one replacement locator',
        );
      }
      this.sawFailureCapture = true;
      return;
    }

    // Every non-failing test must pass — a teardown-race regression surfaces as
    // a spurious "not bound in the connection" failure here.
    if (result.status !== 'passed') {
      this.fail(`[${test.title}] expected to pass, got ${result.status}`);
      return;
    }

    // Every passing test drives a locator action, so all must attach locators.
    assert(!!byName('piwi-locators'), 'expected a piwi-locators attachment');

    // ── Teardown-race stress runs: passing (checked above) is the whole point ─
    if (test.title.startsWith('teardown race guard')) {
      this.stressRuns += 1;
      return;
    }

    // ── Seeded probe: the check is the test's own expect(); passing is it ────
    if (test.title.startsWith('seeded probe')) {
      this.sawSeededProbe = true;
      return;
    }

    // ── Assertion-only capture: a passing expect() must record the element ───
    if (test.title.startsWith('assertion-only')) {
      const locators = byName('piwi-locators');
      if (locators?.body) {
        const snapshots = JSON.parse(locators.body.toString('utf8')) as Array<{
          location: string;
          used: { method: string; args: unknown[] };
          element: { tagName: string; attributes: Record<string, unknown> } | null;
          alternatives: unknown[];
        }>;
        const email = snapshots.find((s) => s.element?.attributes?.['id'] === 'email');
        assert(!!email, 'expected an element-bearing snapshot for the asserted (never acted-on) Email field');
        assert(email?.used.method === 'getByLabel', 'assertion snapshot should keep the locator the test used');
        assert(email?.element?.tagName === 'input', 'assertion-captured element should record its tag name');
        assert(
          Array.isArray(email?.alternatives) && email!.alternatives.length > 0,
          'assertion-captured element should have generated locator alternatives',
        );
        assert(
          typeof email?.location === 'string' && email.location.includes('capture.spec.ts'),
          'assertion snapshot should record the expect() call site',
        );
        assert(
          !snapshots.some((s) => JSON.stringify(s.used).includes('Nonexistent')),
          'a passing negated assertion must not capture its target',
        );
      }
      this.sawAssertionCapture = true;
      return;
    }

    // ── Main capture test: assert the full passing-path attachment set ───────
    const locators = byName('piwi-locators');
    if (locators?.body) {
      const snapshots = JSON.parse(locators.body.toString('utf8')) as Array<{
        location: string;
        element: { tagName: string; attributes: Record<string, unknown> } | null;
        alternatives: unknown[];
      }>;
      assert(Array.isArray(snapshots) && snapshots.length > 0, 'piwi-locators body should be a non-empty array');
      const saveBtn = snapshots.find((s) => s.element?.attributes?.['data-testid'] === 'save-btn');
      assert(!!saveBtn, 'expected a captured snapshot for the save-btn locator');
      assert(saveBtn?.element?.tagName === 'button', 'captured element should record its tag name');
      // The exact spec file, not just any location — the bundled dist's own
      // frames must never be mistaken for the call site (self-file skip).
      assert(
        typeof saveBtn?.location === 'string' && saveBtn.location.includes('capture.spec.ts'),
        'snapshot should record the action call site in the spec file',
      );
      assert(
        Array.isArray(saveBtn?.alternatives) && saveBtn!.alternatives.length > 0,
        'captured element should have generated locator alternatives',
      );
    }

    const network = byName('piwi-network');
    assert(!!network, 'expected a piwi-network attachment');
    if (network?.body) {
      const requests = JSON.parse(network.body.toString('utf8')) as Array<{
        url: string;
        method: string;
        status: number;
      }>;
      const ping = requests.find((r) => r.url.includes('/api/ping'));
      assert(!!ping, 'expected a captured network request for /api/ping');
      assert(ping?.method === 'GET', 'captured request should record its method');
      assert(ping?.status === 200, 'captured request should record its response status');
    }

    const console_ = byName('piwi-console');
    assert(!!console_, 'expected a piwi-console attachment');
    if (console_?.body) {
      const entries = JSON.parse(console_.body.toString('utf8')) as Array<{ type: string; text: string }>;
      const errorEntry = entries.find((e) => e.type === 'error' && e.text.includes('integration-test-console-error'));
      assert(!!errorEntry, 'expected a captured console.error entry');
    }

    const vitals = byName('piwi-web-vitals');
    assert(!!vitals, 'expected a piwi-web-vitals attachment');
    if (vitals?.body) {
      const wv = JSON.parse(vitals.body.toString('utf8')) as {
        navigation: unknown | null;
        paint: Record<string, number>;
      };
      assert(
        wv.navigation !== null || Object.keys(wv.paint ?? {}).length > 0,
        'web vitals should record navigation timing or paint entries',
      );
    }

    this.sawMainCapture = true;
  }

  async onEnd(_result: FullResult): Promise<{ status: 'failed' } | void> {
    if (!this.sawMainCapture) this.fail('the main capture test did not run — nothing verified its attachments');
    if (!this.sawFailureCapture) this.fail('the failure-capture test did not run — ARIA/suggestion unverified');
    if (!this.sawAssertionCapture) this.fail('the assertion-capture test did not run — _expect capture unverified');
    if (!this.sawSeededProbe) this.fail('the seeded-probe test did not run — the in-page probe install is unverified');
    if (this.stressRuns < 1) this.fail('the teardown-race stress tests did not run');

    if (this.failures.length > 0) {
      console.error(`\n[verify-reporter] ${this.failures.length} check(s) FAILED:`);
      for (const f of this.failures) console.error(`  ✗ ${f}`);
      // Return a failing status so the run exits non-zero even though the
      // intentionally-failing test's outcome is "expected".
      return { status: 'failed' };
    }
    console.log(`\n[verify-reporter] all capture-fixtures integration checks passed (${this.stressRuns} stress runs).`);
  }

  private fail(msg: string): void {
    this.failures.push(msg);
  }
}
