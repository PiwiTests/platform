import { t } from './i18n.js';

/**
 * Why the browser refused to open a tool in a tab, in words the popup can
 * show. Chrome's message names the case: the tab showing its error page (a
 * site that is down, such as a dev server not started, while the tab's
 * address still reads `http://localhost:…`), a policy, one of the browser's
 * own pages, or a tool's script missing from an out-of-date development build.
 * Any other refusal is passed on as the browser wrote it.
 */
export function injectionFailureText(error: unknown, tabUrl: string | undefined): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/showing error page/i.test(message)) return t('popup_tabShowsError');
  if (/ExtensionsSettings policy/i.test(message)) return t('popup_blockedByPolicy');
  const missing = /Could not load file: '([^']+)'/i.exec(message);
  if (missing) return t('popup_buildIncomplete', { file: missing[1]! });
  if (/chrome:\/\/|-extension:\/\/|extensions gallery/i.test(message) || !/^(https?|file):/i.test(tabUrl ?? '')) {
    return t('popup_cannotRun');
  }
  return t('popup_cannotRunBecause', { reason: message });
}
