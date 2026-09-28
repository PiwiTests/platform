import { requireResolvedProjectAccess, requireRouteId, resolveBugReportProjectId } from '../../../utils/project-access';
import { apiError } from '../../../utils/api-error';
import { renderBugReportSpec } from '#shared/handlers/bug-reports';

defineRouteMeta({
  openAPI: {
    tags: ['Bug reports'],
    summary: 'Render a bug report’s spec',
    description:
      'The Playwright spec written from the report’s steps with the project’s generated-spec settings, function catalog and suite locators. `mode=commit` (the default) writes the spec to commit now, with `test.fail()`, `@bug` and `piwi:bug <id>`; `mode=run` the same test without `test.fail()`, as a reproduction runs it. Answers `{ code, fileName, path, warnings, mode }`.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'mode', in: 'query', required: false, schema: { type: 'string', enum: ['commit', 'run'] } },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'bug report ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveBugReportProjectId, 'Bug report');
  const mode = getQuery(event).mode === 'run' ? 'run' : 'commit';
  const spec = await renderBugReportSpec(db, id, mode);
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
