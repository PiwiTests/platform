// Report a fix attempt on a failure cluster: a patch, a locator edit or the fix
// plan carried out, on a commit or a branch. It is recorded `applied`; fix
// verification records `verified` when the cluster's fix lands with it. The MCP
// tool `report_fix_attempt` calls the same handler.
import { parseFixAttempt } from '#shared/fix-attempts';
import { FIX_ATTEMPT_ERRORS, reportFixAttempt } from '#shared/handlers/fix-attempts';
import { requireResolvedProjectAccess, requireRouteId, resolveClusterProjectId } from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'Report a fix attempt',
    description:
      'Records that a change was made to fix this cluster, as the `applied` outcome of a `fix-attempt` hand-back. `kind` is `patch`, `locator-edit` or `fix-plan`; pass the `commit` or the `branch` the change is on, a `patchHash` (or the `patch`, stored as its hash) or the `edit` (filePath, line, from, to; required for a locator edit), and the `diagnosisId` it followed. When the cluster stops failing, fix verification records `verified` on the attempt it can tie to the fix: by commit, by a `Piwi-Cluster: <id>` commit trailer, or by branch; a later failure records `regressed`. Reporting the same change twice records it once. `channel` names the surface reporting it (ui, editor, desktop, cli, ci; default ui).',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-permission': 'run:control',
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['kind'],
            properties: {
              kind: { type: 'string', enum: ['patch', 'locator-edit', 'fix-plan'] },
              commit: { type: 'string', description: 'The commit the change is in, 7 to 40 hex characters' },
              branch: { type: 'string', description: 'The branch the change is on' },
              patchHash: { type: 'string' },
              patch: { type: 'string', description: 'The unified diff applied; stored as its hash' },
              edit: {
                type: 'object',
                properties: {
                  filePath: { type: 'string' },
                  line: { type: 'integer' },
                  from: { type: 'string' },
                  to: { type: 'string' },
                },
              },
              diagnosisId: { type: 'integer' },
              note: { type: 'string' },
              channel: { type: 'string', enum: ['ui', 'editor', 'desktop', 'cli', 'ci'] },
            },
          },
        },
      },
    },
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'cluster ID');
  const { db, user } = await requireResolvedProjectAccess(event, id, resolveClusterProjectId, 'Failure cluster');

  const parsed = parseFixAttempt(await readBody(event));
  if (!parsed.ok) throw apiError({ statusCode: 400, message: parsed.message });

  const result = await reportFixAttempt(db, id, parsed.value, {
    channel: parsed.value.channel ?? 'ui',
    userId: user.id,
    apiKeyId: (event.context.apiKeyId as number | undefined) ?? null,
  });
  if (!result.ok) {
    const { status, message } = FIX_ATTEMPT_ERRORS[result.error];
    throw apiError({ statusCode: status, message });
  }
  return { ok: true, recorded: result.recorded, attempt: result.attempt };
});
