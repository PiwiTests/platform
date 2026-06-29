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

// ── Capture fixtures ─────────────────────────────────────────────────────────
export { dashboardFixtures, extendDashboardFixtures } from './internal/capture/capture-fixtures.js';

// ── Public types ─────────────────────────────────────────────────────────────
export type { PiwiDashboardOptions, PlaywrightTestConfig } from './public/options.js';
