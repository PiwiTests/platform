/**
 * Demo run simulator.
 *
 * Replays the exact streaming protocol a Piwi reporter speaks during a live
 * Playwright run (setup → begin → events → finish) against the in-browser
 * demo API, so visitors can watch a run arrive in real time: initialization
 * status, live test results across parallel workers, failure clustering,
 * flaky retries, performance data, and the final summary.
 *
 * Scenarios target the seeded `e2e-checkout` project so history-based
 * features (test case history, timing vs average, regression context,
 * recurring failure clusters) light up with the pre-seeded data.
 *
 * All calls go through `$fetch`, which demo-fetch.client.ts rewrites into the
 * service worker's scope — the same path a real reporter's HTTP calls take
 * through the real server.
 */

export const DEMO_SIMULATOR_INSTANCE_ID = 'demo-simulator';

/** Project from the demo seed (scripts/generate-demo-seed.mjs) */
const DEMO_PROJECT_NAME = 'e2e-checkout';

// ── Simulated data types ───────────────────────────────────────────────────

interface SimStep {
  title: string;
  duration: number;
  category: string;
}

interface SimAttempt {
  status: 'passed' | 'failed';
  /** Overrides the test duration for this attempt (e.g. a timeout) */
  duration?: number;
  error?: string;
  consoleLogs?: Array<Record<string, unknown>>;
  ariaSnapshot?: string;
  testAnnotations?: Array<{ type: string; description?: string }> | null;
}

interface SimTest {
  title: string;
  location: string;
  duration: number;
  /** Executed in order; the last attempt is the final result */
  attempts: SimAttempt[];
  steps: SimStep[];
  stepEvents?: Array<Record<string, unknown>> | null;
  slowestStep: string;
  slowestStepDuration: number;
  wastedTimeMs?: number | null;
  networkRequests: Array<Record<string, unknown>>;
  webVitals: Record<string, unknown>;
  browser?: Record<string, unknown> | null;
  suitePath?: string[];
  suiteConfig?: Array<{ mode: string; annotations: Array<{ type: string; description?: string }> }>;
}

export interface DemoScenario {
  id: string;
  label: string;
  description: string;
  icon: string;
  /** Time compression: virtual milliseconds elapse `speed`× faster on the wall clock */
  speed: number;
  workers: number;
  environment: string;
  /** Optional display label for the simulated test run */
  runLabel?: string;
  /** Interrupt the run after this many completed tests */
  stopAfter?: number;
  /** Enable sharding — tests are split across `shardCount` parallel shards */
  shardCount?: number;
  metadata: () => Record<string, unknown>;
  tests: () => SimTest[];
}

// ── Builders ───────────────────────────────────────────────────────────────

/** Random variation of ±pct around a base value */
function vary(base: number, pct = 0.15): number {
  return Math.round(base * (1 + (Math.random() * 2 - 1) * pct));
}

function randomCommitSha(): string {
  let sha = '';
  while (sha.length < 40) sha += Math.random().toString(16).slice(2);
  return sha.slice(0, 40);
}

/** Tests of the seeded e2e-checkout project, with realistic base durations */
const CHECKOUT_TESTS: Array<{ file: string; title: string; duration: number }> = [
  { file: 'tests/checkout/checkout.spec.ts', title: 'should complete checkout with credit card', duration: 6800 },
  { file: 'tests/checkout/checkout.spec.ts', title: 'should complete checkout with PayPal', duration: 7200 },
  { file: 'tests/checkout/checkout.spec.ts', title: 'should complete checkout with Apple Pay', duration: 5400 },
  { file: 'tests/checkout/checkout.spec.ts', title: 'should show error for expired card', duration: 3100 },
  { file: 'tests/checkout/checkout.spec.ts', title: 'should show error for invalid CVV', duration: 2900 },
  { file: 'tests/checkout/cart.spec.ts', title: 'should add item to cart', duration: 2400 },
  { file: 'tests/checkout/cart.spec.ts', title: 'should remove item from cart', duration: 2100 },
  { file: 'tests/checkout/cart.spec.ts', title: 'should update item quantity', duration: 2600 },
  { file: 'tests/checkout/cart.spec.ts', title: 'should apply discount code', duration: 3400 },
  { file: 'tests/checkout/cart.spec.ts', title: 'should display cart total correctly', duration: 1900 },
  { file: 'tests/checkout/address.spec.ts', title: 'should fill and save shipping address', duration: 4100 },
  { file: 'tests/checkout/address.spec.ts', title: 'should validate required address fields', duration: 2700 },
];

