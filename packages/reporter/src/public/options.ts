export type { PlaywrightTestConfig } from '@playwright/test';

/**
 * Playwright shard info — mirrors `config.shard` shape.
 *
 * Internal shape: it is NOT re-exported from the package entry point, but it
 * lives here next to the configuration types because it describes the same
 * `config.shard` surface the options come from. May move to `types/wire.ts`.
 */
export interface ShardInfo {
  current: number;
  total: number;
}

/**
 * Options for configuring the Piwi Dashboard reporter.
 *
 * Piwi options only — the Playwright config belongs in `defineConfig` (i.e. in
 * `wrapConfig`'s first argument). These go in `wrapConfig`'s second argument or
 * in the reporter entry's options (`['@piwitests/reporter', { … }]`).
 */
export interface PiwiDashboardOptions {
  // ── Connection ─────────────────────────────────────────────────────────────
  /** Explicitly enable or disable the reporter. Defaults to `true` when `serverUrl` is set. Set to `false` to disable even if `serverUrl` is provided. */
  enabled?: boolean;
  /** URL of the Piwi Dashboard server */
  serverUrl?: string;
  /** Name of the project to report results under. Defaults to `'default-project'`. */
  projectName?: string;
  /** Optional description of the project */
  projectDescription?: string;

  // ── What gets uploaded ─────────────────────────────────────────────────────
  /** Upload trace files to the dashboard. Defaults to `true`. */
  uploadTraces?: boolean;
  /** Upload the Playwright HTML report. Defaults to `true`. */
  uploadReport?: boolean;
  /** Upload each test's trace and attachments as soon as the test finishes (streaming mode only). Defaults to `true`. */
  liveFileUploads?: boolean;

  // ── What gets captured ─────────────────────────────────────────────────────
  //
  // Note the dependency: `collectPerformanceMetrics` is a master switch for the
  // three `capture*` toggles below it. Setting it to `false` forces
  // `captureLocators`, `capturePageState` and `captureServerTraces` off too,
  // because the reporter discards their data in that case — it is the one
  // option here that silently disables others. `collectScmInfo` and
  // `collectCiInfo` are independent of it.
  /** Auto-collect git commit, branch, author. Defaults to `true`. */
  collectScmInfo?: boolean;
  /** Auto-collect CI environment info. Defaults to `true`. */
  collectCiInfo?: boolean;
  /** Collect step timings, network requests and web vitals. Defaults to `true`. */
  collectPerformanceMetrics?: boolean;
  /**
   * Capture per-action locator snapshots that power failure-time healing
   * suggestions. Adds a small per-action cost (one DOM read, sometimes an ARIA
   * snapshot) in the test worker. Defaults to `true`; automatically disabled
   * when `collectPerformanceMetrics` is `false` (the reporter discards the data
   * in that case anyway). Can also be forced off with `PIWI_CAPTURE_LOCATORS=false`.
   */
  captureLocators?: boolean;
  /**
   * Capture the page's state at test end (URL, history state, localStorage/
   * sessionStorage key names + value lengths, cookie names + flags). Values of
   * storage entries and cookies are never captured. Defaults to `true`;
   * automatically disabled when `collectPerformanceMetrics` is `false`. Can
   * also be forced off with `PIWI_CAPTURE_PAGE_STATE=false`.
   */
  capturePageState?: boolean;
  /**
   * Capture server-side spans for each API/document request the test makes,
   * read from the `X-Piwi-Trace` response header emitted by a Piwi
   * instrumentation plugin (e.g. `@piwitests/instrumentation-nitro`). The spans show
   * up next to the network request in the dashboard and feed AI diagnosis. Free
   * when no instrumentation is present (the header is simply absent). Defaults
   * to `true`; automatically disabled when `collectPerformanceMetrics` is
   * `false`. Can also be forced off with `PIWI_CAPTURE_SERVER_TRACES=false`.
   */
  captureServerTraces?: boolean;
  /**
   * Sample the ARIA snapshot at the end of a *passing* test, so a later failure
   * can be diffed against the page as it last looked when green. Rate-limited by
   * the server: at run start the reporter asks which tests are due a fresh
   * sample (their newest green snapshot is older than a day, or missing) and
   * captures only those, so steady-state runs pay nothing. Rides the existing
   * capture fixtures — no snapshot is taken without them. Defaults to `true`.
   * Set to `false` (or `PIWI_SAMPLE_ARIA_ON_PASS=false`) to never sample on pass.
   */
  sampleAriaOnPass?: boolean;
  /**
   * When installed via `wrapConfig`, default Playwright's own `screenshot` and
   * `trace` options on the top-level `use` block so a failing test keeps a
   * screenshot (`'only-on-failure'`) and a trace (`'retain-on-failure'`) even
   * without the capture fixtures — the trace alone unlocks the DOM snapshot,
   * full call stack, full network with bodies and the visual diff. On Playwright
   * 1.63 or later the trace default also turns on the per-action aria tree
   * (`snapshots: { dom: true, aria: true }`), which adds the accessibility tree
   * before and after each action at negligible size. The `screen` snapshot kind
   * (a PNG per action, the trace's biggest cost) stays opt-in — set it yourself
   * with `use: { trace: { mode: 'retain-on-failure', snapshots: { dom: true,
   * aria: true, screen: true } } }`. Only fills options the config leaves unset;
   * an explicit value (including `'off'`) and per-project `use` blocks are never
   * touched. Defaults to `true`. Set to `false` (or `PIWI_DEFAULT_CAPTURE=false`)
   * to opt out and let Playwright's own defaults stand.
   */
  defaultCapture?: boolean;

