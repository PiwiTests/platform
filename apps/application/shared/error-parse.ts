/**
 * Structured Playwright error parsing. The pure implementation lives in
 * `@piwitests/core` (the single source of truth shared with the Playwright
 * reporter); this file re-exports it so app/server code imports `#shared/error-parse`.
 */
export * from '@piwitests/core/error-parse';