/** Suite map — mirrors SUITE_DEFS in generate-demo-seed.mjs for the e2e-checkout project */
const SUITE_MAP: Record<
  string,
  {
    suitePath: string[];
    suiteConfig: Array<{ mode: string; annotations: Array<{ type: string; description?: string }> }>;
  }
> = {
  'tests/checkout/checkout.spec.ts': {
    suitePath: ['Checkout'],
    suiteConfig: [{ mode: 'parallel', annotations: [] }],
  },
  'tests/checkout/cart.spec.ts': {
    suitePath: ['Cart'],
    suiteConfig: [{ mode: 'default', annotations: [] }],
  },
  'tests/checkout/address.spec.ts': {
    suitePath: ['Address'],
    suiteConfig: [{ mode: 'default', annotations: [] }],
  },
};

/** Browser configs for multi-browser scenarios */
const BROWSER_CONFIGS: Record<string, Record<string, unknown>> = {
  chromium: { projectName: 'Chromium', browserName: 'chromium', channel: null, viewport: { width: 1280, height: 720 } },
  firefox: { projectName: 'Firefox', browserName: 'firefox', channel: null, viewport: { width: 1280, height: 720 } },
  webkit: { projectName: 'WebKit', browserName: 'webkit', channel: null, viewport: { width: 1280, height: 720 } },
};

/**
 * Matches the seeded failure cluster of the e2e-checkout project
 * (see CLUSTER_DEFS in scripts/generate-demo-seed.mjs), so simulated
 * failures join the existing cluster and bump its occurrence history.
 */
const KNOWN_TIMEOUT_ERROR =
  'TimeoutError: locator.click: Timeout 30000ms exceeded.\n    at tests/checkout/checkout.spec.ts:42';

/** A new error signature — forms a brand-new failure cluster (shown as "New") */
const NEW_STRICT_MODE_ERROR =
  "Error: strict mode violation: getByTestId('place-order-button') resolved to 2 elements:\n" +
  '    1) <button data-testid="place-order-button" class="btn-primary">Place order</button>\n' +
  '    2) <button data-testid="place-order-button" class="btn-sticky-footer">Place order</button>\n' +
  '\n' +
  '    at tests/checkout/checkout.spec.ts:88:42';

/** A flaky assertion error — cart total read before the price recalculation settles */
const FLAKY_ASSERTION_ERROR =
  'Error: expect(locator).toHaveText(expected) failed\n' +
  '\n' +
  "Locator: getByTestId('cart-total')\n" +
  'Expected string: "$42.97"\n' +
  'Received string: "$0.00"\n' +
  'Timeout: 5000ms\n' +
  '\n' +
  '    at tests/checkout/cart.spec.ts:61:38';

const STRICT_MODE_ARIA_SNAPSHOT =
  '- heading "Checkout" [level=1]\n' +
  '- group "Payment details":\n' +
  '  - textbox "Card number"\n' +
  '  - textbox "Expiry date"\n' +
  '  - textbox "CVC"\n' +
  '- button "Place order"\n' +
  '- button "Place order"';

function buildSteps(duration: number, slowStepBias = false): SimStep[] {
  const fractions: Array<[string, number, string]> = slowStepBias
    ? [
        ['Navigate to checkout', 0.1, 'navigation'],
        ['Sign in and prepare cart', 0.08, 'setup'],
        ['Fill payment form', 0.12, 'action'],
        ['Submit order and wait for confirmation', 0.55, 'action'],
        ['Assert order summary', 0.15, 'assertion'],
      ]
    : [
        ['Navigate to checkout', 0.2, 'navigation'],
        ['Sign in and prepare cart', 0.12, 'setup'],
        ['Fill payment form', 0.25, 'action'],
        ['Submit order and wait for confirmation', 0.28, 'action'],
        ['Assert order summary', 0.15, 'assertion'],
      ];

  const steps = fractions.map(([title, fraction, category]) => ({
    title,
    duration: Math.round(duration * fraction),
    category,
  }));

  return steps;
}

const SERVER_LOGS_OK = [
  { timestamp: Date.now() - 5000, level: 'info', category: 'http', message: 'GET /api/cart — 200 OK (70ms)' },
  { timestamp: Date.now() - 4000, level: 'debug', category: 'cache', message: 'Cart cache HIT for session abc123' },
];

