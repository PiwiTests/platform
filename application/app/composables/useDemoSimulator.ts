import { reactive } from 'vue';
import {
  DEMO_SCENARIOS,
  DEMO_SIMULATOR_INSTANCE_ID,
  DEMO_PROJECT_ID,
  runSimulation,
  type DemoScenario,
  type SimulationController,
} from '~/demo/simulator';

/**
 * Shared state for the demo run simulator (see app/demo/simulator.ts).
 *
 * Module-level singleton so the simulation keeps streaming while the visitor
 * navigates around the SPA, and every DemoSimulator instance renders the same
 * progress.
 */

interface DemoSimulatorState {
  status: 'idle' | 'running' | 'stopping';
  scenario: DemoScenario | null;
  runId: number | null;
  projectId: number | null;
  completed: number;
  failed: number;
  total: number;
}

const state = reactive<DemoSimulatorState>({
  status: 'idle',
  scenario: null,
  runId: null,
  projectId: null,
  completed: 0,
  failed: 0,
  total: 0,
});

let controller: SimulationController | null = null;
let staleRunsCancelled = false;

export function useDemoSimulator() {
  const toast = useToast();
  const { canAccessDemoProject } = useAuth();

  /**
   * Cancel runs orphaned by a page reload mid-simulation (their reporter
   * loop died with the page, so they would stay 'running' forever).
   */
  async function cancelStaleRuns(): Promise<void> {
    if (staleRunsCancelled) return;
    staleRunsCancelled = true;
    try {
      await $fetch('/api/demo/cancel-stale-runs', {
        method: 'POST',
        body: { instanceId: DEMO_SIMULATOR_INSTANCE_ID },
      });
    } catch {
      // Non-critical cleanup — ignore
    }
  }

  async function start(scenario: DemoScenario): Promise<void> {
    if (state.status !== 'idle') return;

    // Simulated runs land in the demo's e2e-checkout project. If the active
    // "act as" identity isn't assigned to it, refuse rather than dropping the
    // visitor into a project they shouldn't see — and explain why.
    if (!canAccessDemoProject(DEMO_PROJECT_ID)) {
      toast.add({
        title: 'No access to this project',
        description:
          'Simulated runs target the “e2e-checkout” project, which the current user isn’t assigned to. Switch to a user with access (e.g. the admin) to run a simulation.',
        color: 'warning',
        icon: 'i-lucide-lock',
      });
      return;
    }

    state.status = 'running';
    state.scenario = scenario;
    state.runId = null;
    state.projectId = null;
    state.completed = 0;
    state.failed = 0;
    state.total = 0;
    controller = { stopped: false };

    try {
      const { runId, status } = await runSimulation(
        scenario,
        {
          onRunCreated: (runId, projectId) => {
            state.runId = runId;
            state.projectId = projectId;
            // Bring the visitor to the run page so they watch it arrive live
            navigateTo(`/test-runs/${runId}`);
          },
          onProgress: (completed, failed, total) => {
            state.completed = completed;
            state.failed = failed;
            state.total = total;
          },
        },
        controller,
      );

      toast.add({
        title: `Simulated run #${runId} ${status}`,
        description: 'Sent by an emulated Piwi reporter, straight into the in-browser database.',
        color: status === 'passed' ? 'success' : status === 'failed' ? 'error' : 'warning',
        icon: scenario.icon,
      });
    } catch (error) {
      console.error('[Demo simulator] simulation failed', error);
      toast.add({ title: 'Simulation failed', description: 'See the browser console for details.', color: 'error' });
    } finally {
      state.status = 'idle';
      state.scenario = null;
      controller = null;
    }
  }

  function stop(): void {
    if (controller && state.status === 'running') {
      controller.stopped = true;
      state.status = 'stopping';
    }
  }

  return { state, scenarios: DEMO_SCENARIOS, start, stop, cancelStaleRuns };
}
