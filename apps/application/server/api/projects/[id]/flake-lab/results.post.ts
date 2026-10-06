import { z } from 'zod';
import { FlakeResultsRejected, recordFlakeResults } from '#shared/handlers/flake-lab';
import { requireProjectAccess, requireRouteId } from '../../../../utils/project-access';
import { getDatabase } from '../../../../database';

defineRouteMeta({
  openAPI: {
    tags: ['Test Cases'],
    summary: 'Record the results of a flake-lab experiment',
    description:
      'Stores the arms of an experiment the flake plan recorded, as `piwi flake` measured them: each arm’s id, conditions, runs, matching failures (same error signature as history), other failures, discarded rounds and whether it stopped early. The server computes each arm’s verdict against the control with the one-sided Fisher exact test (reproduced at a rate of at least half with p < 0.05, amplified at p < 0.05 below it), or, for a verify experiment, whether the rerun arm stayed clean for enough runs that a failure at the reproduced rate would have shown with 95% confidence (⌈ln 0.05 / ln(1 − rate)⌉, at least 5). The experiment must be unfinished (409 otherwise). Requires a reporter API key.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-permission': 'run:submit',
  },
});

const count = z.number().int().min(0).max(10_000);

const armSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().max(512).nullable().optional(),
  suspectId: z.string().max(512).nullable().optional(),
  conditions: z.array(z.unknown()).max(20),
  runs: count,
  matchingFailures: count,
  otherFailures: count,
  discardedRounds: count.optional(),
  stoppedEarly: z.boolean().optional(),
});

const bodySchema = z.object({
  experimentId: z.union([z.string().min(1).max(32), z.number().int()]).transform(String),
  commit: z.string().max(64).nullable().optional(),
  playwrightProject: z.string().max(256).nullable().optional(),
  arms: z.array(armSchema).min(1).max(20),
});

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');
  const user = await requireProjectAccess(event, projectId);

  const validation = bodySchema.safeParse(await readBody(event));
  if (!validation.success) {
    throw apiError({ statusCode: 400, message: 'Invalid flake-lab results', data: validation.error.issues });
  }
  const db = await getDatabase();
  try {
    return await recordFlakeResults(db, projectId, validation.data, { actor: { channel: 'cli', userId: user.id } });
  } catch (error) {
    if (error instanceof FlakeResultsRejected) throw apiError({ statusCode: error.statusCode, message: error.message });
    throw error;
  }
});
