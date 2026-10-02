import { getRunResourceTimeline } from '#shared/handlers/run-resources';
import { requireResolvedProjectAccess, requireRouteId, resolveRunProjectId } from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Run resources over time',
    description:
      "Returns what a run's reporters measured over time, as the run's workers timeline draws it: `parts`, one per reporter that sent it (one per shard of a sharded run). Each part's `timeline` counts from `startedAt`, epoch milliseconds on the clock of the reporter's machine, which the tests' start times use too, and holds `[ms after startedAt, value]` points: `cpuPct`, the machine's busy CPU share; `memoryBytes`, what the run's processes held in memory, measured as `memoryKind` says (PSS, or RSS where PSS could not be read); and `pages`, the pages open in each worker (Playwright's worker index) at each change. `memoryCapacityBytes` is the machine's memory, or its container's limit when lower. `executions` holds what each execution cost from its test's start to its end, as its worker measured it with the capture fixtures: `cpuMs`, the CPU of the worker process and of the browser processes it started; `runWaitMs`, the time those browser processes waited for a CPU (Linux, else null); and `peakRssMb`, the largest browser process at its peak. Both lists are empty when no reporter sent them, or when the project declined the resources capability.",
    'x-required-roles': ['administrator', 'reporter', 'user'],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  },
});

export default eventHandler(async (event) => {
  const runId = requireRouteId(event, 'id', 'run ID');
  const { db } = await requireResolvedProjectAccess(event, runId, resolveRunProjectId, 'Run');
  const timeline = await getRunResourceTimeline(db, runId);
  if (!timeline) throw apiError({ statusCode: 404, message: 'Run not found' });
  return timeline;
});
