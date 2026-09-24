import { parseTestRunPatch, patchTestRun } from '#shared/handlers/test-runs';
import { Role } from '#shared/types';
import { requireResolvedProjectAccess, requireRouteId, resolveRunProjectId } from '../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Update a test run',
    description:
      "Updates a test run's label, or keeps it forever. `keep: true` exempts the run from retention (the nightly sweep and the manual cleanup never delete it) and records who kept it, with an optional `keepReason`; keeping a kept run only replaces its reason. `keep: false` releases the run back to retention and requires the administrator role. Any other update requires any authenticated user.",
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              label: { type: 'string', nullable: true },
              keep: { type: 'boolean', description: 'true keeps the run forever; false releases it (administrator)' },
              keepReason: {
                type: 'string',
                nullable: true,
                description: 'Why the run is kept (up to 200 characters); only accepted with keep: true',
              },
            },
          },
        },
      },
    },
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'test run ID');
  const { db, user } = await requireResolvedProjectAccess(event, id, resolveRunProjectId, 'Test run');

  const patch = parseTestRunPatch(await readBody(event));
  if (typeof patch === 'string') {
    throw apiError({ statusCode: 400, message: patch });
  }
  if (patch.keep === false && user.role !== Role.ADMINISTRATOR) {
    throw apiError({ statusCode: 403, message: 'Only an administrator can release a kept run' });
  }

  try {
    return await patchTestRun(db, id, patch, { userId: user.id || null });
  } catch (err: any) {
    if (err?.message === 'Test run not found') {
      throw apiError({ statusCode: 404, message: 'Test run not found' });
    }
    throw err;
  }
});
