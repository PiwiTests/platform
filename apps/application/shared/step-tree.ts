/**
 * The structure of a stored step list — parents, phases, the failing step and
 * the capture's own steps. The pure implementation lives in `@piwitests/core`
 * (shared with the Playwright reporter); this file re-exports it so app/server
 * code imports `#shared/step-tree`.
 */
export * from '@piwitests/core/step-tree';
