import { getDatabase } from '../../database';
import { projects } from '../../database/schema';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../../utils/auth';
import { checkExistingBlobs } from '../../utils/trace-blobs';

defineRouteMeta({
  openAPI: {
    tags: ['Traces'],
    summary: 'Check trace blob existence',
    description:
      'Checks which trace blob SHA-256 hashes already exist in storage for a given project. Accepts projectName and hashes array in the request body.',
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event, ['reporter', 'administrator']);

  const body = await readBody(event);
  const projectName = body?.projectName as string | undefined;
  const hashes = body?.hashes as unknown[] | undefined;

  if (!projectName || typeof projectName !== 'string') {
    throw createError({ statusCode: 400, message: 'Missing projectName' });
  }
  if (!Array.isArray(hashes)) {
    throw createError({ statusCode: 400, message: 'hashes must be an array' });
  }

  // Validate: only accept well-formed SHA-256 hex strings
  const validHashes = hashes.filter((h): h is string => typeof h === 'string' && /^[0-9a-f]{64}$/i.test(h));

  const db = await getDatabase();
  const projectRows = await db.select({ id: projects.id }).from(projects).where(eq(projects.name, projectName));
  const project = projectRows[0];

  // Unknown project → all hashes are missing
  if (!project) {
    return { existing: [], missing: validHashes };
  }

  const existingSet = await checkExistingBlobs(project.id, validHashes);
  return {
    existing: validHashes.filter((h) => existingSet.has(h)),
    missing: validHashes.filter((h) => !existingSet.has(h)),
  };
});
