import { requireResolvedProjectAccess, requireRouteId, resolveBugReportProjectId } from '../../../utils/project-access';
import { apiError } from '../../../utils/api-error';
import { renderBugReportSpec, specDirSchema } from '#shared/handlers/bug-reports';

defineRouteMeta({
  openAPI: {
    tags: ['Bug reports'],
    summary: 'Render a bug report’s spec',
    description:
      'The Playwright spec written from the report’s steps with the project’s generated-spec settings, function catalog and suite locators. `mode=commit` (the default) writes the spec to commit now, with `test.fail()`, `@bug` and `piwi:bug <id>`; `mode=run` the same test without `test.fail()`, as a reproduction runs it. Answers `{ code, fileName, path, warnings, mode }`.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'mode', in: 'query', required: false, schema: { type: 'string', enum: ['commit', 'run'] } },
      {
        name: 'specDir',
        in: 'query',
        required: false,
        description:
          'The folder the spec is written to, relative to the repository root, when it is not the bugs folder: a relative `testImport`, written for the bugs folder, is rewritten for it.',
        schema: { type: 'string' },
      },
    ],
    'x-required-permission': 'project:read',
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'bug report ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveBugReportProjectId, 'Bug report');
  const query = getQuery(event);
  const mode = query.mode === 'run' ? 'run' : 'commit';
  const specDir = specDirSchema.safeParse(query.specDir);
  if (!specDir.success) throw apiError({ statusCode: 400, message: 'Invalid spec folder' });
  const spec = await renderBugReportSpec(db, id, mode, specDir.data);
  if (!spec) throw apiError({ statusCode: 404, message: 'Bug report not found' });
  return {
    mode: spec.mode,
    code: spec.code,
    fileName: spec.fileName,
    path: spec.path,
    warnings: spec.warnings,
    matchedSpans: spec.matchedSpans,
  };
});
