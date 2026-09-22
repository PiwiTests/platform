import { getDatabase } from '../database';
import { requireAuth } from '../utils/auth';
import { getSetupStatus } from '#shared/handlers/setup-status';

defineRouteMeta({
  openAPI: {
    tags: ['System'],
    summary: 'Setup and capability status',
    description:
      "Reports which of Piwi's optional capabilities show evidence of being active on this instance (results arriving, capture fixtures installed, locator healing, clustering, AI diagnosis, notifications, SCM, tags, markers, quarantine). Evidence-based rather than config-based: a configured-but-unused capability reads as inactive. Drives the Setup page's checklist. Requires administrator role.",
    'x-required-roles': ['administrator'],
  },
});

export default eventHandler(async (event) => {
  // Admin-only: the response describes how this instance is configured — whether
  // an AI provider and an SCM token are set up, whether notifications are wired.
  // That is deployment shape, not test data, so it follows the Setup page's role
  // rather than staying readable by any authenticated user. `requireAuth` reads
  // the role from `x-required-roles` above and returns a virtual admin when auth
  // is disabled.
  await requireAuth(event);
  const db = await getDatabase();
  const appVersion = useRuntimeConfig(event).public.appVersion as string | undefined;
  return getSetupStatus(db, appVersion);
});
