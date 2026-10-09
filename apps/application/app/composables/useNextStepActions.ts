/**
 * The one place both failure pages turn a next-step action id into the real
 * behaviour. `NextStepLine` stays presentation-only and emits an id; the page
 * hands this composable the page-specific targets (its locator panel, its scroll
 * anchors, how it sets the cluster status, quarantines, re-runs) as callbacks,
 * and the composable owns the shared plumbing — the diagnosed patch's copy /
 * download / open-in-IDE, the recipe copy, the AI-prompt copy, the Flake Lab
 * command and its CI dispatch, the navigation —
 * so the execution page and the cluster page never duplicate the switch.
 */
import { reproScript, type ReproRecipe } from '#shared/reproduce';

/** The locator healing panel's exposed actions (see `LocatorHealingPanel`). */
export interface LocatorPanelActions {
  copyPatch: () => void;
  copyRecommendedLocator: () => void;
  openPicker: () => void;
  expandAlternatives: () => void;
}

/** The toolbox sections a next-step action opens. */
type ToolboxSectionKey = 'diagnosis' | 'reproduce' | 'locator-fix';

export interface NextStepActionHandlers {
  /** The cluster whose fix plan / status the code-change actions target. */
  clusterId: () => number | null | undefined;
  /** The diagnosed patch backing copy git apply / download / open in IDE. */
  fixPlanPatch: () => string | null;
  /** Base filename for the downloaded patch; defaults to the cluster id. */
  patchBaseName?: () => string;
  /** The project the open-in-IDE link resolves against. */
  ideProject?: () => { id?: number | string | null; name?: string | null } | null | undefined;
  /** The locator healing panel exposing the copy / pick / alternatives actions. */
  locatorPanel: () => LocatorPanelActions | null | undefined;
  /** The local reproduction recipe backing copy-recipe. */
  reproRecipe: () => ReproRecipe | null | undefined;
  /** The endpoint the AI prompt is copied from (`?format=prompt` is appended). */
  diagnosisContextEndpoint: () => string;
  /**
   * Open a toolbox section and scroll it into view; resolves once its body is
   * mounted. The `pick-from-snapshot`, `all-alternatives`, `read-diagnosis`,
   * `diagnose` and `reproduce` actions use it.
   */
  scrollToSection: (key: ToolboxSectionKey) => void | Promise<void>;
  /**
   * Open a toolbox section without scrolling; resolves once its body is mounted.
   * The `copy-patch` and `copy-locator` actions use it.
   */
  openSection: (key: ToolboxSectionKey) => void | Promise<void>;
  /** Select the Attempts evidence tab. */
  selectAttemptsTab: () => void;
  /** Set the cluster's triage status. */
  setClusterStatus: (status: 'open' | 'resolved') => void | Promise<void>;
  /** Quarantine the (selected) test. */
  quarantine: (payload?: Record<string, unknown>) => void | Promise<void>;
  /** Re-run the cluster's tests in CI. */
  rerunInCi: () => void | Promise<void>;
  /** Open the execution the payload names; defaults to navigating to its page. */
  openExecution?: (executionId: number) => void | Promise<void>;
  /** "What changed" — the cluster page scrolls, the execution page navigates. */
  whatChanged: () => void | Promise<void>;
  /** "Re-diagnose" — scroll to the diagnosis and trigger it (page-specific). */
  reDiagnose: () => void | Promise<void>;
}

/** The file (and line) a unified diff targets — for the open-in-IDE action. */
function patchTargetFile(patch: string): { filePath: string; line: number | null } | null {
  const file = patch.match(/^\+\+\+ b\/(.+)$/m) ?? patch.match(/^--- a\/(.+)$/m);
  if (!file?.[1]) return null;
  const hunk = patch.match(/^@@ -\d+(?:,\d+)? \+(\d+)/m);
  return { filePath: file[1].trim(), line: hunk ? Number(hunk[1]) : null };
}

/** Dispatch a test's Flake Lab experiment to the project's Flake Lab CI target, and say how it went. */
async function runFlakeLabInCi(testCaseId: number, kind: string) {
  const toast = useToast();
  try {
    const res = await $fetch<{ ok: boolean; message?: string; dispatch?: { url: string } }>(
      `/api/test-cases/${testCaseId}/flake-lab-ci`,
      { method: 'POST', body: { kind } },
    );
    if (res.ok && res.dispatch) {
      toast.add({
        title: 'Flake Lab dispatched to CI',
        description: 'The experiment shows on the Flakiness tab when it finishes.',
        color: 'success',
        actions: [{ label: 'Watch it', to: res.dispatch.url, target: '_blank' }],
      });
    } else {
      toast.add({ title: 'Flake Lab not started', description: res.message ?? 'Not available.', color: 'warning' });
    }
  } catch (e: unknown) {
    const message = (e as { data?: { message?: string } })?.data?.message ?? 'Dispatch failed.';
    toast.add({ title: 'Flake Lab dispatch failed', description: message, color: 'error' });
  }
}

