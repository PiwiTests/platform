/**
 * Client-side implementations of AI-related endpoints for demo mode.
 *
 * The demo has no real AI provider. Two clusters (1 and 3) have pre-seeded
 * diagnoses in the demo database so the UI can show the completed diagnosis card.
 * All other clusters return null diagnosis, and the configure/test endpoints
 * return no-op or error responses.
 *
 * The streaming diagnosis endpoint (`/diagnose/stream`) simulates real-time
 * thinking tokens with delays and returns a canned final result, so users can
 * see the live-thinking UI in the demo without a real AI provider.
 */

import { eq } from 'drizzle-orm';
import { failureDiagnoses } from '../../../server/database/schema';
import { getDemoDb } from '../db.client';
import { CONTEXT_LIMIT_FIELDS, DEFAULT_CONTEXT_LIMITS } from '#shared/ai-context-limits';

/** GET /api/ai/status */
export async function apiGetAiStatus() {
  return { configured: true, provider: 'demo', model: 'demo', autoDiagnose: false, source: 'demo' };
}

/** POST /api/failure-clusters/:id/diagnose — not supported in demo */
export async function apiDiagnoseCluster(_clusterId: number) {
  throw new Error('AI diagnosis not available in demo mode');
}

/**
 * Fake thinking chunks that simulate what an LLM might generate when analysing
 * a Playwright test failure. Each chunk is a short fragment of reasoning.
 */
const FAKE_THINKING_CHUNKS = [
  'Let me analyze this failure cluster step by step.\n\n',
  'Looking at the error signature, this appears to be a **locator timeout** — the test is trying to interact with an element that is present in the DOM but not yet interactive.\n\n',
  'The element in question is a button with role "button" and name "Submit". The test calls `click()` without an explicit wait for the element to become enabled.\n\n',
  'Checking the test source code, I can see that no `waitForLoadState` or `waitFor` call precedes the click action. This means the test is racing against the page render.\n\n',
  'Cross-referencing the run context: 3 out of 12 runs (25%) failed with this exact error. The failure rate correlates with high-load CI runs, suggesting infrastructure variability amplifies the race condition.\n\n',
  'Looking at the retry progression: when the test retries, it passes 60% of the time. This intermittent pass rate further confirms a timing-related root cause rather than a deterministic code bug.\n\n',
  'The SCM diff shows recent changes to the checkout form component — a new payment provider integration was added three commits ago. The form now fetches an external script that delays rendering.\n\n',
  'I have enough evidence to form a conclusion. The primary hypothesis is an infrastructure-related timing issue: the page renders slowly on CI, the click times out, and the test lacks a defensive wait. The secondary hypothesis is a test bug where the locator could be scoped more precisely.\n\n',
  'Generating structured diagnosis report...\n\n',
];

/**
 * POST /api/failure-clusters/:id/diagnose/stream
 *
 * Returns a simulated SSE stream with realistic thinking tokens, then a final
 * structured result. The first time a cluster is diagnosed in demo mode, the
 * result is persisted to the demo DB so subsequent GET /diagnosis returns it.
 */
export async function apiStreamDiagnoseCluster(_clusterId: number, _body?: Record<string, unknown>): Promise<Response> {
  const clusterId = _clusterId;

  // If there's already a completed diagnosis in the DB, return it immediately
  const db = await getDemoDb();
  const existing = await db.select().from(failureDiagnoses).where(eq(failureDiagnoses.clusterId, clusterId)).limit(1);

  if (existing[0]?.status === 'completed') {
    const encoder = new TextEncoder();
    const data = JSON.stringify(existing[0]);
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`event: result\ndata: ${data}\n\n`));
          controller.close();
        },
      }),
      {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      },
    );
  }

  // Simulated diagnosis result that matches the demo seed data shape
  const diagnosisResult = {
    id: Date.now(),
    clusterId,
    status: 'completed',
    provider: 'demo',
    model: 'demo-simulated',
    category: 'app-bug',
    confidence: 'high',
    summary:
      'Button click times out due to a missing explicit wait for the element to become interactive — consistent with CI infrastructure variability amplifying the race condition.',
    rootCause:
      'The locator.click timeout (30000ms) is exceeded when the page renders slowly on the CI runner. The root cause is a missing explicit wait for the target element, combined with CI infrastructure variability that delays rendering.',
    details: {
      confidenceScore: 82,
      severity: 'high',
      affectedArea: 'checkout / payment',
      hypotheses: [
        {
          category: 'infrastructure',
          likelihood: 82,
          rootCause:
            'Slow CI runner renders the form too late; locator.click exceeds the 30s timeout before the button becomes interactive.',
          evidence: [
            'Failure rate correlates with high-load CI runs [recurrenceFlakiness]',
            'Element present in DOM but not interactive at click time [steps]',
          ],
        },
        {
          category: 'test-bug',
          likelihood: 40,
          rootCause: 'The test clicks without an explicit wait for the element to be ready.',
          evidence: ['No waitFor/waitForLoadState precedes the click [testSource]'],
        },
      ],
      evidence: [
        'TimeoutError occurs in both affected test cases',
        'Error fires during locator.click — element is present but not yet interactive',
        '3/12 runs failed (25% failure rate), passes on retry 60% of the time',
      ],
      suggestedFix: {
        description:
          'Add an explicit waitForLoadState("networkidle") or waitFor condition before the click, and increase the locator timeout.',
        code: 'await page.waitForLoadState("networkidle");\nawait page.getByRole("button", { name: "Submit" }).click({ timeout: 60000 });',
      },
      preventionTips: [
        'Use waitForLoadState() before interacting with dynamically loaded content',
        'Add a CI-aware timeout multiplier for critical interactions',
      ],
      investigationSteps: [
        'Re-run on a low-load runner to confirm CI variability is the driver',
        'Check whether the page fires a network-idle event before the target becomes interactive',
      ],
    },
    error: null,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 100,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Emit thinking chunks with delays
        for (const chunk of FAKE_THINKING_CHUNKS) {
          controller.enqueue(encoder.encode(`event: thinking\ndata: ${JSON.stringify({ text: chunk })}\n\n`));
          // Simulate variable thinking speed — shorter chunks pass faster
          const delay = Math.max(200, Math.min(800, chunk.length * 3));
          await new Promise((r) => setTimeout(r, delay));
        }

        // Emit the final structured result
        controller.enqueue(encoder.encode(`event: result\ndata: ${JSON.stringify(diagnosisResult)}\n\n`));
        controller.close();
      } catch {
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

/** GET /api/settings/ai */
export async function apiGetAiSettings() {
  return {
    roles: { diagnosis: null, research: null, embedding: null },
    autoDiagnose: false,
    hasScmToken: false,
    envManaged: false,
    customInstructions: null,
  };
}

/** PUT /api/settings/ai — no-op in demo */
export async function apiPutAiSettings(_body: unknown) {
  return { success: true };
}

/** POST /api/settings/ai/test */
export async function apiTestAiSettings() {
  return { success: false as const, error: 'AI diagnosis is not available in demo mode' };
}

/** GET /api/settings/ai/limits */
export async function apiGetAiLimits() {
  return {
    limits: DEFAULT_CONTEXT_LIMITS,
    envManaged: [],
    fields: CONTEXT_LIMIT_FIELDS,
  };
}

/** PUT /api/settings/ai/limits — no-op in demo */
export async function apiPutAiLimits(_body: unknown) {
  return { success: true };
}
