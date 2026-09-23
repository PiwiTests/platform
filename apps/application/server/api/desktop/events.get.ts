import { requireAuth } from '../../utils/auth';
import { getDatabase } from '../../database';
import { getProjectScope, scopeAllows } from '../../utils/project-access';
import { runEventBus } from '../../utils/run-events';
import { createSSEEndpoint } from '../../utils/sse';
import { subscribeDesktopOpenRequests } from '../../utils/desktop-handoff';
import { getActiveTestRuns } from '#shared/handlers/test-runs';

defineRouteMeta({
  openAPI: {
    tags: ['Stream'],
    summary: 'Desktop window event stream (desktop shell)',
    description:
      'Server-sent events for the desktop app window. Run progress, for the OS-level display (taskbar/Dock/tray): on connect a `snapshot` of the currently-active runs with their counts, then run lifecycle events and live progress tallies for every run in the caller scope — so a run the user is only watching (reported from CI or a terminal), not just one launched from the app, drives the progress. Page requests: an `open-page` message with the app-relative `path` of a dashboard link the user opened in the system browser, which the window shows. Run events are scoped to the caller like the global run stream; in the desktop build (auth off) that is the whole instance.',
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  const db = await getDatabase();
  const scope = await getProjectScope(db, user);

  return createSSEEndpoint(event, (controller, encoder) => {
    const send = (payload: unknown) => {
      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      } catch {
        // Stream closed — the SSE helper handles unsubscribe.
      }
    };

    // Subscribe first so no event is missed while the snapshot query runs; the
    // client upserts by run id, so a run appearing in both reconciles cleanly.
    const unsubscribeLifecycle = runEventBus.subscribeGlobal((globalEvent) => {
      if (!scopeAllows(scope, globalEvent.projectId)) return;
      send(globalEvent);
    });
    const unsubscribeProgress = runEventBus.subscribeRunProgress((progress) => {
      if (!scopeAllows(scope, progress.projectId)) return;
      send({ type: 'run-progress', ...progress });
    });
    const unsubscribeOpenRequests = subscribeDesktopOpenRequests((path) => {
      send({ type: 'open-page', path });
    });

    // Initial catch-up: the runs already in flight when the shell connects.
    void (async () => {
      try {
        const runs = await getActiveTestRuns(db, scope);
        send({ type: 'snapshot', runs });
      } catch {
        // A failed snapshot just means no initial runs; deltas still stream.
      }
    })();

    return () => {
      unsubscribeLifecycle();
      unsubscribeProgress();
      unsubscribeOpenRequests();
    };
  });
});
