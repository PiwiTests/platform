import { getDatabase } from '../../../../database';
import { requireProjectAccess, requireRouteId } from '../../../../utils/project-access';
import { readProjectIntegration } from '../../../../utils/integrations/binding';
import { previewProjectAutoCreate } from '../../../../utils/integrations/automation';
import { resolveProjectIntegration, type ResolvedProjectIntegration } from '#shared/integrations/binding';

defineRouteMeta({
  openAPI: {
    tags: ['Integrations'],
    summary: 'Preview automatic issue creation',
    description:
      "Evaluate the project's open clusters that no tracker issue tracks against the automatic-creation rules — the stored binding's, or the binding in the body, such as a settings form not saved yet. Each cluster comes with what automatic creation does with it (files it at its next failure in a run a rule counts, waits, or leaves it) and why, alongside the issues filed automatically in the last 24 hours and the tracker fields an automatic create would leave empty. Writes nothing. Requires `project:manage` (Project admin on the project).",
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-permission': 'project:manage',
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, id);
  const db = await getDatabase();

  const body = (await readBody(event).catch(() => null)) as Partial<ResolvedProjectIntegration> | null;
  const binding =
    body && typeof body === 'object' && Object.keys(body).length > 0
      ? resolveProjectIntegration(body)
      : await readProjectIntegration(db, id);
  return previewProjectAutoCreate(db, id, binding);
});
