import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { compressDirectory } from './compression.js';
import { Logger } from './logger.js';
import { ATTACHMENT_NAMES, INTERNAL_ATTACHMENT_NAMES } from './attachments.js';
import type { CollectedTestCase, RawAttachment, TraceHashInfo } from './types.js';

/**
 * File-system helpers for discovering report directories, trace files, and
 * test attachments, as well as compressing report directories and computing
 * trace-file hashes for deduplication.
 */
export class FileHandler {
  private readonly logger: Logger;

  constructor(logger: Logger = new Logger()) {
    this.logger = logger;
  }

  /** Locate a Playwright HTML report directory containing `index.html`. Optionally override the search path. */
  findHTMLReportDirectory(customDir?: string): string | null {
    const possibleDirs = customDir
      ? [customDir, path.join(process.cwd(), customDir)]
      : ['playwright-report', './playwright-report', path.join(process.cwd(), 'playwright-report')];

    for (const reportDir of possibleDirs) {
      if (fs.existsSync(reportDir) && fs.statSync(reportDir).isDirectory()) {
        if (fs.existsSync(path.join(reportDir, 'index.html'))) return reportDir;
      }
    }
    return null;
  }

  /** Check if `dir` exists and is a directory; also checks `path.join(process.cwd(), dir)` */
  findReportDirectory(dir: string): string | null {
    const candidates = [dir, path.join(process.cwd(), dir)];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
    }
    return null;
  }

  /** Gzip-compress an entire report directory into a single buffer. Returns `null` on failure. */
  async compressReportDirectory(reportDir: string): Promise<Buffer | null> {
    try {
      return (await compressDirectory(reportDir)) || null;
    } catch (error: any) {
      this.logger.warn(`Failed to compress report directory ${reportDir}: ${error.message}`);
      return null;
    }
  }

  /** Return resolved paths for all trace attachments on a test case */
  findTraceFiles(testCase: CollectedTestCase): string[] {
    const set = new Set<string>();
    if (testCase.attachments) {
      for (const a of testCase.attachments) {
        if (a.name === 'trace' && a.path) set.add(path.resolve(a.path));
      }
    }
    return Array.from(set);
  }

  /** Return all non-trace, non-internal attachments from a test case. Skips `trace` and `piwi-*` attachments. */
  findAllAttachments(
    testCase: CollectedTestCase,
  ): Array<{ name: string; path: string; contentType: string; originalName: string }> {
    const result: Array<{ name: string; path: string; contentType: string; originalName: string }> = [];
    if (testCase.attachments) {
      for (const a of testCase.attachments) {
        if (a.name === 'trace') continue;
        if (a.name && INTERNAL_ATTACHMENT_NAMES.has(a.name)) continue;
        if (a.path && fs.existsSync(a.path)) {
          result.push({
            name: a.name || 'attachment',
            path: path.resolve(a.path),
            contentType: a.contentType || 'application/octet-stream',
            originalName: path.basename(a.path),
          });
        }
      }
    }
    return result;
  }

  /** Mapping of well-known report type names to their default output directories */
  getDefaultReportDirs(): Record<string, string> {
    return {
      html: 'playwright-report',
      monocart: 'monocart-report',
      allure: 'allure-report',
      blob: 'blob-report',
    };
  }

  /** Parse Piwi-internal attachment bodies (`piwi-network`, `piwi-web-vitals`, `piwi-console`, `piwi-aria-snapshot`) into structured fields on the test case */
  parsePerformanceAttachments(testCase: CollectedTestCase, attachments: RawAttachment[]): void {
    const find = (name: string) => attachments.find((a) => a.name === name);

    const net = find(ATTACHMENT_NAMES.network);
    if (net?.body) {
      try {
        testCase.networkRequests = JSON.parse((net.body as Buffer).toString());
      } catch {
        /* ignore */
      }
    }

    const vitals = find(ATTACHMENT_NAMES.webVitals);
    if (vitals?.body) {
      try {
        testCase.webVitals = JSON.parse((vitals.body as Buffer).toString());
      } catch {
        /* ignore */
      }
    }

    const consoleLog = find(ATTACHMENT_NAMES.console);
    if (consoleLog?.body) {
      try {
        testCase.consoleLogs = JSON.parse((consoleLog.body as Buffer).toString());
      } catch {
        /* ignore */
      }
    }

    const aria = find(ATTACHMENT_NAMES.ariaSnapshot);
    if (aria?.body) testCase.ariaSnapshot = (aria.body as Buffer).toString();
  }

  /** Compute SHA-256 hash and size for a single test case's trace file. Returns `null` when the case has no trace on disk. */
  async computeSingleTraceHash(testCase: CollectedTestCase): Promise<TraceHashInfo | null> {
    const tracePaths = this.findTraceFiles(testCase);
    let lastPath: string | null = null;
    for (const tp of tracePaths) {
      if (fs.existsSync(tp)) lastPath = tp;
    }
    if (!lastPath) return null;

    const hash = crypto.createHash('sha256');
    await new Promise<void>((resolve, reject) => {
      fs.createReadStream(lastPath!)
        .on('data', (chunk: Buffer) => hash.update(chunk))
        .on('end', resolve)
        .on('error', reject);
    });
    return {
      tracePath: lastPath,
      hash: hash.digest('hex'),
      size: fs.statSync(lastPath).size,
    };
  }

  /** Ask the server which trace hashes it already has, returning the set of hashes that are missing */
  async checkMissingTraces(
    httpClient: { postJSON(path: string, payload: any, auth?: string | null): Promise<any> },
    projectName: string,
    traceHashMap: Map<number, { hash: string }>,
    auth: string | null,
  ): Promise<Set<string>> {
    if (traceHashMap.size === 0) return new Set();
    const hashes = [...traceHashMap.values()].map((h) => h.hash);

    try {
      const response = await httpClient.postJSON('/api/traces/check', { projectName, hashes }, auth);
      const missing = Array.isArray(response.missing) ? response.missing : hashes;
      return new Set(missing);
    } catch {
      return new Set(hashes);
    }
  }
}
