import { FLAKE_EXPERIMENTS_MAX, listFlakeExperiments } from '#shared/handlers/flake-lab';
import { getVerifiedFixes } from '#shared/handlers/flake-verified';
import { requireResolvedProjectAccess, requireRouteId, resolveCaseProjectId } from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Test Cases'],
    summary: 'Flake-lab experiments of a test case',
    description: `The test’s finished \`piwi flake\` and \`piwi flake verify\` experiments, newest first (at most ${FLAKE_EXPERIMENTS_MAX}): kind, verdict (reproduce: \`reproduced\`, \`amplified\`, \`not-reproduced\`; verify: \`verified\`, \`still-fails\`, \`inconclusive\`), the commit it ran and the commit of the failures, source, machine, Playwright project, and each arm with its conditions, runs, matching and other failures, discarded rounds, whether it stopped early, and the p-value and verdict the server computed against the control. \`verifiedFix\` is the verify experiment that marks the test verified fixed (\`{ testCaseId, experimentId, commit, verifiedAt, flakedAgainAt }\`, \`flakedAgainAt\` set once it retry-passed in a run started after \`verifiedAt\`), or null.`,
    'x-required-roles': ['administrator', 'reporter', 'user'],
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'limit', in: 'query', required: false, schema: { type: 'integer', default: 20 } },
    ],
  },
});

export default eventHandler(async (event) => {
  const testCaseId = requireRouteId(event, 'id', 'test case ID');
  const { db } = await requireResolvedProjectAccess(event, testCaseId, resolveCaseProjectId, 'Test case');
  const limit = Number(getQuery(event).limit) || undefined;
  return {
    items: await listFlakeExperiments(db, testCaseId, { limit }),
    verifiedFix: (await getVerifiedFixes(db, [testCaseId])).get(testCaseId) ?? null,
  };
});
