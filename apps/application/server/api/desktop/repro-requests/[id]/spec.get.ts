import { z } from 'zod';
import { requireProjectAccess } from '../../../../utils/project-access';
import { apiError } from '../../../../utils/api-error';
import { getDatabase } from '../../../../database';
import { getReproRequest } from '../../../../utils/desktop-repro';
import { renderStepsRunSpec } from '#shared/handlers/bug-reports';
import { withReproResultHook } from '#shared/desktop-repro';

defineRouteMeta({
  openAPI: {
    tags: ['System'],
    summary: 'Render a repro request’s spec for a project (desktop app)',
    description:
      'Desktop build only — 404 on the server build. The request’s steps written as the Playwright spec a reproduction runs (no `test.fail()`), with the project’s generated-spec settings, function catalog and suite locators, followed by a hook that records how the test ended in the file `PIWI_REPRO_RESULT` names. Answers `{ code, stepLines, warnings }`; the shell writes `code` under the project’s test directory and runs it.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'projectId', in: 'query', required: true, schema: { type: 'integer' } },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
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
  if (!request) throw apiError({ statusCode: 404, message: 'Repro request not found' });
  const spec = await renderStepsRunSpec(await getDatabase(), projectId.data, request.steps);
  if (!spec) throw apiError({ statusCode: 404, message: 'Project not found' });
  return { code: withReproResultHook(spec.code), stepLines: spec.stepLines, warnings: spec.warnings };
});