const SERVER_LOGS_ERROR = [
  {
    timestamp: Date.now() - 5000,
    level: 'error',
    category: 'http',
    message: 'POST /api/payments/authorize — 500 Internal Server Error',
    stack:
      'Error: payment provider timeout\n    at PaymentGateway.charge (services/payment.ts:85)\n    at POST /payments/authorize (routes/payments.ts:42)',
  },
  {
    timestamp: Date.now() - 4000,
    level: 'warn',
    category: 'payment',
    message: 'Payment provider response time exceeded 5000ms threshold',
  },
];

function buildNetworkRequests(opts: { slow?: boolean; paymentError?: boolean } = {}): Array<Record<string, unknown>> {
  return [
    {
      method: 'GET',
      url: 'https://shop.example.com/api/cart',
      status: 200,
      duration: vary(70),
      resourceType: 'fetch',
      serverLogs: SERVER_LOGS_OK,
    },
    {
      method: 'GET',
      url: 'https://shop.example.com/api/products/featured',
      status: 200,
      duration: vary(115),
      resourceType: 'fetch',
    },
    {
      method: 'GET',
      url: 'https://shop.example.com/api/shipping/options',
      status: 200,
      duration: vary(95),
      resourceType: 'fetch',
    },
    {
      method: 'POST',
      url: 'https://shop.example.com/api/orders',
      status: 201,
      duration: vary(opts.slow ? 2200 : 185),
      resourceType: 'fetch',
    },
    ...(opts.slow
      ? [
          {
            method: 'GET',
            url: 'https://shop.example.com/api/recommendations',
            status: 200,
            duration: vary(2900),
            resourceType: 'fetch',
          },
        ]
      : []),
    ...(opts.paymentError
      ? [
          {
            method: 'POST',
            url: 'https://shop.example.com/api/payments/authorize',
            status: 500,
            duration: vary(450),
            resourceType: 'fetch',
            serverLogs: SERVER_LOGS_ERROR,
          },
        ]
      : [
          {
            method: 'POST',
            url: 'https://shop.example.com/api/payments/authorize',
            status: 200,
            duration: vary(320),
            resourceType: 'fetch',
          },
        ]),
  ];
}

function buildWebVitals(slow = false): Record<string, unknown> {
  const factor = slow ? 2.4 : 1;
  return {
    navigation: {
      url: 'https://shop.example.com/checkout',
      ttfb: vary(110 * factor),
      domInteractive: vary(820 * factor),
      domContentLoaded: vary(1150 * factor),
      loadComplete: vary(1750 * factor),
    },
    paint: {
      firstPaint: vary(680 * factor),
      firstContentfulPaint: vary(890 * factor),
    },
  };
}

function errorConsoleLogs(error: string, startedAt: number): Array<Record<string, unknown>> {
  return [
    {
      type: 'warning',
      text: '[checkout] payment provider responded slowly, retrying once',
      timestamp: startedAt + 1200,
      location: 'https://shop.example.com/assets/checkout.js:142:18',
    },
    {
      type: 'error',
      text: error.split('\n')[0] ?? 'Unknown error',
      timestamp: startedAt + 2400,
      location: 'https://shop.example.com/assets/checkout.js:217:11',
    },
  ];
}

interface BaseTestOptions {
  durationFactor?: number;
  slowNetwork?: boolean;
  slowSteps?: boolean;
  waitHeavy?: boolean;
}

/**
 * Builds a realistic set of fine-grained step events for a test: before/after
 * hooks, fixture setup, framework-injected waits, and a single deliberate
 * waitForTimeout sleep that shows up as wasted time.
 */
