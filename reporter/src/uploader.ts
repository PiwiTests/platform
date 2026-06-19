import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import { HttpClient } from './http-client.js';
import { FileHandler } from './file-handler.js';

/** Payload for a batch test-run submission */
export interface RunPayload {
  /** Name of the project the run belongs to */
  projectName: string;
  /** Optional project description */
  projectDescription?: string;
  /** Overall run status: `"passed"` or `"failed"` */
  status: string;
  /** ISO-8601 timestamp when the run started */
  startTime: string | null;
  /** Total wall-clock duration of the run in ms */
  duration: number;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  /** Deployment environment label (e.g. `"staging"`, `"production"`) */
  environment?: string;
  /** Arbitrary metadata collected from the environment, CI, and Playwright config */
  metadata: Record<string, any>;
  /** Unique instance identifier for deduplication */
  instanceId: string;
  /** Test case results */
  testCases: any[];
  /** Playwright framework version used for this run */
  playwrightVersion?: string;
  /** 1-based shard index (e.g. 1, 2, 3) */
  shardIndex?: number;
  /** Total number of shards (e.g. 3) */
  shardTotal?: number;
}

/** Options controlling which report files and traces to upload */
export interface ReportOptions {
  /** Upload trace files. Defaults to `true`. */
  uploadTraces?: boolean;
  /** Upload the Playwright HTML report. Defaults to `true`. */
  uploadReport?: boolean;
  /** Additional report types to discover and upload */
  reports?: Array<{ type: string; dir?: string; label?: string }>;
}

/**
 * Handles all upload strategies: plain JSON, multipart (with reports and
 * traces), per-test-case file uploads for streaming runs, and report-only
 * uploads for already-submitted streaming runs.
 */
export class Uploader {
  /**
   * @param httpClient  HTTP client for server communication.
   * @param fileHandler File discovery and compression helper.
   * @param verbose     Enable verbose logging.
   */
  constructor(
    private httpClient: HttpClient,
    private fileHandler: FileHandler,
    private verbose?: boolean,
  ) {}

  /** Submit test results as a plain JSON payload (no file attachments) */
  async uploadJSON(payload: RunPayload, auth: string | null): Promise<any> {
    const response = await this.httpClient.postJSON(
      '/api/test-runs/submit',
      {
        projectName: payload.projectName,
        projectDescription: payload.projectDescription,
        status: payload.status,
        startTime: payload.startTime,
        duration: payload.duration,
        totalTests: payload.totalTests,
        passedTests: payload.passedTests,
        failedTests: payload.failedTests,
        skippedTests: payload.skippedTests,
        environment: payload.environment || null,
        metadata: payload.metadata,
        instanceId: payload.instanceId,
        playwrightVersion: payload.playwrightVersion,
        testCases: payload.testCases,
        shardIndex: payload.shardIndex,
        shardTotal: payload.shardTotal,
      },
      auth,
    );

    console.log(`[Piwi Dashboard] Successfully uploaded test results`);
    if (response.testRunId)
      console.log(`[Piwi Dashboard] Test Run ID: ${response.testRunId}, Project ID: ${response.projectId}`);
    return response;
  }

  /** Submit test results as a multipart form with trace files and compressed report directories */
  async uploadWithFiles(payload: RunPayload, reportOptions: ReportOptions, auth: string | null): Promise<any> {
    const form = new FormData();
    form.append('projectName', payload.projectName);
    form.append(
      'testRun',
      JSON.stringify({
        status: payload.status,
        startTime: payload.startTime,
        duration: payload.duration,
        totalTests: payload.totalTests,
        passedTests: payload.passedTests,
        failedTests: payload.failedTests,
        skippedTests: payload.skippedTests,
        environment: payload.environment || null,
        metadata: payload.metadata,
        projectDescription: payload.projectDescription,
        instanceId: payload.instanceId,
        playwrightVersion: payload.playwrightVersion,
        shardIndex: payload.shardIndex,
        shardTotal: payload.shardTotal,
      }),
    );
    form.append('testCases', JSON.stringify(payload.testCases));

    await this.appendReportsToForm(form, reportOptions.reports, reportOptions.uploadReport);
    await this.appendFilesToForm(form, payload.testCases, reportOptions.uploadTraces);

    const response = await this.httpClient.postFormData('/api/test-runs/upload', form, auth);
    console.log(`[Piwi Dashboard] Successfully uploaded test results with files`);
    if (response.testRunId)
      console.log(`[Piwi Dashboard] Test Run ID: ${response.testRunId}, Project ID: ${response.projectId}`);
    if (response.reports) {
      for (const r of response.reports) console.log(`[Piwi Dashboard] ${r.label}: ${r.path}`);
    }
    return response;
  }

  /** Upload report files for an already-submitted streaming run */
  async uploadReportsForStreamingRun(
    projectName: string,
    runId: number,
    reportOptions: ReportOptions,
    startTime: string | null,
    auth: string | null,
  ): Promise<void> {
    const form = new FormData();
    form.append('testRunId', String(runId));
    form.append('projectName', projectName);
    form.append(
      'testRun',
      JSON.stringify({
        status: 'already-submitted',
        startTime,
        duration: 0,
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        skippedTests: 0,
        metadata: {},
      }),
    );
    form.append('testCases', JSON.stringify([]));

    await this.appendReportsToForm(form, reportOptions.reports, reportOptions.uploadReport);

    const response = await this.httpClient.postFormData('/api/test-runs/upload', form, auth);
    console.log(`[Piwi Dashboard] Successfully uploaded reports for streaming run #${runId}`);
    if (response.reports) {
      for (const r of response.reports) console.log(`[Piwi Dashboard] ${r.label}: ${r.path}`);
    }
  }

