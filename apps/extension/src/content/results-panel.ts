import type { RankedLocator } from '@piwitests/picker-dom';
import { highlightLocator, LOCATOR_SYNTAX_CSS } from '@piwitests/picker-dom';
import { TAG_TO_ROLE, INPUT_TYPE_TO_ROLE } from '@piwitests/core/locator-generation';
import { COPY_MODES, COPY_MODE_LABELS, renderCopyMode } from '../shared/copy-modes.js';
import { getLastCopyMode, setLastCopyMode } from '../shared/storage.js';
import { liveCount } from './live-count.js';
import { locatorActionLabel } from '@piwitests/core/step-locators';
import { getConnectionSettings, isConnected } from '../shared/connection-settings.js';
import { getActiveProjectOverride, resolveActiveProject } from '../shared/active-project.js';
import { ensureSessionAccess } from '../shared/session-access.js';
import { getCachedLocatorIndex } from '../shared/locator-index-cache.js';
import { getLocatorBranchOverride, resolveLocatorBranch } from '../shared/locator-branch.js';
import { ALL_BRANCHES } from '@piwitests/core/locator-index';
import { requestLocatorIndex } from '../shared/locator-index-refresh.js';
import { projectLocatorsUrl, testCaseUrl } from '../shared/piwi-client.js';
import { elementReach, scanCoverage, type ReachGroup } from './coverage-scan.js';
import { plural, statusLabel, testTitle } from './coverage-view.js';

const ROLE_MAPS = { tagRoles: TAG_TO_ROLE, inputRoles: INPUT_TYPE_TO_ROLE };

const HOST_ID = 'piwi-picker-results-host';

/** How many tests the Piwi section lists before pointing at the full view. */
const PIWI_TESTS_SHOWN = 6;

/**
 * Renders the ranked-locator results panel in a closed shadow root — the
 * copy modes are extension-specific (the reporter's equivalent panel,
 * `showPickerChoices`, exists to commit a single replacement, not to browse
 * several source-code renderings of each candidate), so this is native
 * extension UI rather than a reuse of picker-dom's confirm step.
 *
 * With `target` (the picked element) and a connection to a Piwi instance, a
 * section lists the project's tests whose locators reach that element.
 *
 * Resolves once the user dismisses the panel (Escape or the close button).
 */