function buildStepEvents(testDuration: number): Array<Record<string, unknown>> {
  const now = Date.now();
  let t = now;
  const events: Array<Record<string, unknown>> = [];

  const beforeHookDur = vary(130, 0.2);
  events.push({ title: 'Before Hooks', category: 'hook', startedAt: t, duration: beforeHookDur, status: 'passed', location: null });
  t += beforeHookDur;

  const contextDur = vary(75, 0.2);
  events.push({ title: 'fixture: context', category: 'fixture', startedAt: t, duration: contextDur, status: 'passed', location: null });
  t += contextDur;

  const pageDur = vary(55, 0.2);
  events.push({ title: 'fixture: page', category: 'fixture', startedAt: t, duration: pageDur, status: 'passed', location: null });
  t += pageDur;

  // Framework-injected navigation wait — not wasted
  const loadStateDur = vary(420, 0.25);
  events.push({ title: 'Wait for load state', category: 'wait', startedAt: t, duration: loadStateDur, status: 'passed', location: null });
  t += loadStateDur;

  // Explicit sleep added by the test author — counts as wasted
  const timeoutDur = vary(500, 0.2);
  events.push({
    title: 'Wait for timeout',
    category: 'wait',
    startedAt: t,
    duration: timeoutDur,
    status: 'wasted',
    location: 'tests/checkout/checkout.spec.ts:34:5',
  });
  t += timeoutDur;

  // Wait for selector — framework-injected, not wasted
  const selectorDur = vary(Math.round(testDuration * 0.08), 0.25);
  events.push({ title: 'Wait for selector', category: 'wait', startedAt: t, duration: selectorDur, status: 'passed', location: null });
  t += selectorDur;

  const afterHookDur = vary(90, 0.2);
  events.push({ title: 'After Hooks', category: 'hook', startedAt: t, duration: afterHookDur, status: 'passed', location: null });

  return events;
}

/**
 * Builds step events for a wait-heavy test: many explicit `waitForTimeout`
 * calls mixed with framework waits, producing a high wasted-time total.
 */
function buildWaitHeavyStepEvents(testDuration: number, file: string, line: number): Array<Record<string, unknown>> {
  const now = Date.now();
  let t = now;
  const events: Array<Record<string, unknown>> = [];

  const beforeHookDur = vary(140, 0.2);
  events.push({ title: 'Before Hooks', category: 'hook', startedAt: t, duration: beforeHookDur, status: 'passed', location: null });
  t += beforeHookDur;

  const contextDur = vary(80, 0.2);
  events.push({ title: 'fixture: context', category: 'fixture', startedAt: t, duration: contextDur, status: 'passed', location: null });
  t += contextDur;

  const pageDur = vary(60, 0.2);
  events.push({ title: 'fixture: page', category: 'fixture', startedAt: t, duration: pageDur, status: 'passed', location: null });
  t += pageDur;

  // Framework-injected load wait — not wasted
  const firstLoadDur = vary(380, 0.2);
  events.push({ title: 'Wait for load state', category: 'wait', startedAt: t, duration: firstLoadDur, status: 'passed', location: null });
  t += firstLoadDur;

  // Series of explicit sleeps scattered through the test — all wasted
  const sleeps = [
    vary(500, 0.1),
    vary(1000, 0.1),
    vary(500, 0.1),
    vary(2000, 0.1),
    vary(500, 0.1),
    vary(1000, 0.1),
  ];
  for (let i = 0; i < sleeps.length; i++) {
    events.push({
      title: 'Wait for timeout',
      category: 'wait',
      startedAt: t,
      duration: sleeps[i]!,
      status: 'wasted',
      location: `${file}:${line + i * 4}:5`,
    });
    t += sleeps[i]!;

    // Intersperse framework waits between the explicit sleeps
    if (i < sleeps.length - 1) {
      const fwDur = vary(250, 0.3);
      events.push({ title: 'Wait for load state', category: 'wait', startedAt: t, duration: fwDur, status: 'passed', location: null });
      t += fwDur;
    }
  }

  // Final navigation wait — not wasted
  const navDur = vary(340, 0.2);
  events.push({ title: 'Wait for response', category: 'wait', startedAt: t, duration: navDur, status: 'passed', location: null });
  t += navDur;

  const afterHookDur = vary(95, 0.2);
  events.push({ title: 'After Hooks', category: 'hook', startedAt: t, duration: afterHookDur, status: 'passed', location: null });

  return events;
}

