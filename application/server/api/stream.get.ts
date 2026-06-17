import { requireAuth } from '../utils/auth';
import { runEventBus } from '../utils/run-events';
import { createSSEEndpoint } from '../utils/sse';
import { Role } from '../../shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Stream'],
    summary: 'Server-sent events stream',
    description: 'Subscribes to global run events (status changes, case updates) over SSE',
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  return createSSEEndpoint(event, (controller, encoder) => {
    return runEventBus.subscribeGlobal((globalEvent) => {
      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(globalEvent)}\n\n`));
      } catch {
        // Stream closed — unsubscribe is handled by SSE helper
      }
    });
  });
});