export async function renderResultsPanel(ranked: RankedLocator[], target: Element | null = null): Promise<void> {
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;';
  document.documentElement.appendChild(host);
  const openShadow = (globalThis as { __piwiTestOpenShadow?: boolean }).__piwiTestOpenShadow === true;
  const root = host.attachShadow({ mode: openShadow ? 'open' : 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    ${LOCATOR_SYNTAX_CSS}
    :host { all: initial; }
    * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
    .backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,.35);
      display: flex; align-items: flex-start; justify-content: center; padding-top: 8vh;
    }
    .panel {
      background: #111827; color: #f9fafb; border-radius: 12px; padding: 16px;
      width: min(640px, 92vw); max-height: 78vh; overflow: auto;
      box-shadow: 0 8px 40px rgba(0,0,0,.5); font-size: 13px; line-height: 1.5;
    }
    @media (prefers-color-scheme: light) {
      .panel { background: #ffffff; color: #111827; box-shadow: 0 8px 40px rgba(0,0,0,.2); }
    }
    @media (prefers-reduced-motion: no-preference) {
      .panel { animation: piwi-in 120ms ease-out; }
    }
    @keyframes piwi-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
    .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
    .title { font-weight: 600; font-size: 14px; }
    .sub { color: #9ca3af; font-size: 12px; }
    .close {
      background: none; border: none; color: inherit; opacity: .7; cursor: pointer; font-size: 18px;
      line-height: 1; padding: 4px 8px; border-radius: 6px;
    }
    .close:hover, .close:focus-visible { opacity: 1; background: rgba(128,128,128,.15); }
    .row {
      border: 1px solid rgba(128,128,128,.3); border-radius: 8px; padding: 8px 10px; margin-bottom: 8px;
    }
    .row-top { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .score {
      color: #c4b5fd; font-variant-numeric: tabular-nums; font-size: 11px; flex-shrink: 0;
      border: 1px solid #c4b5fd66; border-radius: 999px; padding: 1px 7px;
    }
    .row code { font-size: 13px; line-height: 1.55; }
    .copy-row { display: flex; gap: 6px; flex-wrap: wrap; }
    button.copy {
      background: rgba(128,128,128,.12); color: inherit; border: 1px solid rgba(128,128,128,.3);
      border-radius: 6px; padding: 4px 9px; font-size: 11.5px; cursor: pointer;
    }
    button.copy:hover, button.copy:focus-visible { background: rgba(128,128,128,.25); }
    button.copy[data-active="true"] { border-color: #7c3aed; color: #a78bfa; }
    button.copy .done { color: #4ade80; }
    .footer { color: #9ca3af; font-size: 11px; margin-top: 4px; }
    .unique { color: #4ade80; font-size: 11px; }
    .ambiguous { color: #fbbf24; font-size: 11px; }
    .header-actions { display: flex; align-items: center; gap: 6px; }
    .piwi {
      border: 1px solid #7c3aed66; border-radius: 8px; padding: 8px 10px; margin-bottom: 10px;
      background: rgba(124,58,237,.08); font-size: 12.5px;
    }
    .piwi .lead { font-weight: 600; }
    .piwi .group { margin-top: 6px; font-weight: 600; }
    .piwi .muted { color: #9ca3af; font-size: 12px; }
    .piwi ul { list-style: none; margin: 6px 0 0; padding: 0; }
    .piwi li { display: flex; align-items: baseline; gap: 7px; padding: 2px 0; }
    .piwi li .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; align-self: center; background: #64748b; }
    .piwi .dot.passed { background: #10b981; }
    .piwi .dot.failed { background: #e11d48; }
    .piwi .dot.flaky { background: #9333ea; }
    .piwi .dot.skipped { background: #a1a1aa; }
    .piwi a { color: inherit; text-decoration: underline dotted; text-underline-offset: 2px; }
    .piwi a:hover { text-decoration-style: solid; }
    .piwi .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .piwi .actions a, .piwi .actions button {
      background: rgba(128,128,128,.12); color: inherit; border: 1px solid rgba(128,128,128,.3); border-radius: 6px;
      padding: 3px 9px; font: inherit; font-size: 11.5px; cursor: pointer; text-decoration: none;
    }
    @media (prefers-color-scheme: light) {
      .piwi .muted { color: #6b7280; }
      .sub, .footer { color: #6b7280; }
      .score { color: #6d28d9; border-color: #6d28d966; }
      .unique { color: #15803d; }
      .ambiguous { color: #b45309; }
      button.copy[data-active="true"] { border-color: #6d28d9; color: #6d28d9; }
      button.copy .done { color: #15803d; }
    }
  `;
  root.appendChild(style);

  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Piwi locator picker results');
  panel.tabIndex = -1;

  const header = document.createElement('div');
  header.className = 'header';
  const titleWrap = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = `${ranked.length} locator${ranked.length === 1 ? '' : 's'} — ranked by stability`;
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = 'Esc to close · Tab between rows';
  titleWrap.append(title, sub);
  const closeBtn = document.createElement('button');
  closeBtn.className = 'close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '×';
  const headerActions = document.createElement('div');
  headerActions.className = 'header-actions';
  const copyAll = document.createElement('button');
  copyAll.className = 'copy';
  copyAll.type = 'button';
  copyAll.textContent = `Copy all ${ranked.length}`;
  copyAll.title =
    'Copy every locator, one per line — paste them into Piwi’s Locators page to find the tests using any of them';
  copyAll.addEventListener('click', () => void copyToClipboard(ranked.map((alt) => alt.locator).join('\n'), copyAll));
  headerActions.append(copyAll, closeBtn);
  header.append(titleWrap, headerActions);
  panel.appendChild(header);

  const piwiSection = document.createElement('div');
  piwiSection.className = 'piwi';
  piwiSection.hidden = true;
  panel.appendChild(piwiSection);

  let activeMode = await getLastCopyMode().catch(() => 'bare' as const);

  return new Promise<void>((resolve) => {
    let done = false;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        finish();
      }
    };
    const finish = () => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKeyDown, true);
      host.remove();
      resolve();
    };
    document.addEventListener('keydown', onKeyDown, true);
    closeBtn.addEventListener('click', finish);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) finish();
    });

    for (const [i, alt] of ranked.entries()) {
      const row = document.createElement('div');
      row.className = 'row';
      const top = document.createElement('div');
      top.className = 'row-top';
      const score = document.createElement('span');
      score.className = 'score';
      score.textContent = String(alt.score);
      const code = document.createElement('code');
      code.className = 'piwi-loc';
      code.innerHTML = highlightLocator(alt.locator);
      top.append(score, code);
      row.appendChild(top);

      const copyRow = document.createElement('div');
      copyRow.className = 'copy-row';
      for (const mode of COPY_MODES) {
        const btn = document.createElement('button');
        btn.className = 'copy';
        btn.type = 'button';
        btn.dataset.active = String(mode === activeMode);
        btn.textContent = COPY_MODE_LABELS[mode];
        btn.addEventListener('click', () => {
          void copyToClipboard(renderCopyMode(alt, mode), btn);
          activeMode = mode;
          void setLastCopyMode(mode);
          for (const sibling of copyRow.querySelectorAll('button.copy')) {
            (sibling as HTMLElement).dataset.active = String(sibling === btn);
          }
        });
        copyRow.appendChild(btn);
      }
      row.appendChild(copyRow);

      // Live re-check: a page can re-render between the pick and this panel
      // opening, so re-verify uniqueness right now rather than trusting the
      // count captured at pick time. Ambiguous candidates are flagged, not
      // dropped — some shapes aren't safely re-checkable (see live-count.ts)
      // and show no badge rather than a guessed one.
      const { count } = liveCount(alt, ROLE_MAPS);
      if (count != null) {
        const badge = document.createElement('div');
        if (count === 1) {
          badge.className = 'unique';
          badge.textContent = '✓ matches exactly 1 element right now';
        } else {
          badge.className = 'ambiguous';
          badge.textContent = `⚠ matches ${count} elements right now — add .first() or .filter({ hasText: … })`;
        }
        row.appendChild(badge);
      }

      panel.appendChild(row);

      if (i === 0) {
        const footer = document.createElement('div');
        footer.className = 'footer';
        footer.textContent = 'Top pick — highest stability score.';
        row.appendChild(footer);
      }
    }

    backdrop.appendChild(panel);
    root.appendChild(backdrop);
    panel.focus();
    void fillPiwiSection(piwiSection, ranked, target, () => done);
  });
}

type PickCoverage =
  | { status: 'off' | 'checking' | 'unavailable'; message?: string }
  | {
      status: 'ready';
      project: string;
      /** Tests reaching the element or something inside it. */
      tests: string[];
      /** Of those, the ones reaching only something inside it. */
      inside: string[];
      /** Tests reaching only an element around it. */
      around: string[];
      locators: string[];
    };

function reportPickCoverage(value: PickCoverage): void {
  (globalThis as { __piwiPickCoverage?: PickCoverage }).__piwiPickCoverage = value;
}

/**
 * Connected mode: which of the project's tests reach the picked element,
 * resolved on this page from the project's locator index. Silent when the
 * extension is not connected or no project is mapped to the page.
 */
async function fillPiwiSection(
  section: HTMLElement,
  ranked: RankedLocator[],
  target: Element | null,
  closed: () => boolean,
): Promise<void> {
  reportPickCoverage({ status: 'off' });
  if (!target) return;
  let settings: Awaited<ReturnType<typeof getConnectionSettings>>;
  let projectId: number;
  let projectLabel: string;
  let branch: string | null;
  try {
    await ensureSessionAccess();
    settings = await getConnectionSettings();
    if (!isConnected(settings)) return;
    const override = await getActiveProjectOverride().catch(() => null);
    const project = resolveActiveProject(settings, override, location.href);
    if (!project) return;
    projectId = project.projectId;
    projectLabel = project.projectLabel;
    branch = resolveLocatorBranch(project, await getLocatorBranchOverride(projectId).catch(() => undefined));
  } catch {
    return;
  }

  const findInPiwi = () => {
    const link = document.createElement('a');
    link.href = projectLocatorsUrl(
      settings.instanceUrl,
      projectId,
      ranked.map((alt) => alt.locator),
      branch,
    );
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Find these locators in Piwi ↗';
    return link;
  };
  const lead = (text: string) => {
    const el = document.createElement('div');
    el.className = 'lead';
    el.textContent = text;
    return el;
  };

  const where = `${projectLabel}${branch === ALL_BRANCHES ? ' on any branch' : branch ? ` on ${branch}` : ''}`;
  section.hidden = false;
  section.replaceChildren(lead(`Checking which tests of ${where} reach this element…`));
  reportPickCoverage({ status: 'checking' });

  let index = (await getCachedLocatorIndex(projectId, branch).catch(() => null))?.index ?? null;
  if (!index) {
    const answer = await requestLocatorIndex(projectId, { branch });
    if (answer.ok && answer.refreshed) index = answer.index;
    else {
      const muted = document.createElement('div');
      muted.className = 'muted';
      muted.textContent = answer.ok
        ? 'The project’s locator index is not available yet.'
        : `Couldn't load the locator index: ${answer.error}`;
      const actions = document.createElement('div');
      actions.className = 'actions';
      actions.appendChild(findInPiwi());
      section.replaceChildren(lead(`Tests of ${where}`), muted, actions);
      reportPickCoverage({ status: 'unavailable', message: muted.textContent });
      return;
    }
  }
  if (closed()) return;

  const scan = await scanCoverage(index, document, {
    testIdAttributes: index.testIdAttributes ?? undefined,
    ignore: (element) => (element.getAttribute('id') ?? '').startsWith('piwi-'),
    keepGoing: () => !closed(),
  });
  if (!scan || closed()) return;
  const reach = elementReach(scan, index, target);
  const direct = [...reach.self.tests, ...reach.inside.tests];

  const openCoverage = (scoped: boolean) => {
    if (scoped) (globalThis as { __piwiCoverageScopeRequest?: Element }).__piwiCoverageScopeRequest = target;
    void chrome.runtime.sendMessage({ type: 'piwi-open-coverage' }).catch(() => undefined);
    document.getElementById(HOST_ID)?.remove();
  };
  const actionButton = (text: string, title: string, onClick: () => void) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.title = title;
    button.addEventListener('click', onClick);
    return button;
  };
  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.append(
    findInPiwi(),
    actionButton('Show tested elements inside it', 'Open Tested elements limited to this element', () =>
      openCoverage(true),
    ),
    actionButton('Show every tested element', 'Open Tested elements on this page', () => openCoverage(false)),
  );

  const muted = (text: string) => {
    const el = document.createElement('div');
    el.className = 'muted';
    el.textContent = text;
    return el;
  };
  const nearest = reach.containers.elements[reach.containers.elements.length - 1];
  const groups: Array<{ label: string; group: ReachGroup }> = [
    { label: 'This element', group: reach.self },
    { label: `Inside it · ${plural(reach.inside.elements.length, 'element')}`, group: reach.inside },
    {
      label:
        reach.containers.elements.length === 1 && nearest
          ? `Around it · ${scan.describe(nearest)}`
          : `Around it · ${plural(reach.containers.elements.length, 'container')}`,
      group: reach.containers,
    },
  ].filter(({ group }) => group.tests.length > 0);

  const children: Node[] = [];
  if (direct.length) {
    children.push(lead(`Reached by ${plural(direct.length, 'test')} of ${where}`));
  } else {
    children.push(lead(`Not reached by any test of ${where}`));
    children.push(
      muted(
        reach.containers.tests.length
          ? 'No locator resolves to it or to anything inside it; these tests reach an element around it.'
          : 'No locator of the project’s tests resolves to this element here.',
      ),
    );
  }

  let shown = 0;
  const labelled = groups.length > 1 || groups[0]?.group !== reach.self;
  for (const { label, group } of groups) {
    if (shown >= PIWI_TESTS_SHOWN) break;
    if (labelled) {
      const heading = muted(label);
      heading.classList.add('group');
      children.push(heading);
    }
    const list = document.createElement('ul');
    for (const t of group.tests.slice(0, PIWI_TESTS_SHOWN - shown)) {
      const test = index.tests[t]!;
      const item = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = `dot ${test.status ?? ''}`;
      dot.title = statusLabel(test.status);
      const link = document.createElement('a');
      link.href = testCaseUrl(settings.instanceUrl, test.id);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = testTitle(test);
      link.title = test.file;
      const actionsOf = new Set<string>();
      for (const entry of group.entries) {
        for (const use of index.locators[entry]!.uses) if (use.test === t) use.actions.forEach((a) => actionsOf.add(a));
      }
      const meta = document.createElement('span');
      meta.className = 'muted';
      meta.textContent = [...actionsOf].map(locatorActionLabel).join(', ');
      item.append(dot, link, meta);
      list.appendChild(item);
      shown++;
    }
    children.push(list);
  }
  const total = groups.reduce((sum, { group }) => sum + group.tests.length, 0);
  if (total > shown) children.push(muted(`${total - shown} more — Tested elements lists them all.`));
  children.push(actions);
  section.replaceChildren(...children);
  const titles = (tests: number[]) => tests.map((t) => index!.tests[t]!.title);
  reportPickCoverage({
    status: 'ready',
    project: projectLabel,
    tests: titles(direct),
    inside: titles(reach.inside.tests),
    around: titles(reach.containers.tests),
    locators: [...reach.self.entries, ...reach.inside.entries].map((e) => index!.locators[e]!.locator),
  });
}

async function copyToClipboard(text: string, btn: HTMLButtonElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return;
  }
  const original = btn.textContent;
  btn.textContent = 'Copied';
  setTimeout(() => {
    btn.textContent = original;
  }, 1200);
}