function baseTests(opts: BaseTestOptions = {}): SimTest[] {
  return CHECKOUT_TESTS.map((t, i) => {
    const duration = vary(Math.round(t.duration * (opts.durationFactor ?? 1)), 0.12);
    const steps = buildSteps(duration, opts.slowSteps);
    const slowest = steps.reduce((a, b) => (a.duration > b.duration ? a : b));
    const suite = SUITE_MAP[t.file];
    const stepEvents = opts.waitHeavy
      ? buildWaitHeavyStepEvents(duration, t.file, 10 + i * 8)
      : buildStepEvents(duration);
    const wastedTimeMs = stepEvents
      .filter((e) => e.category === 'wait' && e.title === 'Wait for timeout')
      .reduce((sum, e) => sum + (e.duration as number), 0);

    return {
      title: t.title,
      location: `${t.file}:${10 + i * 8}:5`,
      duration,
      attempts: [{ status: 'passed' as const }],
      steps,
      stepEvents,
      slowestStep: slowest.title,
      slowestStepDuration: slowest.duration,
      wastedTimeMs: wastedTimeMs > 0 ? wastedTimeMs : null,
      networkRequests: buildNetworkRequests({ slow: opts.slowNetwork }),
      webVitals: buildWebVitals(opts.slowNetwork),
      suitePath: suite?.suitePath,
      suiteConfig: suite?.suiteConfig,
    };
  });
}

function buildMetadata(opts: {
  branch: string;
  author: string;
  commitMessage: string;
  relatedIssue?: string;
  customData?: Record<string, unknown>;
  ciInfo?: string | Record<string, string>;
}): Record<string, unknown> {
  const buildNumber = String(1340 + Math.floor(Math.random() * 60));
  return {
    ci: {
      provider: 'GitHub Actions',
      buildNumber,
      jobName: 'e2e-checkout',
      workflow: 'CI',
      buildUrl: `https://github.com/acme/shop/actions/runs/${buildNumber}`,
    },
    scm: {
      commit: randomCommitSha(),
      branch: opts.branch,
      author: opts.author,
      commitMessage: opts.commitMessage,
      remoteUrl: 'https://github.com/acme/shop.git',
    },
    htmlReport: {
      projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
    },
    ...(opts.relatedIssue ? { relatedIssue: opts.relatedIssue } : {}),
    ...(opts.customData ? { customData: opts.customData } : {}),
    ...(opts.ciInfo ? { ciInfo: opts.ciInfo } : {}),
  };
}

