// Record a diagnosis an agent wrote on one failing execution: the same JSON a
// model returns to Piwi, stored with the provider `agent` and the model the
// agent names. The MCP tool `record_diagnosis` calls the same handler.
import { AGENT_DIAGNOSIS_ERRORS, AGENT_DIAGNOSIS_STATUS, parseAgentDiagnosis } from '#shared/agent-diagnosis';
import {
  requireResolvedProjectAccess,
  requireRouteId,
  resolveTestRunCaseProjectId,
} from '../../../utils/project-access';
import { recordAgentDiagnosisOn } from '../../../utils/agent-diagnosis';

defineRouteMeta({
  openAPI: {
    tags: ['Test Run Cases'],
    summary: "Record an agent's diagnosis of a failure",
    description:
      "Stores a diagnosis an agent wrote as the execution's current diagnosis (execution scope), after snapshotting the previous one into its history. The body carries the `model` the agent ran on and the `diagnosis` in the JSON schema Piwi asks a model for (summary, confidenceScore, severity, affectedArea, hypotheses, suggestedFix, investigationSteps, preventionTips). The suggested patch is validated against the source at the commit of the execution's run when source control is connected. Works with no AI provider configured; 403 when the `agent-diagnoses` capability is declined, 409 while a diagnosis of the execution is running. `channel` names the surface reporting it (ui, editor, desktop, cli, ci; default ui).",
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' }, description: 'Test run case id' },
    ],
    'x-required-permission': 'ai:run',
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['model', 'diagnosis'],
            properties: {
              model: { type: 'string', description: 'The model the agent ran on' },
              diagnosis: { type: 'object', description: 'The diagnosis, in the schema Piwi asks a model for' },
              channel: { type: 'string', enum: ['ui', 'editor', 'desktop', 'cli', 'ci'] },
            },
          },
        },
      },
    },
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'test run case ID');
  const { db, user } = await requireResolvedProjectAccess(event, id, resolveTestRunCaseProjectId, 'Test run case');

  const parsed = parseAgentDiagnosis(await readBody(event));
  if (!parsed.ok) throw apiError({ statusCode: 400, message: parsed.message });

  const result = await recordAgentDiagnosisOn(db, { scope: 'execution', executionId: id }, parsed.value, {
    channel: parsed.value.channel ?? 'ui',
    userId: user.id,
    apiKeyId: (event.context.apiKeyId as number | undefined) ?? null,
  });
  if (!result.ok) {
    throw apiError({
      statusCode: AGENT_DIAGNOSIS_STATUS[result.error],
      message: AGENT_DIAGNOSIS_ERRORS.execution[result.error],
    });
  }
  return { ok: true, diagnosisId: result.diagnosisId, patchValidation: result.patchValidation };
});