  // ── Local debugging aids (headed runs only, never under CI) ────────────────
  /**
   * Open Piwi's own failure-time overlay on the failing page — for inspecting
   * the page and picking a locator for any element (click an element → confirm
   * a ranked replacement locator). This is Piwi's own in-page overlay, not
   * Playwright's native inspector, so a confirmed pick flows back into the
   * dashboard. `pickLocatorOnFailure` opens the same overlay targeted at the
   * broken locator; this opens it for the whole page. Local debugging aid: only
   * takes effect in a headed browser (`headless: false` / `--headed`), never
   * under CI, and only on a test's final attempt when retries are configured.
   * The run waits until the overlay is resolved. Defaults to `false`. Can also
   * be enabled with `PIWI_INSPECT_ON_FAIL=true`.
   */
  inspectOnFailure?: boolean;
  /**
   * Open Piwi's locator picker on the failing page when a locator action
   * fails: click the element the locator should have matched, confirm one of
   * the ranked replacement locators generated for it, and the choice is
   * recorded — folded into the run's locator snapshots (so the dashboard's
   * healing panel shows it) and attached as `piwi-user-pick` with a report
   * annotation. Same gate as `inspectOnFailure`: headed browser only, never
   * under CI, final attempt only. Defaults to `false`. Can also be enabled
   * with `PIWI_PICK_LOCATOR_ON_FAIL=true`.
   */
  pickLocatorOnFailure?: boolean;

  // ── Streaming ──────────────────────────────────────────────────────────────
  /** Enable live streaming of results (falls back to batch if unsupported). Defaults to `true`. */
  streaming?: boolean;
  /** Number of test results to batch before sending during streaming. Defaults to `5`. */
  streamingBatchSize?: number;
  /** Max delay (ms) before flushing pending events during streaming. Defaults to `2000`. */
  streamingBatchDelay?: number;
  /**
   * Byte budget for the in-memory stream buffer (the queue of events waiting to
   * reach the dashboard, and the crash-recovery file it writes if delivery
   * fails). When the server is unreachable or a huge suite outruns delivery, the
   * queue is capped here instead of growing without bound: the lowest-value
   * events are shed first — live step progress, then per-test `begin` markers,
   * and only as a last resort test results (the final counts and the end-of-run
   * batch submit stay complete regardless). Defaults to `104857600` (100 MB).
   * Set to `0` to disable the cap (unbounded, the pre-`0.28` behavior). Can also
   * be set with `PIWI_MAX_STREAM_BUFFER_BYTES`.
   */
  maxStreamBufferBytes?: number;

  // ── CI gate ────────────────────────────────────────────────────────────────
  /**
   * Fail the run when any test was flaky (passed only after a retry). Forwarded
   * to Playwright's native `failOnFlakyTests` config option (Playwright 1.52+)
   * when the reporter is installed via `wrapConfig`, so a flaky-only run exits
   * non-zero without any server round-trip. Defaults to `false`. Can also be
   * set with `PIWI_FAIL_ON_FLAKY_TESTS`.
   */
  failOnFlakyTests?: boolean;

