import { IDE_CHROME_GLOBAL, IDE_RECORDER_BINDING, type IdeRecorderRequest } from '@piwitests/core/ide-recorder';
import { BUILD_ID } from '../shared/build-id.js';

/**
 * The recorder's `chrome` in a page of a browser the editor service launched.
 * The IDE bundle is built with every `chrome` reference rewritten to
 * `globalThis.__piwiIdeChrome` (`scripts/build.mjs`), which this module
 * installs before the recorder runs, over the binding the launcher exposes in
 * every page (`__piwiRecorder`): each storage call and each message is one
 * request to the launcher. There is no `storage.session`, so the recorder
 * keeps its recording through messages (`piwi-session-storage`,
 * `piwi-append-recording-event`), as in a content script in Firefox, and no
 * `dom`. The page's own `chrome` is left as it is.
 */

/** The launcher's binding: one request, answered with the launcher's reply. */
export type RecorderBinding = (request: IdeRecorderRequest) => Promise<unknown>;

type MessageListener = (message: unknown, sender: unknown, sendResponse: (response?: unknown) => void) => unknown;

/** The part of the extension's `chrome` the recorder reaches. */
export interface IdeChrome {
  storage: {
    local: {
      get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    };
  };
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
    /** Keeps its listeners; nothing sends them a message. */
    onMessage: {
      addListener(listener: MessageListener): void;
      removeListener(listener: MessageListener): void;
      hasListener(listener: MessageListener): boolean;
    };
    getManifest(): { version: string };
    getURL(path: string): string;
  };
  /** Empty: the launcher hands the whole catalog of the editor's language under `piwiLanguage`, which `initI18n` reads. */
  i18n: {
    getMessage(name: string, substitutions?: string | string[]): string;
    getUILanguage(): string;
  };
}

/**
 * Where `runtime.getURL` points: a reserved domain no page is served from, so
 * no page is taken for the extension's own (`isExtensionContext`).
 */
const NO_EXTENSION_ORIGIN = 'https://piwi-recorder.invalid/';

export function createIdeChrome(binding: RecorderBinding): IdeChrome {
  const listeners = new Set<MessageListener>();
  return {
    storage: {
      local: {
        async get(keys = null) {
          const items = await binding({ kind: 'local-get', keys });
          return items && typeof items === 'object' ? (items as Record<string, unknown>) : {};
        },
        async set(items) {
          await binding({ kind: 'local-set', items });
        },
        async remove(keys) {
          await binding({ kind: 'local-remove', keys });
        },
      },
    },
    runtime: {
      sendMessage: (message) => binding({ kind: 'message', message }),
      onMessage: {
        addListener: (listener) => void listeners.add(listener),
        removeListener: (listener) => void listeners.delete(listener),
        hasListener: (listener) => listeners.has(listener),
      },
      getManifest: () => ({ version: BUILD_ID }),
      getURL: (path) => new URL(path, NO_EXTENSION_ORIGIN).href,
    },
    i18n: {
      getMessage: () => '',
      getUILanguage: () => 'en',
    },
  };
}

/**
 * Installs the host as `__piwiIdeChrome` on `scope`, read-only, over the
 * launcher's binding found there. Without the binding (the bundle loaded
 * anywhere but a page of the launcher's browser) it installs nothing, and the
 * recorder stays inert. Answers whether the host is installed.
 */
export function installIdeHost(scope: object = globalThis): boolean {
  const slots = scope as Record<string, unknown>;
  if (slots[IDE_CHROME_GLOBAL]) return true;
  const binding = slots[IDE_RECORDER_BINDING];
  if (typeof binding !== 'function') return false;
  Object.defineProperty(scope, IDE_CHROME_GLOBAL, { value: createIdeChrome(binding as RecorderBinding) });
  return true;
}

installIdeHost();