// ── Scenarios ──────────────────────────────────────────────────────────────

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: 'passing',
    label: 'Passing run',
    description: 'All 12 checkout tests pass across 4 parallel workers',
    icon: 'i-lucide-circle-check-big',
    speed: 1.5,
    workers: 4,
    environment: 'staging',
    runLabel: 'release-v2.3.1',
    metadata: () =>
      buildMetadata({
        branch: 'main',
        author: 'Alice Chen',
        commitMessage: 'feat: add gift wrapping option at checkout',
        customData: { deployId: 'deploy-2026-06-11.3', region: 'eu-west-1' },
      }),
    tests: () => baseTests(),
  },
  {
    id: 'failures',
    label: 'Run with failures',
    description: 'A recurring timeout cluster plus a brand-new failure',
    icon: 'i-lucide-circle-x',
    speed: 3,
    workers: 4,
    environment: 'production',
    metadata: () =>
      buildMetadata({
        branch: 'feature/payment-form-rework',
        author: 'Bob Smith',
        commitMessage: 'feat: rework payment form validation',
        relatedIssue: 'https://github.com/acme/shop/issues/421',
      }),
    tests: () => {
      const tests = baseTests();
      // Two tests hit the timeout cluster already known from previous runs
      for (const i of [0, 1]) {
        const failedDuration = vary(31200, 0.03);
        tests[i]!.attempts = [
          {
            status: 'failed',
            duration: failedDuration,
            error: KNOWN_TIMEOUT_ERROR,
            consoleLogs: errorConsoleLogs(KNOWN_TIMEOUT_ERROR, Date.now()),
            testAnnotations: [{ type: 'fixme', description: 'Known timeout issue — checkout page slow under load' }],
          },
        ];
        tests[i]!.networkRequests = buildNetworkRequests({ paymentError: true });
      }
      // One test fails with a new error signature — a brand-new cluster
      tests[2]!.attempts = [
        {
          status: 'failed',
          duration: vary(4800),
          error: NEW_STRICT_MODE_ERROR,
          consoleLogs: errorConsoleLogs(NEW_STRICT_MODE_ERROR, Date.now()),
          ariaSnapshot: STRICT_MODE_ARIA_SNAPSHOT,
          testAnnotations: [{ type: 'fixme', description: 'Duplicate test IDs — needs unique data-testid' }],
        },
      ];
      return tests;
    },
  },
  {
    id: 'flaky',
    label: 'Flaky retries',
    description: 'Two tests fail, then pass on retry — the run stays green',
    icon: 'i-lucide-repeat-2',
    speed: 1.5,
    workers: 4,
    environment: 'staging',
    metadata: () =>
      buildMetadata({
        branch: 'main',
        author: 'Carol White',
        commitMessage: 'chore: update dependencies',
      }),
    tests: () => {
      const tests = baseTests();
      for (const i of [8, 11]) {
        tests[i]!.attempts = [
          {
            status: 'failed',
            duration: vary(5600, 0.08),
            error: FLAKY_ASSERTION_ERROR,
            consoleLogs: errorConsoleLogs(FLAKY_ASSERTION_ERROR, Date.now()),
            testAnnotations: [{ type: 'slow' }],
          },
          { status: 'passed', duration: vary(2600), testAnnotations: [{ type: 'slow' }] },
        ];
      }
      return tests;
    },
  },
  {
    id: 'regression',
    label: 'Performance regression',
    description: 'Everything passes, but ~2× slower with degraded endpoints',
    icon: 'i-lucide-trending-down',
    speed: 3.5,
    workers: 4,
    environment: 'staging',
    metadata: () =>
      buildMetadata({
        branch: 'main',
        author: 'David Lee',
        commitMessage: 'perf: switch cart pricing to new rules engine',
      }),
    tests: () => baseTests({ durationFactor: 2.3, slowNetwork: true, slowSteps: true }),
  },
  {
    id: 'interrupted',
    label: 'Interrupted run',
    description: 'The CI job is killed partway through the suite',
    icon: 'i-lucide-octagon-x',
    speed: 1.5,
    workers: 4,
    environment: 'integration',
    stopAfter: 7,
    metadata: () =>
      buildMetadata({
        branch: 'develop',
        author: 'Eva Brown',
        commitMessage: 'ci: bump runner image to ubuntu-26.04',
      }),
    tests: () => baseTests(),
  },
  {
    id: 'cross-browser',
    label: 'Cross-browser run',
    description: 'Tests spread across Chromium, Firefox, and WebKit in parallel',
    icon: 'i-lucide-smartphone',
    speed: 2,
    workers: 3,
    environment: 'staging',
    metadata: () =>
      buildMetadata({
        branch: 'main',
        author: 'Alice Chen',
        commitMessage: 'feat: cross-browser checkout flow',
      }),
    tests: () => {
      const browserKeys = ['chromium', 'firefox', 'webkit'];
      return baseTests().map((t, i) => ({
        ...t,
        browser: BROWSER_CONFIGS[browserKeys[i % browserKeys.length]!],
      }));
    },
  },
  {
    id: 'sharded',
    label: 'Sharded run (2 shards)',
    description: 'Tests split across 2 parallel CI shards that merge into one run',
    icon: 'i-lucide-layers',
    speed: 2.5,
    workers: 3,
    shardCount: 2,
    environment: 'ci',
    metadata: () =>
      buildMetadata({
        branch: 'main',
        author: 'Fiona Mehta',
        commitMessage: 'feat: deploy pipeline v2',
        ciInfo: { provider: 'GitHub Actions', runId: '12345678', workflow: 'ci.yml' },
      }),
    tests: () => baseTests({ durationFactor: 0.8 }),
  },
  {
    id: 'wait-heavy',
    label: 'Wait-heavy run',
    description: 'Tests peppered with explicit waitForTimeout sleeps — wasted-time breakdown per test',
    icon: 'i-lucide-hourglass',
    speed: 4,
    workers: 4,
    environment: 'staging',
    metadata: () =>
      buildMetadata({
        branch: 'feature/checkout-refactor',
        author: 'George Tan',
        commitMessage: 'wip: add temporary waits while debugging flaky checkout',
      }),
    tests: () => baseTests({ waitHeavy: true }),
  },
];

// ── Simulation engine ──────────────────────────────────────────────────────

export interface SimulationHooks {
  /** Run row created (status 'initialising') — good time to navigate to it */
  onRunCreated?: (runId: number, projectId: number) => void;
  onProgress?: (completed: number, failed: number, total: number) => void;
  onFinished?: (runId: number, status: string) => void;
}

export interface SimulationController {
  /** Request the run to stop after in-flight tests complete (→ 'interrupted') */
  stopped: boolean;
}

