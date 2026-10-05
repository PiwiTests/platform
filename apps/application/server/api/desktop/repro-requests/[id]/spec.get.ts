import { z } from 'zod';
import { requireProjectAccess } from '../../../../utils/project-access';
import { apiError } from '../../../../utils/api-error';
import { getDatabase } from '../../../../database';
import { getReproRequest } from '../../../../utils/desktop-repro';
import { renderStepsRunSpec, specDirSchema } from '#shared/handlers/bug-reports';
import { withReproResultHook } from '#shared/desktop-repro';

defineRouteMeta({
  openAPI: {
    tags: ['System'],
    summary: 'Render a repro request’s spec for a project (desktop app)',
    description:
      'Desktop build only — 404 on the server build. The request’s steps written as the Playwright spec a reproduction runs (no `test.fail()`), with the project’s generated-spec settings, function catalog and suite locators, followed by a hook that records how the test ended in the file `PIWI_REPRO_RESULT` names. Answers `{ code, stepLines, warnings }`; the shell writes `code` under the project’s test directory and runs it. 409 unless the request is running.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'projectId', in: 'query', required: true, schema: { type: 'integer' } },
      {
        name: 'specDir',
        in: 'query',
        required: false,
        description:
          'The folder the shell writes the spec to, relative to the repository root: a relative `testImport`, written for the bugs folder, is rewritten for it.',
        schema: { type: 'string' },
      },
    ],
    'x-required-permission': 'project:read',
  },
});

export default eventHandler(async (event) => {
  if (!process.env.PIWI_DESKTOP_TOKEN) {
    throw apiError({ statusCode: 404, message: 'Desktop build only' });
  }
  const projectId = z.coerce.number().int().positive().safeParse(getQuery(event).projectId);
  if (!projectId.success) throw apiError({ statusCode: 400, message: 'Invalid project ID' });
  await requireProjectAccess(event, projectId.data);
  const request = getReproRequest(getRouterParam(event, 'id') ?? '');
  if (!request?.steps) throw apiError({ statusCode: 404, message: 'Repro request not found' });
  // Rendered once the developer started it in the window, never before.
  if (request.status !== 'running') {
    throw apiError({ statusCode: 409, message: 'The repro request is not running' });
  }
  const specDir = specDirSchema.safeParse(getQuery(event).specDir);
  if (!specDir.success) throw apiError({ statusCode: 400, message: 'Invalid spec folder' });
  const spec = await renderStepsRunSpec(await getDatabase(), projectId.data, request.steps, specDir.data);
  if (!spec) throw apiError({ statusCode: 404, message: 'Project not found' });
  return { code: withReproResultHook(spec.code), stepLines: spec.stepLines, warnings: spec.warnings };
});
