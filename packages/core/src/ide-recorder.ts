/**
 * A recording started from an editor: the editor service's launcher opens a browser with the project's own
 * Playwright and loads the recorder's IDE bundle (`record-ide.js`) into every page. The bundle reads its
 * `chrome.*` surface from {@link IDE_CHROME_GLOBAL}, which it builds over the {@link IDE_RECORDER_BINDING}
 * binding the launcher exposes; every request below goes through that binding.
 */

/** The page binding the launcher exposes in every page of the recording browser. */
export const IDE_RECORDER_BINDING = '__piwiRecorder';

/** The global the IDE bundle's `chrome` references are rewritten to at build time. */
export const IDE_CHROME_GLOBAL = '__piwiIdeChrome';

/** `chrome.storage.local` key under which the launcher hands the recorder its settings. */
export const IDE_SETTINGS_KEY = 'piwiIdeSettings';

/** What the launcher tells the recorder. */
export interface IdeRecorderSettings {
  /** The name of the file the steps are written into, shown in the recorder's panel; null when unknown. */
  file: string | null;
  /** The project's `testIdAttribute`; null for Playwright's default, `data-testid`. */
  testIdAttribute: string | null;
}

/** A call from the page to the launcher. */
export type IdeRecorderRequest =
  | { kind: 'message'; message: unknown }
  | { kind: 'local-get'; keys: string | string[] | Record<string, unknown> | null }
  | { kind: 'local-set'; items: Record<string, unknown> }
  | { kind: 'local-remove'; keys: string | string[] };
