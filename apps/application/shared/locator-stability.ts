/**
 * Locator stability: whether a chain a test uses is likely to break for a
 * reason unrelated to what the test checks. The pure implementation lives in
 * `@piwitests/core`; this file re-exports it so app code keeps importing
 * `#shared/locator-stability`.
 */
export * from '@piwitests/core/locator-stability';
