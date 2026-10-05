import { getDatabase } from '../../../database';
import { getRequestAccess } from '../../../utils/auth';
import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { accessRefusal, getProjectMembersResponse } from '#shared/handlers/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'Get project members',
    description:
      'Returns every user and group holding a role on this project, one row per role and where it comes from (`source`): `direct`, a binding on this project (what `PUT` replaces); `all-projects`, a binding on all projects; `group`, a binding of a group the user belongs to (`groupName`); `administrator`, the instance role, which opens every project (shown as Project admin). Groups come first, then users, by name. `canManage` says whether the caller may change the direct bindings and `grantableRoles` which roles they may grant.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-permission': 'project:members',
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, id);

  try {
    return await getProjectMembersResponse(await getDatabase(), id, await getRequestAccess(event));
  } catch (err) {
    const refusal = accessRefusal(err);
    if (refusal) throw apiError(refusal);
    throw err;
  }
});
