import { conditionText } from '../shared/condition-words.js';
import { t } from '../shared/i18n.js';
import {
  CONDITIONS_KEY,
  MAX_DELAY_MS,
  type ConditionKind,
  type ConditionsState,
  type RequestCondition,
} from '../shared/request-conditions.js';
import { mockUrlPattern } from '../shared/mock-code.js';
import { sessionArea } from '../shared/session-area.js';
import { inspectedTabId, sitePattern } from './inspected.js';
import { button, el } from './ui.js';
import type { NetworkEntry } from './panel-network.js';

/**
 * Slow down or fail a request, in the Network tab: buttons under the selected
 * request, and the conditions on this tab with a way to remove them. The
 * background worker applies them (`piwi-set-conditions`); the site's host
 * permission is asked for inside the click.
 */

async function conditionsOnThisTab(): Promise<RequestCondition[]> {
  const state = (await sessionArea().get(CONDITIONS_KEY))[CONDITIONS_KEY] as ConditionsState | undefined;
  return state?.tabId === inspectedTabId() ? state.conditions : [];
}

async function setConditions(origin: string, conditions: RequestCondition[], report: (text: string) => void) {
  const reply = (await chrome.runtime
    .sendMessage({ type: 'piwi-set-conditions', tabId: inspectedTabId(), origin, conditions })
    .catch((err: unknown) => ({ ok: false, error: err instanceof Error ? err.message : String(err) }))) as {
    ok: boolean;
    error?: string;
  };
  if (!reply?.ok) report(t('devtools_conditionFailed', { error: reply?.error ?? '' }));
}

/** The section under a selected request: slow it down by the seconds given, or make it fail. */
export function conditionActions(entry: NetworkEntry, origin: string | null): HTMLElement {
  const status = document.createElement('span');
  status.className = 'warn-text';
  status.setAttribute('role', 'status');
  const report = (text: string) => {
    status.textContent = text;
  };
  const seconds = document.createElement('input');
  seconds.type = 'number';
  seconds.min = '0.1';
  seconds.max = String(MAX_DELAY_MS / 1000);
  seconds.step = '0.5';
  seconds.value = '2';
  seconds.className = 'seconds';
  seconds.setAttribute('aria-label', t('devtools_delaySeconds'));

  const add = (kind: ConditionKind) => {
    report('');
    const pattern = sitePattern(origin);
    if (!origin || !pattern) return report(t('devtools_conditionsNoPage'));
    const delayMs = Math.round(Math.min(Math.max(Number(seconds.value) || 0, 0), MAX_DELAY_MS / 1000) * 1000);
    const condition: RequestCondition = {
      id: crypto.randomUUID(),
      method: entry.method.toUpperCase(),
      pattern: mockUrlPattern(entry.url),
      kind,
      delayMs: kind === 'delay' ? delayMs : 0,
    };
    // Inside the click: the browser shows the request only during it.
    void chrome.permissions.request({ origins: [pattern] }).then(async (granted) => {
      if (!granted) return report(t('devtools_conditionsNeedAccess'));
      const others = (await conditionsOnThisTab()).filter(
        (c) => c.method !== condition.method || c.pattern !== condition.pattern,
      );
      await setConditions(origin, [...others, condition], report);
    });
  };
  const section = el('section', 'condition-actions');
  section.setAttribute('aria-label', t('devtools_conditionsFor'));
  const controls = el('div', 'controls');
  controls.append(
    seconds,
    button(t('devtools_slowDown'), () => add('delay')),
    button(t('devtools_failError'), () => add('error')),
    button(t('devtools_failAbort'), () => add('abort')),
    status,
  );
  const limits = el('details', 'limits');
  limits.append(el('summary', '', t('devtools_conditionsLimitsTitle')), el('p', '', t('devtools_conditionsLimits')));
  section.append(el('h3', 'section-title', t('devtools_conditionsFor')), controls, limits);
  return section;
}

/** The conditions on this tab, each with Remove, and Turn all off; nothing when none is on. */
export async function renderConditions(strip: HTMLElement, origin: string | null): Promise<void> {
  const conditions = await conditionsOnThisTab();
  if (conditions.length === 0 || !origin) {
    strip.replaceChildren();
    return;
  }
  const status = el('span', 'warn-text');
  const report = (text: string) => {
    status.textContent = text;
  };
  const list = el('ul');
  for (const condition of conditions) {
    const item = el('li');
    item.append(
      el('span', '', conditionText(condition)),
      button(
        t('devtools_conditionRemove'),
        () => {
          void setConditions(
            origin,
            conditions.filter((c) => c.id !== condition.id),
            report,
          );
        },
        'link',
      ),
    );
    list.appendChild(item);
  }
  const allOff = button(t('devtools_conditionsAllOff'), () => void setConditions(origin, [], report), 'danger');
  strip.replaceChildren(el('span', 'strip-title', t('devtools_conditionsTitle')), list, allOff, status);
}
