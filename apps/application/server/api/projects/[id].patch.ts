import { getDatabase } from '../../database';
import { z } from 'zod';
import { requireProjectAccess, requireRouteId } from '../../utils/project-access';
import { updateProject } from '#shared/handlers/projects';
import { encryptSecret, getEncryptionKey } from '../../utils/crypto';
import { resolveCiRerunSettings, type CiRerunSettings } from '#shared/ci-rerun';
import { resolveServerProbeSettings } from '#shared/server-probes';
import { projectTargetsSchema } from '#shared/analytics/targets';

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'Update a project',
    description:
      'Updates project metadata including label, description, diagnosis instructions, SCM token, targets, and tags. Requires administrator role.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator'],
  },
});

const ciRerunSchema = z.object({
  enabled: z.boolean().optional(),
  github: z.object({ workflow: z.string(), ref: z.string(), inputName: z.string() }).partial().optional(),
  gitlab: z.object({ ref: z.string(), variableName: z.string() }).partial().optional(),
  bitbucket: z.object({ pipeline: z.string(), variableName: z.string() }).partial().optional(),
});

const updateProjectSchema = z.object({
  label: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  diagnosisInstructions: z.string().optional().nullable(),
  aiLanguage: z.string().max(60).optional().nullable(),
  scmToken: z.string().optional().nullable(),
  defaultBranch: z.string().optional().nullable(),
  openApiUrl: z.string().url().max(2000).optional().nullable().or(z.literal('')),
  serverProbes: z
    .object({
      enabled: z.boolean().optional(),
      faults: z.array(z.string()).optional(),
      routes: z.array(z.string()).optional(),
      dependencyOnStateChanging: z.boolean().optional(),
    })
    .optional()
    .nullable(),
  ciRerun: ciRerunSchema.optional().nullable(),
  /** Per-project targets on catalog metrics; null clears them. */
  targets: projectTargetsSchema.optional().nullable(),
  tagIds: z.array(z.number()).optional(),
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');

  // Require administrator role for updating projects
  await requireProjectAccess(event, id);

  const db = await getDatabase();

  // Parse and validate request body
  const body = await readBody(event);
  const validation = updateProjectSchema.safeParse(body);

  if (!validation.success) {
    throw apiError({
      statusCode: 400,
      message: 'Invalid request body',
      data: validation.error.issues,
    });
  }

  const {
    label,
    description,
    diagnosisInstructions,
    aiLanguage,
    scmToken,
    defaultBranch,
    openApiUrl,
    serverProbes,
    ciRerun,
    targets,
    tagIds,
  } = validation.data;

  // Encrypt SCM token before persisting; null/empty clears the stored value
  const encryptedScmToken =
    scmToken != null && scmToken.trim() ? encryptSecret(scmToken.trim(), getEncryptionKey()) : scmToken;

  // Normalize the CI re-run config (drops empty targets); null clears it.
  const resolvedCiRerun =
    ciRerun === undefined
      ? undefined
      : ciRerun === null
        ? null
        : resolveCiRerunSettings(ciRerun as Partial<CiRerunSettings>);

  try {
    return await updateProject(db, id, {
      label,
      description,
      diagnosisInstructions,
      aiLanguage,
      scmToken: encryptedScmToken,
      defaultBranch: defaultBranch != null ? defaultBranch.trim() || null : defaultBranch,
      openApiUrl: openApiUrl != null ? openApiUrl.trim() || null : openApiUrl,
      serverProbes:
        serverProbes === undefined
          ? undefined
          : serverProbes === null
            ? null
            : resolveServerProbeSettings(serverProbes),
      ciRerun: resolvedCiRerun,
      targets,
      tagIds,
    });
  } catch (e: any) {
    if (e?.message === 'Project not found') {
      throw apiError({ statusCode: 404, message: 'Project not found' });
    }
    if (e?.message === 'One or more tag IDs are invalid') {
      throw apiError({ statusCode: 400, message: e.message });
    }
    throw e;
  }
});
