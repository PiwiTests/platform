/**
 * The Playwright locator-builder methods whose innermost call identifies the
 * resolved element. The single source of truth shared by the reporter's capture
 * proxy (`LOCATOR_METHODS`) and the server's leaf-selector extraction
 * (`LEAF_SELECTOR_METHODS` in `error-fingerprint.ts`).
 *
 * `frameLocator` is excluded — it resolves a frame, not the leaf element the
 * innermost builder call identifies. The capture proxy wraps the no-selector
 * `frameLocator()` entry point separately so locators built through it capture,
 * but a frame locator is never itself a leaf selector.
 */
export const LOCATOR_BUILDER_METHODS: readonly string[] = [
  'getByRole',
  'getByTestId',
  'getByText',
  'getByLabel',
  'getByPlaceholder',
  'getByAltText',
  'getByTitle',
  'locator',
];
