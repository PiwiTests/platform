// Desktop-only: Piwi Picker asks this app to run a bug report's steps with
// Playwright. The body is JSON (a web page cannot send one to another origin
// without a preflight this server never answers) and holds steps, never code:
// the spec is rendered here, and only after the developer confirms the request
// in the window. Responds 404 on the normal server build.
import { requireAuth } from '../../utils/auth';
import { apiError } from '../../utils/api-error';
import { createReproRequest, reproListenerCount } from '../../utils/desktop-repro';
import { parseReproRequest } from '#shared/desktop-repro';

defineRouteMeta({
  openAPI: {
    tags: ['System'],
    summary: 'Ask the desktop app to run a bug report with Playwright (desktop app)',
    description:
      'Desktop build only — 404 on the server build. Keeps a repro request (a steps document and the run options: headed, trace, Playwright project, repeat) for ten minutes and shows it in the app window, where the developer picks the linked project and starts or declines it. The body must be `application/json` (415 otherwise) and its steps must pass `parseSteps` (400 with the errors otherwise). Answers `{ id, status, expiresAt, windowOpen }`; poll `GET /api/desktop/repro-requests/:id` for the verdict.',
    'x-required-roles': ['administrator', 'reporter', 'user'],
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              steps: { type: 'object', description: 'A steps document (`v: 1`), as Download steps writes it.' },
              options: {
                type: 'object',
                properties: {
                  headed: { type: 'boolean' },
                  trace: { type: 'boolean' },
                  project: { type: 'string' },
                  repeatEach: { type: 'integer', minimum: 1, maximum: 20 },
                },
              },
              title: { type: 'string' },
              bugReportId: { type: 'integer', description: 'The report on the instance it came from.' },
              instanceUrl: { type: 'string' },
            },
            required: ['steps'],
          },
        },
      },
    },
  },
});

export default eventHandler(async (event) => {
  if (!process.env.PIWI_DESKTOP_TOKEN) {
    throw apiError({ statusCode: 404, message: 'Desktop build only' });
  }
  await requireAuth(event);
  const contentType = getRequestHeader(event, 'content-type');
  // The type is checked before the body is read.
  const body = contentType?.toLowerCase().startsWith('application/json') ? await readBody(event) : null;
  const parsed = parseReproRequest(contentType, body);
  if (!parsed.ok) throw apiError({ statusCode: parsed.statusCode, message: parsed.message, data: parsed.errors });

  const request = createReproRequest(parsed.request);
  setResponseStatus(event, 201);
  return { id: request.id, status: request.status, expiresAt: request.expiresAt, windowOpen: reproListenerCount() > 0 };
});
