/**
 * The one-line failure headline. The pure implementation lives in
 * `@piwitests/core` (the single source of truth shared with the Playwright
 * reporter); this file re-exports it so app/server code imports `#shared/describe-failure`.
 */
export * from '@piwitests/core/describe-failure';
