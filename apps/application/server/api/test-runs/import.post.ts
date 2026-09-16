import { requireAuth } from '../../utils/auth';
import { sanitizeFilename } from '../../utils/sanitize-filename';
import { resolveMaxUploadBytes } from '../../utils/upload-limits';
import { importArchive } from '../../utils/import-archive';
import { formatBytes } from '#shared/utils/format-bytes';

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Import a historical Playwright blob report or trace',
    description:
      'Import one archive as historical results. A blob report (blob-report/report-*.zip) becomes a complete run with its traces and attachments. A bare trace (trace.zip) becomes a single execution; pass the same importGroup with several traces to gather them into one run. Intended for backfilling runs recorded before Piwi was adopted: re-importing the same archive is a no-op, and imports deliberately do not trigger notifications, AI diagnosis or regression signals.',
    'x-required-roles': ['administrator'],
    requestBody: {
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            properties: {
              projectName: { type: 'string' },
              archive: { type: 'string', format: 'binary', description: 'A blob report or trace .zip' },
              environment: { type: 'string' },
              label: { type: 'string' },
              importGroup: {
                type: 'string',
                description:
                  'Hex SHA-256 grouping key. Traces sharing one land in a single run; ignored for blob reports.',
              },
            },
            required: ['projectName', 'archive'],
          },
        },
      },
    },
  },
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);

  const maxUploadBytes = resolveMaxUploadBytes();
  const contentLength = parseInt(getRequestHeader(event, 'content-length') ?? '0', 10);
  if (contentLength > maxUploadBytes) {
    throw apiError({ statusCode: 413, message: `Archive too large (max ${formatBytes(maxUploadBytes)})` });
  }

  const formData = await readMultipartFormData(event);
  if (!formData) throw apiError({ statusCode: 400, message: 'No form data provided' });

  let projectName: string | undefined;
  let environment: string | null = null;
  let label: string | null = null;
  let importGroup: string | null = null;
  let archive: { filename: string; data: Buffer } | undefined;

  for (const part of formData) {
    if (part.name === 'projectName') projectName = part.data.toString('utf-8').trim();
    else if (part.name === 'environment') environment = part.data.toString('utf-8').trim() || null;
    else if (part.name === 'label') label = part.data.toString('utf-8').trim() || null;
    else if (part.name === 'importGroup') {
      const value = part.data.toString('utf-8').trim().toLowerCase();
      if (/^[0-9a-f]{64}$/.test(value)) importGroup = value;
    } else if (part.name === 'archive' && part.filename) {
      archive = { filename: sanitizeFilename(part.filename), data: part.data };
    }
  }

  if (!projectName || !archive) {
    throw apiError({ statusCode: 400, message: 'Missing required fields: projectName, archive' });
  }

  return importArchive({ user, projectName, archive, environment, label, importGroup });
});