  // ── Authentication ─────────────────────────────────────────────────────────
  /** Username for dashboard login (use `apiKey` instead when possible) */
  username?: string | null;
  /** Password for dashboard login (used with `username`) */
  password?: string | null;
  /** API key for authentication (preferred over `username`/`password` for CI) */
  apiKey?: string | null;

  // ── Run metadata ───────────────────────────────────────────────────────────
  /** Additional report types to upload. Each entry can specify `type`, optional `dir`, and optional `label`. */
  reports?: Array<{ type: string; dir?: string; label?: string }>;
  /** Stable label that ties shards together (e.g. CI run ID). Auto-detected from CI env; override if needed. */
  runLabel?: string;
  /** Deployment environment for this run, e.g. `"production"`, `"staging"`, `"integration"` */
  environment?: string;
  /** Optional display label for the test run (e.g. "v2.3.1 release") */
  label?: string;
  /** Related issue reference, e.g. `"JIRA-123"` */
  relatedIssue?: string;
  /** CI job information */
  ciInfo?: string;
  /** Tags to categorize the test run */
  tags?: string[];
  /** Additional custom metadata as key-value pairs */
  customData?: Record<string, unknown>;

  // ── AI steps ───────────────────────────────────────────────────────────────
  /**
   * Natural-language locators and flows (`page.piwiLocator(...)` /
   * `page.piwiRun(...)`). An agent resolves each prompt once into a committed,
   * deterministic artifact; every run replays that artifact with plain
   * Playwright calls — zero LLM calls in the default `replay` mode.
   */
  ai?: {
    /**
     * `replay` (default) executes committed artifacts read-only and fails closed
     * on a miss; `resolve` authors missing entries; `heal` repairs entries that
     * no longer replay. Can also be set with `PIWI_AI`.
     */
    mode?: 'replay' | 'resolve' | 'heal';
    /**
     * Directory name (per spec) that holds the committed entries. Defaults to
     * `__piwi__`. Can also be set with `PIWI_AI_DIR`.
     */
    dir?: string;
    /**
     * On a replay miss: `fail` (default) errors with repro instructions, or
     * `fixme` marks the test fixme (yellow) instead. Can also be set with
     * `PIWI_AI_ON_MISS`.
     */
    onMiss?: 'fail' | 'fixme';
    /**
     * Max steps the agent may take resolving one `piwiRun` flow (the authoring
     * budget). Defaults to `20`. Can also be set with `PIWI_AI_MAX_FLOW_STEPS`.
     */
    maxSteps?: number;
    /**
     * Max characters of the page ARIA snapshot sent to the authoring model per
     * iteration (cost control). Defaults to `24000`. Can also be set with
     * `PIWI_AI_MAX_SNAPSHOT_CHARS`.
     */
    maxSnapshotChars?: number;
    /**
     * Timeout (ms) for the existence probe of an `optional` step during replay.
     * Defaults to `2000`. Can also be set with `PIWI_AI_OPTIONAL_PROBE_TIMEOUT`.
     */
    optionalProbeTimeout?: number;
    /**
     * Timeout (ms) for a step's `waitForResponse` (the Ajax wait) during replay,
     * and the network-settle window during authoring. Omitted uses Playwright's
     * default action timeout. Can also be set with `PIWI_AI_RESPONSE_WAIT_TIMEOUT`.
     */
    responseWaitTimeout?: number;
    /**
     * Send a screenshot to the authoring model as a vision fallback when the page's
     * ARIA snapshot is empty (a canvas-heavy page the model otherwise can't ground
     * against). **Requires a vision-capable model** — leave it off (the default) for
     * models that don't accept images. Only affects `resolve`/`heal`, never replay.
     * Can also be set with `PIWI_AI_SCREENSHOT_FALLBACK`.
     */
    screenshotFallback?: boolean;
  };

  // ── Output & diagnostics ───────────────────────────────────────────────────
  /**
   * Write a JSON file with the submitted run's dashboard URL, id, project id and
   * status after the run lands, so a CI pipeline can consume it (e.g. feed the
   * run URL into a custom email step). Any CI can read the file. GitHub Actions
   * step outputs / job summary and GitLab dotenv reports are emitted
   * automatically when running under those systems, regardless of this option.
   * Can also be set with `PIWI_OUTPUT_FILE`.
   */
  outputFile?: string;
  /** Enable verbose logging for debugging. Defaults to `false`. */
  verbose?: boolean;
}
