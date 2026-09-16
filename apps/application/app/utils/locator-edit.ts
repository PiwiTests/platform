/**
 * Locator-edit helpers moved to `#shared/locator-edit` so the server and demo
 * can import them too (the fix plan and healing lookup build the same edits).
 * This re-export keeps them auto-imported in the app under their original names.
 */
export { buildLocatorEdit, locatorEditPatch, diffLocatorArgs, buildLocatorFixPrompt } from '#shared/locator-edit';
export type { LocatorArgChange } from '#shared/locator-edit';