export function useNextStepActions(handlers: NextStepActionHandlers) {
  const { copyGitApply, downloadPatch } = usePatchActions();
  const { copyPrompt } = useCopyAiPrompt();
  const { copy: copyPlain } = useCopy();
  const { openInIde } = useOpenInIde();
  const toast = useToast();

  /**
   * Run an action on the locator healing panel. A folded section renders no body,
   * so the Locator fix section opens first (and scrolls into view with `scroll`);
   * with no panel on the page, an error toast says so.
   */
  async function onLocatorPanel(act: (panel: LocatorPanelActions) => void, scroll: boolean) {
    await (scroll ? handlers.scrollToSection('locator-fix') : handlers.openSection('locator-fix'));
    const panel = handlers.locatorPanel();
    if (panel) act(panel);
    else
      toast.add({
        title: 'Locator fix not available',
        description: 'This page has no Locator fix section to act on.',
        color: 'error',
      });
  }

  async function handle(action: string, payload?: Record<string, unknown>) {
    switch (action) {
      case 'open-execution': {
        const id = payload?.executionId;
        if (typeof id !== 'number') break;
        if (handlers.openExecution) await handlers.openExecution(id);
        else await navigateTo(`/test-run-cases/${id}`);
        break;
      }
      case 'mark-resolved':
        await handlers.setClusterStatus('resolved');
        break;
      case 'reopen':
        await handlers.setClusterStatus('open');
        break;
      case 'copy-patch':
        await onLocatorPanel((panel) => panel.copyPatch(), false);
        break;
      case 'copy-locator':
        await onLocatorPanel((panel) => panel.copyRecommendedLocator(), false);
        break;
      case 'pick-from-snapshot':
        await onLocatorPanel((panel) => panel.openPicker(), true);
        break;
      case 'all-alternatives':
        await onLocatorPanel((panel) => panel.expandAlternatives(), true);
        break;
      case 'copy-git-apply': {
        const patch = handlers.fixPlanPatch();
        if (patch) copyGitApply(patch);
        break;
      }
      case 'download-patch': {
        const patch = handlers.fixPlanPatch();
        if (patch) downloadPatch(patch, handlers.patchBaseName?.() ?? `piwi-fix-cluster-${handlers.clusterId() ?? ''}`);
        break;
      }
      case 'open-in-ide': {
        const patch = handlers.fixPlanPatch();
        const target = patch ? patchTargetFile(patch) : null;
        const project = handlers.ideProject?.();
        if (target)
          openInIde({
            filePath: target.filePath,
            line: target.line,
            projectKey: project?.id ?? undefined,
            projectName: project?.name ?? undefined,
          });
        break;
      }
      case 'read-diagnosis':
      case 'diagnose':
        await handlers.scrollToSection('diagnosis');
        break;
      case 'reproduce':
        await handlers.scrollToSection('reproduce');
        break;
      case 'attempts-tab':
        handlers.selectAttemptsTab();
        break;
      case 'quarantine':
        await handlers.quarantine(payload);
        break;
      case 'rerun-in-ci':
        await handlers.rerunInCi();
        break;
      case 'copy-recipe': {
        const recipe = handlers.reproRecipe();
        if (recipe) copyPlain(reproScript(recipe, 'bash'), { toast: 'Recipe copied' });
        break;
      }
      case 'copy-ai-prompt':
        await copyPrompt(handlers.diagnosisContextEndpoint());
        break;
      case 'copy-flake-command':
        if (typeof payload?.command === 'string') copyPlain(payload.command, { toast: 'Lab command copied' });
        break;
      case 'flake-lab-ci':
        if (typeof payload?.testCaseId === 'number') await runFlakeLabInCi(payload.testCaseId, String(payload.kind));
        break;
      case 'flakiness-tab': {
        if (typeof payload?.testCaseId !== 'number') break;
        const suspect = typeof payload.suspect === 'string' ? payload.suspect : undefined;
        await navigateTo({ path: `/test-cases/${payload.testCaseId}`, query: { tab: 'flakiness', suspect } });
        break;
      }
      case 'configure-ai':
        await navigateTo('/settings/ai');
        break;
      case 'what-changed':
        await handlers.whatChanged();
        break;
      case 're-diagnose':
        await handlers.reDiagnose();
        break;
    }
  }

  return { handle };
}
