/**
 * Demo-mode notification simulator.
 *
 * After a user subscribes to a project in the demo, this composable fires
 * periodic toast notifications that look like real notification emails so the
 * feature can be evaluated without a live backend.
 *
 * Timers are stored in a module-level Map so they survive component
 * mount/unmount cycles during navigation.
 */

// Module-level: survives component re-renders and page navigation
const activeTimers = new Map<number, ReturnType<typeof setTimeout>>();
const scenarioIndex = new Map<number, number>();

interface Scenario {
  title: string;
  description: string;
  icon: string;
  color: 'error' | 'warning' | 'success' | 'info';
}

function buildScenarios(projectLabel: string, events: string[]): Scenario[] {
  const all: Array<{ event: string; scenario: Scenario }> = [
    {
      event: 'run.failed',
      scenario: {
        title: `Test run failed — ${projectLabel}`,
        description: '3 of 12 tests failed on main',
        icon: 'i-lucide-circle-x',
        color: 'error',
      },
    },
    {
      event: 'run.failed.default_branch',
      scenario: {
        title: `Test run failed on main — ${projectLabel}`,
        description: '2 of 12 tests failed · branch: main',
        icon: 'i-lucide-circle-x',
        color: 'error',
      },
    },
    {
      event: 'cluster.new',
      scenario: {
        title: `New failure cluster — ${projectLabel}`,
        description: 'TimeoutError: locator.click: Timeout 30000ms exceeded',
        icon: 'i-lucide-layers',
        color: 'warning',
      },
    },
    {
      event: 'flakiness.spike',
      scenario: {
        title: `Flakiness spike — ${projectLabel}`,
        description: '3 tests became flaky (8.3% rate)',
        icon: 'i-lucide-shuffle',
        color: 'warning',
      },
    },
    {
      event: 'perf.regression',
      scenario: {
        title: `Performance regression — ${projectLabel}`,
        description: 'p90 duration increased by 42% vs last week',
        icon: 'i-lucide-trending-down',
        color: 'warning',
      },
    },
    {
      event: 'run.finished',
      scenario: {
        title: `Test run recovered — ${projectLabel}`,
        description: 'All 12 tests passed on main',
        icon: 'i-lucide-circle-check',
        color: 'success',
      },
    },
  ];

  const matched = all.filter((s) => events.length === 0 || events.includes(s.event)).map((s) => s.scenario);
  // Always include at least the basic failed/recovered pair for a meaningful demo
  if (matched.length === 0) {
    return [all[0]!.scenario, all[all.length - 1]!.scenario];
  }
  return matched;
}

export function useDemoNotifications() {
  const config = useRuntimeConfig();
  if (!config.public.demoMode) return null;

  const toast = useToast();

  function scheduleFor(projectId: number, projectLabel: string, events: string[]): void {
    cancelFor(projectId);

    const scenarios = buildScenarios(projectLabel, events);
    scenarioIndex.set(projectId, 0);

    function fire() {
      const idx = (scenarioIndex.get(projectId) ?? 0) % scenarios.length;
      scenarioIndex.set(projectId, idx + 1);
      const s = scenarios[idx]!;

      toast.add({
        title: s.title,
        description: s.description,
        icon: s.icon,
        color: s.color,
        duration: 7000,
      });

      // Next notification: 25–35 s
      const delay = 25_000 + Math.random() * 10_000;
      activeTimers.set(projectId, setTimeout(fire, delay));
    }

    // First notification after 8 s
    activeTimers.set(projectId, setTimeout(fire, 8_000));
  }

  function cancelFor(projectId: number): void {
    const timer = activeTimers.get(projectId);
    if (timer !== undefined) {
      clearTimeout(timer);
      activeTimers.delete(projectId);
    }
    scenarioIndex.delete(projectId);
  }

  return { scheduleFor, cancelFor };
}
