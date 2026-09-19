import { z } from 'zod';
import { getDatabase } from '../../../../database';
import { requireProjectAccess, requireRouteId } from '../../../../utils/project-access';
import { Role } from '#shared/types';
import { ingestProjectManifest } from '../../../../utils/surface-manifest';

defineRouteMeta({
  openAPI: {
    tags: ['Scenario gaps'],
    summary: 'Upload a project’s declared surface manifest',
    description:
      'Stores a declared-surface manifest — the routes and pages the application says it exposes — as graph nodes with origin `manifest` (from the instrumentation `/__piwi/manifest` or a committed `piwi.manifest.json`) or `openapi`. A declared route or page no test reaches becomes a "declared, never hit" gap. Reach is observed reach, never instrumented coverage.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter'],
  },
});

const manifestRouteSchema = z.object({
  method: z.string().min(1),
  pattern: z.string().min(1),
  handler: z.string().nullable().optional(),
  responses: z.array(z.number().int()).optional(),
});
const manifestPageSchema = z.object({
  pattern: z.string().min(1),
  name: z.string().nullable().optional(),
});
const uploadSchema = z.object({
  source: z.enum(['instrumentation', 'committed', 'openapi']),
  manifest: z.object({
    routes: z.array(manifestRouteSchema).max(5000).optional(),
    pages: z.array(manifestPageSchema).max(5000).optional(),
  }),
});

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, projectId, [Role.ADMINISTRATOR, Role.REPORTER]);
  const db = await getDatabase();

  const validation = uploadSchema.safeParse(await readBody(event));
  if (!validation.success) {
    throw apiError({ statusCode: 400, message: 'Invalid manifest', data: validation.error.issues });
  }

  const { source, manifest } = validation.data;
  const ingested = await ingestProjectManifest(db, projectId, manifest, source);
  return {
    success: ingested,
    routes: manifest.routes?.length ?? 0,
    pages: manifest.pages?.length ?? 0,
  };
});