  /**
   * Upload one test case's trace and attachments to a streaming run, as soon
   * as the test finishes. The server links them to the run case persisted by
   * the events endpoint, so the matching `complete` event must be flushed
   * before calling this. Returns false when the case has no files to upload.
   */
  /**
   * Upload one test case's trace and attachments for a streaming run.
   * The matching `complete` event must have been flushed to the server first.
   * Returns `false` when the case has no files to upload.
   */
  async uploadCaseFiles(
    projectName: string,
    runId: number,
    streamToken: string,
    testCase: any,
    uploadTraces: boolean | undefined,
    auth: string | null,
  ): Promise<boolean> {
    const attachments = this.fileHandler.findAllAttachments(testCase);

    let traceInfo: { tracePath: string; hash: string; size: number } | null = null;
    if (uploadTraces) {
      traceInfo = await this.fileHandler.computeSingleTraceHash(testCase);
    }

    if (!traceInfo && attachments.length === 0) return false;

    // Skip the trace body when the server already has this blob
    let missingHashes: Set<string> | null = null;
    if (traceInfo) {
      missingHashes = await this.fileHandler.checkMissingTraces(
        this.httpClient,
        projectName,
        new Map([[0, traceInfo]]),
        auth,
      );
    }

    const buildForm = (includeTraceFile: boolean): FormData => {
      const form = new FormData();
      form.append('streamToken', streamToken);
      form.append(
        'testCase',
        JSON.stringify({
          title: testCase.title,
          location: testCase.location,
          retries: testCase.retries ?? 0,
        }),
      );
      if (traceInfo) {
        form.append('trace_hash', traceInfo.hash);
        if (includeTraceFile) {
          form.append('trace', fs.createReadStream(traceInfo.tracePath), {
            filename: path.basename(traceInfo.tracePath),
          });
        }
      }
      if (attachments.length > 0) {
        form.append(
          'attach_meta',
          JSON.stringify(
            attachments.map((a) => ({ name: a.name, contentType: a.contentType, originalName: a.originalName })),
          ),
        );
        for (const a of attachments) {
          form.append('attach_file', fs.createReadStream(a.path), { filename: a.originalName });
        }
      }
      return form;
    };

    const includeTraceFile = !traceInfo || !missingHashes || missingHashes.has(traceInfo.hash);
    try {
      await this.httpClient.postFormData(`/api/test-runs/${runId}/case-files`, buildForm(includeTraceFile), auth);
    } catch (error: any) {
      // 422: the server doesn't have the blob after all — resend with the file
      if (traceInfo && !includeTraceFile && error.message?.includes('422')) {
        await this.httpClient.postFormData(`/api/test-runs/${runId}/case-files`, buildForm(true), auth);
      } else {
        throw error;
      }
    }

    if (this.verbose) {
      console.log(
        `[Piwi Dashboard] Uploaded files for "${testCase.title}" (trace: ${traceInfo ? 'yes' : 'no'}, attachments: ${attachments.length})`,
      );
    }
    return true;
  }

  private async appendReportsToForm(
    form: FormData,
    reports?: Array<{ type: string; dir?: string; label?: string }>,
    uploadReport?: boolean,
  ): Promise<void> {
    const list: Array<{ type: string; dir?: string; label?: string }> = reports ? [...reports] : [];
    if (uploadReport && !list.some((r) => r.type === 'html')) list.push({ type: 'html' });

    for (const cfg of list) {
      const defaultDir = this.fileHandler.getDefaultReportDirs()[cfg.type] || cfg.type + '-report';
      const reportDir = cfg.dir
        ? this.fileHandler.findReportDirectory(cfg.dir)
        : cfg.type === 'html'
          ? this.fileHandler.findHTMLReportDirectory()
          : this.fileHandler.findReportDirectory(defaultDir);

      if (!reportDir) {
        if (this.verbose) console.log(`[Piwi Dashboard] No report directory found for type '${cfg.type}'`);
        continue;
      }

      const compressed = await this.fileHandler.compressReportDirectory(reportDir);
      if (compressed) {
        form.append(`report_${cfg.type}`, compressed, { filename: `${cfg.type}-report.gz` });
        if (cfg.label) form.append(`report_label_${cfg.type}`, cfg.label);
      }
    }
  }

  private async appendFilesToForm(form: FormData, testCases: any[], uploadTraces?: boolean): Promise<void> {
    let attachmentCount = 0;
    for (const [i, tc] of testCases.entries()) {
      const attachments = this.fileHandler.findAllAttachments(tc);
      if (attachments.length === 0) continue;

      form.append(
        `attach_meta_${i}`,
        JSON.stringify(
          attachments.map((a) => ({
            name: a.name,
            contentType: a.contentType,
            originalName: a.originalName,
          })),
        ),
      );

      for (const a of attachments) {
        form.append(`attach_file_${i}`, fs.createReadStream(a.path), { filename: a.originalName });
        attachmentCount++;
      }
    }
    if (attachmentCount > 0) console.log(`[Piwi Dashboard] Uploading ${attachmentCount} non-trace attachments`);

    if (!uploadTraces) return;

    let traceCount = 0;
    for (const [i, tc] of testCases.entries()) {
      for (const tp of this.fileHandler.findTraceFiles(tc)) {
        if (fs.existsSync(tp)) {
          form.append(`trace_${i}`, fs.createReadStream(tp), { filename: path.basename(tp) });
          traceCount++;
        }
      }
    }
    console.log(`[Piwi Dashboard] Found ${traceCount} trace files`);
  }
}
