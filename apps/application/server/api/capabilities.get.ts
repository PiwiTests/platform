import { getDatabase } from '../database';
import { requireAuth } from '../utils/auth';
import { getInstanceCapabilities } from '#shared/handlers/capabilities';

defineRouteMeta({
  openAPI: {
    tags: ['System'],
    summary: 'Instance capability states',
    description:
      'The resolved state of every optional capability at instance level: `active` when evidence exists, `declined` when switched off, `available` when configured but unused, `not-applicable` when it cannot apply, `undecided` otherwise. Drives which capabilities the dashboard shows. Readable by any signed-in user.',
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  const db = await getDatabase();
  return getInstanceCapabilities(db);
});
