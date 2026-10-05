import { getDatabase } from '../../database';
import { requireAuth } from '../../utils/auth';
import { listGroupItems } from '#shared/handlers/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Groups'],
    summary: 'List groups',
    description:
      'Returns every group with its description and member count, by name. A group receives project roles like a user does, and its members hold them. Administrators manage groups; a Project admin reads the list to add a group to their project.',
    'x-required-permission': ['groups:manage', 'project:members'],
  },
});

export default eventHandler(async (event) => {
  // The early check let in an administrator or someone holding project:members on a project; both see every group.
  await requireAuth(event);
  return { groups: await listGroupItems(await getDatabase()) };
});
