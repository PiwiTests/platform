import fs from "fs";
import path from "path";
import FormData from "form-data";
import { HttpClient } from "./http-client.js";

import { FileHandler } from "./file-handler.js";
export class Uploader {
  constructor(
    private httpClient: HttpClient,
    private fileHandler: FileHandler,
    private verbose?: boolean,
  ) {}

  async uploadJSON(
    projectName: string,
    overallStatus: string,
    duration: number,
    startTime: string | null,
    counters: {
      totalTests: number;
      passedTests: number;
      failedTests: number;
      skippedTests: number;
    },
    environment: string | undefined,
    metadata: Record<string, any>,
    instanceId: string,
    testCases: any[],
    projectDescription: string | undefined,
    auth: string | null,
  ): Promise<any> {
    const response = await this.httpClient.postJSON(
      "/api/test-runs/submit",
      {
        projectName,
        projectDescription,
        status: overallStatus,
        startTime,
        duration,
        totalTests: counters.totalTests,
        passedTests: counters.passedTests,
        failedTests: counters.failedTests,
        skippedTests: counters.skippedTests,
        environment: environment || null,
        metadata,
        instanceId,
        testCases,
      },
      auth,
    );

    console.log(`[Piwi Dashboard] Successfully uploaded test results`);
    if (response.testRunId)
      console.log(`[Piwi Dashboard] Test Run ID: ${response.testRunId}, Project ID: ${response.projectId}`);
    return response;
  }

  async uploadWithFiles(
    projectName: string,
    overallStatus: string,
    duration: number,
    startTime: string | null,
    counters: {
      totalTests: number;
      passedTests: number;
      failedTests: number;
      skippedTests: number;
    },
    environment: string | undefined,
    metadata: Record<string, any>,
    instanceId: string,
    projectDescription: string | undefined,
    testCases: any[],
    options: {
      uploadTraces?: boolean;
      uploadReport?: boolean;
      reports?: Array<{ type: string; dir?: string; label?: string }>;
    },
    auth: string | null,
  ): Promise<any> {
    const form = new FormData();
    form.append("projectName", projectName);
    form.append(
      "testRun",
      JSON.stringify({
        status: overallStatus,
        startTime,
        duration,
        totalTests: counters.totalTests,
        passedTests: counters.passedTests,
        failedTests: counters.failedTests,
        skippedTests: counters.skippedTests,
        environment: environment || null,
        metadata,
        projectDescription,
        instanceId,
      }),
    );
    form.append("testCases", JSON.stringify(testCases));

    await this.appendReportsToForm(form, options.reports, options.uploadReport);
    await this.appendTracesToForm(form, testCases, options.uploadTraces);

    const response = await this.httpClient.postFormData("/api/test-runs/upload", form, auth);
    console.log(`[Piwi Dashboard] Successfully uploaded test results with files`);
    if (response.testRunId)
      console.log(`[Piwi Dashboard] Test Run ID: ${response.testRunId}, Project ID: ${response.projectId}`);
    if (response.reports) {
      for (const r of response.reports) console.log(`[Piwi Dashboard] ${r.label}: ${r.path}`);
    }
    return response;
  }

  async uploadReportsForStreamingRun(
    projectName: string,
    runId: number,
    options: {
      uploadReport?: boolean;
      reports?: Array<{ type: string; dir?: string; label?: string }>;
    },
    startTime: string | null,
    auth: string | null,
  ): Promise<void> {
    const form = new FormData();
    form.append("testRunId", String(runId));
    form.append("projectName", projectName);
    form.append(
      "testRun",
      JSON.stringify({
        status: "already-submitted",
        startTime,
        duration: 0,
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        skippedTests: 0,
        metadata: {},
      }),
    );
    form.append("testCases", JSON.stringify([]));

    await this.appendReportsToForm(form, options.reports, options.uploadReport);

    const response = await this.httpClient.postFormData("/api/test-runs/upload", form, auth);
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
      const hashes = await this.fileHandler.computeTraceHashes([testCase]);
      traceInfo = hashes.get(0) ?? null;
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
      form.append("streamToken", streamToken);
      form.append(
        "testCase",
        JSON.stringify({
          title: testCase.title,
          location: testCase.location,
          retries: testCase.retries ?? 0,
        }),
      );
      if (traceInfo) {
        form.append("trace_hash", traceInfo.hash);
        if (includeTraceFile) {
          form.append("trace", fs.createReadStream(traceInfo.tracePath), {
            filename: path.basename(traceInfo.tracePath),
          });
        }
      }
      if (attachments.length > 0) {
        form.append(
          "attach_meta",
          JSON.stringify(
            attachments.map((a) => ({ name: a.name, contentType: a.contentType, originalName: a.originalName })),
          ),
        );
        for (const a of attachments) {
          form.append("attach_file", fs.createReadStream(a.path), { filename: a.originalName });
        }
      }
      return form;
    };

    const includeTraceFile = !traceInfo || !missingHashes || missingHashes.has(traceInfo.hash);
    try {
      await this.httpClient.postFormData(`/api/test-runs/${runId}/case-files`, buildForm(includeTraceFile), auth);
    } catch (error: any) {
      // 422: the server doesn't have the blob after all — resend with the file
      if (traceInfo && !includeTraceFile && error.message?.includes("422")) {
        await this.httpClient.postFormData(`/api/test-runs/${runId}/case-files`, buildForm(true), auth);
      } else {
        throw error;
      }
    }

    if (this.verbose) {
      console.log(
        `[Piwi Dashboard] Uploaded files for "${testCase.title}" (trace: ${traceInfo ? "yes" : "no"}, attachments: ${attachments.length})`,
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
    if (uploadReport && !list.some((r) => r.type === "html")) list.push({ type: "html" });

    for (const cfg of list) {
      const defaultDir = this.fileHandler.getDefaultReportDirs()[cfg.type] || cfg.type + "-report";
      const reportDir = cfg.dir
        ? this.fileHandler.findReportDirectory(cfg.dir)
        : cfg.type === "html"
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

  private async appendTracesToForm(form: FormData, testCases: any[], uploadTraces?: boolean): Promise<void> {
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
