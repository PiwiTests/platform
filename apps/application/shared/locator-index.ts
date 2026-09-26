/**
 * The locator index document and the matching of pasted locators against it.
 * The pure implementation lives in `@piwitests/core`; this file re-exports it
 * so app/server code keeps importing `#shared/locator-index`.
 */
export * from '@piwitests/core/locator-index';
