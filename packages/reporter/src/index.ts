/**
 * Public API of `@piwitests/reporter`.
 *
 * This barrel is the *entire* external surface of the package — the reporter
 * class, the config helpers, the capture fixtures, and the public types.
 * Everything under `internal/` is deliberately NOT re-exported here; if it isn't
 * exported from this file, it isn't part of the supported API.
 */
import { PiwiDashboardReporter } from './public/reporter.js';

// ── Reporter (default + named export) ────────────────────────────────────────
export default PiwiDashboardReporter;
export { PiwiDashboardReporter };

// ── Config helpers ───────────────────────────────────────────────────────────
export { wrapConfig } from './public/config-wrapper.js';
export { createGlobalSetup } from './public/global-setup.js';
export { resolveSelection } from './public/selection.js';

// ── Capture fixtures ─────────────────────────────────────────────────────────
export { piwiFixtures, extendPiwiFixtures } from './internal/capture/capture-fixtures.js';

// ── AI-step fixtures ─────────────────────────────────────────────────────────
export { piwiAiFixtures, extendPiwiAi } from './internal/ai/ai-fixtures.js';

// ── Public types ─────────────────────────────────────────────────────────────
export type { PiwiFixtures } from './internal/capture/capture-fixtures.js';
export type { PiwiAi, AiMode, AiOnMiss } from './internal/ai/ai-fixtures.js';
export type { PiwiDashboardOptions, PlaywrightTestConfig } from './public/options.js';
export type { ResolveSelectionResult, ResolveSelectionOptions } from './public/selection.js';