const INIT_DELAY_MS = 1800;
const WORKER_GAP_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Drives one scenario through the reporter protocol. Resolves when the run
 * has finished (or was interrupted via the controller).
 */
/**
 * Run a sharded simulation: split the scenario's tests across `scenario.shardCount`
 * parallel shards that share the same runLabel, each with its own stream token.
 * The server merges them into a single run.
 */
async function runShardedSimulation(
  scenario: DemoScenario,
  hooks: SimulationHooks = {},
  ctl: SimulationController = { stopped: false },
): Promise<{ runId: number; status: string }> {
  const shardCount = scenario.shardCount ?? 2;
  const allTests = scenario.tests();
  const runLabel = `sim-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  // Split tests round-robin across shards
  const shardedTests = Array.from({ length: shardCount }, () => [] as SimTest[]);
  for (let i = 0; i < allTests.length; i++) {
    shardedTests[i % shardCount]!.push(allTests[i]!);
  }

  // Create shard-specific scenarios (override tests + workers per shard)
  const shardScenarios = shardedTests.map((tests) => {
    const { shardCount: _, ...rest } = scenario;
    return {
      ...rest,
      workers: Math.max(1, Math.ceil(scenario.workers / shardCount)),
      tests: () => tests,
    };
  });

  // Signal that the shared run is being created
  const sharedHooks: SimulationHooks = {
    ...hooks,
    onRunCreated: (runId, projectId) => {
      // Only fire once (first shard to call setup creates the run)
      if (!createdFired) {
        createdFired = true;
        hooks.onRunCreated?.(runId, projectId);
      }
    },
    onFinished: undefined, // we aggregate below
  };
  let createdFired = false;

  const results = await Promise.all(
    shardScenarios.map((s, i) =>
      runSingleSimulation(s as DemoScenario, sharedHooks, ctl, {
        shardIndex: i + 1,
        shardTotal: shardCount,
        runLabel,
        workerOffset: i * Math.max(1, Math.ceil(scenario.workers / shardCount)),
      }),
    ),
  );

  // Aggregate status: failed if any shard failed
  const anyFailed = results.some((r) => r.status === 'failed');
  const finalStatus = anyFailed ? 'failed' : 'passed';
  const runId = results.find((r) => r.runId)?.runId ?? 0;
  hooks.onFinished?.(runId, finalStatus);
  return { runId, status: finalStatus };
}

export async function runSimulation(
  scenario: DemoScenario,
  hooks: SimulationHooks = {},
  ctl: SimulationController = { stopped: false },
): Promise<{ runId: number; status: string }> {
  if (scenario.shardCount && scenario.shardCount > 1) {
    return runShardedSimulation(scenario, hooks, ctl);
  }

  return runSingleSimulation(scenario, hooks, ctl);
}

async function runSingleSimulation(
  scenario: DemoScenario,
  hooks: SimulationHooks = {},
  ctl: SimulationController = { stopped: false },
  shardOverride?: { shardIndex: number; shardTotal: number; runLabel: string; workerOffset?: number },
): Promise<{ runId: number; status: string }> {
  const tests = scenario.tests();
  const startTime = new Date();
  const runLabel = shardOverride?.runLabel;
  const instanceId = runLabel ? `${DEMO_SIMULATOR_INSTANCE_ID}|${runLabel}` : DEMO_SIMULATOR_INSTANCE_ID;

  const setup = await $fetch<{ runId: number; projectId: number; setupToken: string }>('/api/test-runs/setup', {
    method: 'POST',
    body: {
      projectName: DEMO_PROJECT_NAME,
      startTime: startTime.toISOString(),
      environment: scenario.environment,
      label: scenario.runLabel || null,
      instanceId,
      playwrightVersion: '1.51.0',
      shardIndex: shardOverride?.shardIndex,
      shardTotal: shardOverride?.shardTotal,
    },
  });
  const runId = setup.runId;
  hooks.onRunCreated?.(runId, setup.projectId);

  // Let the 'initialising' state be visible for a moment, like a real global setup
  await sleep(INIT_DELAY_MS / scenario.speed);

  const metadata = scenario.metadata();
  const begin = await $fetch<{ streamToken: string }>(`/api/test-runs/${runId}/begin`, {
    method: 'POST',
    body: {
      setupToken: setup.setupToken,
      totalTests: tests.length,
      metadata,
      playwrightVersion: '1.51.0',
      shardIndex: shardOverride?.shardIndex,
      shardTotal: shardOverride?.shardTotal,
    },
  });
  const streamToken = begin.streamToken;

  const virtualStart = startTime.getTime();
  const stopAfter = scenario.stopAfter ?? Infinity;
  const durations: number[] = [];
  let completed = 0;
  let failedCount = 0;
  let flakyCount = 0;
  let queueIndex = 0;
  let virtualEnd = virtualStart;

  async function postEvents(events: Array<Record<string, unknown>>): Promise<void> {
    await $fetch(`/api/test-runs/${runId}/events`, {
      method: 'POST',
      body: { streamToken, testCases: events },
    });
  }

  // Each simulated worker pulls tests from a shared queue, mirroring how
  // Playwright distributes tests across parallel workers. Timestamps and
  // durations are reported on a virtual clock so the persisted data stays
  // realistic even though events stream `speed`× faster.
  async function workerLoop(workerIndex: number): Promise<void> {
    let virtualNow = virtualStart + INIT_DELAY_MS;

    while (!ctl.stopped && completed < stopAfter) {
      const test = tests[queueIndex++];
      if (!test) return;

      let finalDuration = test.duration;

      for (let attempt = 0; attempt < test.attempts.length; attempt++) {
        const a = test.attempts[attempt]!;
        const attemptDuration = a.duration ?? test.duration;
        const startedAt = virtualNow;

        await postEvents([
          {
            type: 'begin',
            title: test.title,
            location: test.location,
            workerIndex,
            shardIndex: shardOverride?.shardIndex ?? null,
            startedAt,
            browser: test.browser ?? null,
            suitePath: test.suitePath ?? null,
            suiteConfig: test.suiteConfig ?? null,
          },
        ]);

        await sleep(attemptDuration / scenario.speed);
        virtualNow += attemptDuration;

        await postEvents([
          {
            type: 'complete',
            title: test.title,
            location: test.location,
            status: a.status,
            duration: attemptDuration,
            error: a.error ?? null,
            retries: attempt,
            steps: test.steps,
            stepEvents: test.stepEvents ?? null,
            slowestStep: test.slowestStep,
            slowestStepDuration: test.slowestStepDuration,
            wastedTimeMs: test.wastedTimeMs ?? null,
            networkRequests: test.networkRequests,
            webVitals: test.webVitals,
            consoleLogs: a.consoleLogs ?? null,
            ariaSnapshot: a.ariaSnapshot ?? null,
            browser: test.browser ?? null,
            workerIndex,
            shardIndex: shardOverride?.shardIndex ?? null,
            startedAt,
            suitePath: test.suitePath ?? null,
            suiteConfig: test.suiteConfig ?? null,
            testAnnotations: a.testAnnotations ?? null,
          },
        ]);

        virtualNow += WORKER_GAP_MS;
        finalDuration = attemptDuration;
      }

      const finalAttempt = test.attempts[test.attempts.length - 1]!;
      completed++;
      durations.push(finalDuration);
      if (finalAttempt.status === 'failed') {
        failedCount++;
      } else if (test.attempts.length > 1) {
        flakyCount++;
      }
      virtualEnd = Math.max(virtualEnd, virtualNow);
      hooks.onProgress?.(completed, failedCount, tests.length);
    }
  }

  await Promise.all(
    Array.from({ length: scenario.workers }, (_, i) => workerLoop(i + (shardOverride?.workerOffset ?? 0))),
  );

  const interrupted = ctl.stopped || completed < tests.length;
  const status = interrupted ? 'interrupted' : failedCount > 0 ? 'failed' : 'passed';

  await $fetch(`/api/test-runs/${runId}/finish`, {
    method: 'POST',
    body: {
      streamToken,
      status,
      duration: virtualEnd - virtualStart,
      totalTests: tests.length,
      passedTests: completed - failedCount,
      failedTests: failedCount,
      skippedTests: 0,
      // Tests that never ran because the run was cut short (interrupted/maxFailures).
      didNotRunTests: tests.length - completed,
      flakyTests: flakyCount,
      durations,
      metadata,
      playwrightVersion: '1.51.0',
      ...(shardOverride ? { shardIndex: shardOverride.shardIndex, shardTotal: shardOverride.shardTotal } : {}),
    },
  });

  hooks.onFinished?.(runId, status);
  return { runId, status };
}
