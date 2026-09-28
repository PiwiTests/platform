import { readFile } from 'node:fs/promises';
import { parseBugReport, type BugReport } from '@piwitests/core/bug-report';
import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { getDatabase } from '../../../database';
import { getStorage } from '../../../storage';
import { apiError } from '../../../utils/api-error';
import { streamMultipart } from '../../../utils/multipart-stream';
import {
  bugReportIntake,
  fileBugReportIssue,
  roleCanCreateIssues,
  shouldFileOnSend,
} from '../../../utils/integrations/bug-reports';
import { BUG_REPORT_LIMITS, bugReportStorageDir, deleteBugReport, insertBugReport } from '#shared/handlers/bug-reports';

defineRouteMeta({
  openAPI: {
    tags: ['Bug reports'],
    summary: 'Send a bug report',
    description:
      'What Piwi Picker’s **Send to Piwi…** sends: `multipart/form-data` with a `report` part (the bug report as JSON: `{ v: 1, steps, evidence, context }`, 1 MB at most), an optional `language` part (the language it was written in, such as `fr`), and up to three PNG `screenshot` parts named as the report’s `evidence.screenshots` name them (`1-marked.png`, 5 MB each). A `createIssue` part (`true`) asks for an issue in the project’s tracker, which takes the administrator or reporter role unless the project files every report (then one is created anyway). A JSON body `{ report, language?, createIssue? }` is accepted too, without screenshots. Answers `{ id, url, issue }`, `issue` being the create-issue outcome (`{ status, key?, url?, error? }`) or null.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const LANGUAGE = /^[a-z]{2}(?:[-_][A-Za-z]{2})?$/;

interface Incoming {
  report: unknown;
  language: string | null;
  /** The sender asked for an issue to be created in the project's tracker. */
  createIssue: boolean;
  screenshots: Map<string, Buffer>;
}

async function readIncoming(event: Parameters<typeof getRequestHeader>[0]): Promise<Incoming> {
  const type = getRequestHeader(event, 'content-type') ?? '';
  const length = parseInt(getRequestHeader(event, 'content-length') ?? '0', 10);
  const maxBytes =
    BUG_REPORT_LIMITS.jsonBytes + BUG_REPORT_LIMITS.screenshots * BUG_REPORT_LIMITS.screenshotBytes + 64 * 1024;
  if (length > maxBytes)
    throw apiError({ statusCode: 413, message: 'A bug report is 1 MB of JSON and three 5 MB screenshots at most' });

  if (!type.startsWith('multipart/form-data')) {
    const body = (await readBody(event)) as { report?: unknown; language?: unknown; createIssue?: unknown } | null;
    if (JSON.stringify(body ?? {}).length > BUG_REPORT_LIMITS.jsonBytes)
      throw apiError({ statusCode: 413, message: 'The report is larger than 1 MB' });
    return {
      report: body?.report,
      language: typeof body?.language === 'string' ? body.language : null,
      createIssue: body?.createIssue === true,
      screenshots: new Map(),
    };
  }

  const multipart = await streamMultipart(event, {
    maxTotalBytes: BUG_REPORT_LIMITS.screenshots * BUG_REPORT_LIMITS.screenshotBytes,
    maxFieldBytes: BUG_REPORT_LIMITS.jsonBytes,
    maxFiles: BUG_REPORT_LIMITS.screenshots,
  });
  try {
    const screenshots = new Map<string, Buffer>();
    for (const file of multipart.files) {
      if (file.field !== 'screenshot') continue;
      if (file.size > BUG_REPORT_LIMITS.screenshotBytes)
        throw apiError({ statusCode: 413, message: 'A screenshot is 5 MB at most' });
      const bytes = await readFile(file.path);
      if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE))
        throw apiError({ statusCode: 400, message: 'A screenshot must be a PNG image' });
      screenshots.set(file.filename, bytes);
    }
    let report: unknown;
    try {
      report = JSON.parse(multipart.fields.get('report') ?? '');
    } catch {
      throw apiError({ statusCode: 400, message: 'The report part is not JSON' });
    }
    return {
      report,
      language: multipart.fields.get('language') ?? null,
      createIssue: multipart.fields.get('createIssue') === 'true',
      screenshots,
    };
  } finally {
    await multipart.cleanup();
  }
}

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');
  const user = await requireProjectAccess(event, projectId);
  const incoming = await readIncoming(event);

  const parsed = parseBugReport(incoming.report);
  if (!parsed.ok)
    throw apiError({ statusCode: 400, message: `Not a bug report: ${parsed.errors.slice(0, 3).join('; ')}` });

  // Keep the screenshots that arrived, under the names the report gives them.
  const files = parsed.report.evidence.screenshots.flatMap((shot) => {
    const bytes = incoming.screenshots.get(shot.file.replace(/^screenshots\//, ''));
    return bytes ? [{ shot, bytes }] : [];
  });
  const report: BugReport = {
    ...parsed.report,
    evidence: { ...parsed.report.evidence, screenshots: files.map((f) => f.shot) },
  };
  const language = incoming.language && LANGUAGE.test(incoming.language) ? incoming.language : null;

  const db = await getDatabase();
  // A role that may not create issues cannot ask for one; the project filing every report is not asking.
  if (incoming.createIssue && !roleCanCreateIssues(user.role)) {
    const intake = await bugReportIntake(db, projectId, user.role);
    if (!intake.fileEvery)
      throw apiError({ statusCode: 403, message: 'Creating an issue takes the administrator or reporter role' });
  }
  const { id } = await insertBugReport(db, { projectId, report, language, createdBy: user.id });
  if (files.length > 0) {
    const storage = getStorage();
    const dir = bugReportStorageDir(id);
    try {
      await storage.mkdir(dir);
      for (const { shot, bytes } of files)
        await storage.writeFile(`${dir}/${shot.file.replace(/^screenshots\//, '')}`, bytes);
    } catch (err) {
      await deleteBugReport(db, id);
      await storage.deleteDirectory(dir).catch(() => undefined);
      throw err;
    }
  }
  // The report is stored whatever the tracker answers; the issue follows through the outbox.
  let issue: { status: string; key?: string; url?: string; error?: string } | null = null;
  if (await shouldFileOnSend(db, projectId, incoming.createIssue, user.role)) {
    try {
      const outcome = await fileBugReportIssue(db, { bugReportId: id, projectId, requestedBy: user.id || null });
      if (outcome) issue = { status: outcome.status, key: outcome.key, url: outcome.url, error: outcome.error };
    } catch (e) {
      issue = { status: 'failed', error: e instanceof Error ? e.message : String(e) };
    }
  }
  setResponseStatus(event, 201);
  return { id, url: `/bug-reports/${id}`, issue };
});
