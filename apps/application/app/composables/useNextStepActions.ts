/**
 * The one place both failure pages turn a next-step action id into the real
 * behaviour. `NextStepLine` stays presentation-only and emits an id; the page
 * hands this composable the page-specific targets (its locator panel, its scroll
 * anchors, how it sets the cluster status, quarantines, re-runs) as callbacks,
 * and the composable owns the shared plumbing — the diagnosed patch's copy /
 * download / open-in-IDE, the recipe copy, the AI-prompt copy, the navigation —
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
   * Reveal and scroll to a toolbox section. The diagnosis, reproduce and
   * locator-fix actions all route through this one callback, so a page passes it
   * once rather than three identical scroll callbacks.
   */
  scrollToSection: (key: 'diagnosis' | 'reproduce' | 'locator-fix') => void;
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

export function useNextStepActions(handlers: NextStepActionHandlers) {
  const { copyGitApply, downloadPatch } = usePatchActions();
  const { copyPrompt } = useCopyAiPrompt();
  const { copy: copyPlain } = useCopy();
  const { openInIde } = useOpenInIde();

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
        handlers.locatorPanel()?.copyPatch();
        break;
      case 'copy-locator':
        handlers.locatorPanel()?.copyRecommendedLocator();
        break;
      case 'pick-from-snapshot':
        handlers.scrollToSection('locator-fix');
        handlers.locatorPanel()?.openPicker();
        break;
      case 'all-alternatives':
        handlers.scrollToSection('locator-fix');
        handlers.locatorPanel()?.expandAlternatives();
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
        handlers.scrollToSection('diagnosis');
        break;
      case 'reproduce':
        handlers.scrollToSection('reproduce');
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
