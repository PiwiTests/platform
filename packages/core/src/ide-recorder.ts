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

/**
 * The global the IDE bundle's host installs to hand the recorder a message from the launcher, as
 * `chrome.runtime.onMessage` hands an extension's: {@link IdeRecorderPaused} when the editor pauses or resumes.
 */
export const IDE_DISPATCH_GLOBAL = '__piwiIdeDispatch';

/** The message that pauses or resumes a recording, in both directions: the recorder's Pause, the editor's. */
export const IDE_PAUSED_MESSAGE = 'piwi-recording-paused';

/** While a recording is paused, nothing done in the browser is recorded, and the editor writes nothing. */
export interface IdeRecorderPaused {
  type: typeof IDE_PAUSED_MESSAGE;
  paused: boolean;
}

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
