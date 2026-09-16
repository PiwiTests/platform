/**
 * Desktop shell only: after a folder is linked to a project, offer to import
 * the runs already sitting in its Playwright output folders.
 *
 * Linking a checkout is the moment the user first connects Piwi to a project
 * that may already have months of `blob-report/` and `test-results/` history.
 * This scans that folder once and, when it finds importable archives, raises a
 * one-shot proposal the dialog (`DesktopImportPreviousRunsModal`) renders — the
 * state is a singleton so it survives the navigation that follows creating a
 * project. A folder with nothing to import raises nothing.
 */
import type { DesktopLocalArchive } from '~/composables/useDesktopFolderInspect';

export interface DesktopPrevRunsProposal {
  /** Project the archives would import into. */
  projectName: string;
  /** The linked folder they were found in. */
  folder: string;
  /** Blob reports and traces discovered under it. */
  archives: DesktopLocalArchive[];
}

export function useDesktopImportPrevRuns() {
  const proposal = useState<DesktopPrevRunsProposal | null>('desktop-prev-runs-proposal', () => null);
  const open = useState<boolean>('desktop-prev-runs-open', () => false);

  /**
   * Scan a just-linked folder and, when it holds previous runs, open the dialog
   * offering to import them into `projectName`. No-op without the bridge, a
   * name or a folder, and silent when the folder has nothing to import.
   */
  async function propose(projectName: string | null | undefined, folder: string | null | undefined): Promise<void> {
    if (!tauriCore() || !projectName || !folder) return;
    const archives = await findDesktopImportableRuns(folder);
    if (archives.length === 0) return;
    proposal.value = { projectName, folder, archives };
    open.value = true;
  }

  return { proposal, open, propose };
}
