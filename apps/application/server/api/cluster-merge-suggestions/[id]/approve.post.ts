import { requireResolvedProjectAccess, requireRouteId } from '../../../utils/project-access';
import {
  approveMergeSuggestion,
  getMergeSuggestionPair,
  getSuggestionProjectId,
} from '#shared/handlers/cluster-merge-suggestions';
import { enqueueMergePolicies } from '../../../utils/integrations/policies';

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'Approve a cluster merge suggestion',
    description:
      'Merges the two suggested clusters (lower id survives) and consumes the suggestion. Requires reporter or administrator role.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'suggestion ID');
  const { db } = await requireResolvedProjectAccess(event, id, getSuggestionProjectId, 'Suggestion');

  // The merge-comment policy reads both tickets before the merge deletes the
  // victim (its link is inherited by the survivor during the merge).
  const pair = await getMergeSuggestionPair(db, id);
  if (pair) {
    await enqueueMergePolicies(db, pair).catch((e) => console.error('[integrations] merge policy failed', e));
  }

  const result = await approveMergeSuggestion(db, id);
  if (!result) throw apiError({ statusCode: 409, message: 'Suggestion is not pending' });
  return { success: true, ...result };
});
