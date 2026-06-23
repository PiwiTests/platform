import * as path from 'path';
import type { FullConfig, Suite, TestCase, TestResult, FullResult } from '@playwright/test/reporter';
import { resolveOptions, type PiwiDashboardOptions, type ShardInfo } from './config.js';
import { HttpClient } from './http-client.js';
import { Uploader } from './uploader.js';
import { StreamBuffer } from './stream-buffer.js';
import { CrashRecovery } from './crash-recovery.js';
import { FileHandler } from './file-handler.js';
import { MetadataCollector } from './metadata-collector.js';
import { StreamManager } from './stream-manager.js';
import { collectStepMetrics, extractTestStepEvents } from './step-analyzer.js';
import {
  computeInstanceId,
  readSourceSnippet,
  createGlobalSetup,
  detectCiRunLabel,
  workerIndexOf,
  detectCliFileFilters,
} from './helpers.js';
import { toWireTestCase } from './serializer.js';
import { mergeAnnotations, classifyStatus } from './skip-classify.js';
import { RunSubmitter } from './run-submitter.js';
import { Logger } from './logger.js';
import type { CollectedTestCase, StreamEvent, SetupStep, FilterDetails } from './types.js';

/**
 * Piwi Dashboard Playwright reporter.
 *
 * Collects test results, metadata, performance metrics and trace files, then
 * hands the collected run to a `RunSubmitter` which drives the JSON / multipart
 * / streaming submit ladder. The reporter itself only owns the Playwright hooks
 * and the running counters.
 */
export class PiwiDashboardReporter {
  private options: PiwiDashboardOptions;
  private testCases: CollectedTestCase[] = [];
  private startTime: string | null = null;
  private playwrightVersion: string | null = null;
  private totalTests = 0;
  private passedTests = 0;
  private failedTests = 0;
  private skippedTests = 0;
  private timedOutTests = 0;
  private didNotRunTests = 0;
  /** Full set of tests Playwright planned to run this shard (captured in `onBegin`). */
  private plannedTests: TestCase[] = [];
  /** Ids of tests that actually reported via `onTestEnd`, to find the ones that never ran. */
  private reportedTestIds = new Set<string>();
  private instanceId: string;
  private runLabel: string | null = null;
  private shardInfo: ShardInfo | null = null;
  private metadata: Record<string, any> = {};
  private enabled: boolean;
  private isFullRun = true;
  private filterDetails: FilterDetails | null = null;

  private httpClient: HttpClient;
  private uploader: Uploader;
  private fileHandler: FileHandler;
  private metadataCollector: MetadataCollector;
  private streamManager: StreamManager | null = null;
  private recovery: CrashRecovery;
  private submitter: RunSubmitter;
  private readonly logger: Logger;

  static createGlobalSetup = createGlobalSetup;

  constructor(rawOptions: Record<string, any> = {}) {
    this.options = resolveOptions(rawOptions);
    this.enabled = !!this.options.serverUrl;
    this.runLabel = this.options.runLabel || detectCiRunLabel();
    this.instanceId = computeInstanceId(this.options.projectName!, this.runLabel);

    const logger = new Logger(this.options.verbose ?? false);
    this.logger = logger;
    this.httpClient = new HttpClient(this.options.serverUrl ?? 'http://localhost:3000', logger);
    this.fileHandler = new FileHandler(logger);
    this.uploader = new Uploader(this.httpClient, this.fileHandler, logger);
    this.recovery = new CrashRecovery(this.options.projectName!, logger);
    this.metadataCollector = new MetadataCollector(logger);

    const streamBuffer = new StreamBuffer(this.options.projectName!);
    streamBuffer.clearStale();

    if (this.options.streaming) {
      this.streamManager = new StreamManager(
        this.httpClient,
        streamBuffer,
        this.recovery,
        this.uploader,
        this.fileHandler,
        this.options,
        logger,
      );
    }

    this.submitter = new RunSubmitter(this.httpClient, this.uploader, this.recovery, this.streamManager, logger);
  }

  /** Playwright reporter hook: called once at the start of the test run */
  onBegin(config: FullConfig, suite: Suite): void {
    if (!this.enabled) {
      this.logger.info('Not enabled — set PIWI_DASHBOARD_URL or serverUrl to enable.');
      return;
    }
    this.startTime = new Date().toISOString();
    this.playwrightVersion = config.version;
    this.logger.info(
      `Starting test run for project: ${this.options.projectName} (Playwright v${this.playwrightVersion})`,
    );

    // Detect partial-run filters so the dashboard can distinguish full-suite runs from ad-hoc focused runs.
    const rawConfig = config as any;
    const grepRe = rawConfig.grep instanceof RegExp ? rawConfig.grep : undefined;
    const grepInvertRe = rawConfig.grepInvert instanceof RegExp ? rawConfig.grepInvert : undefined;
    // Playwright's default grep is /.*/ (matches everything) — only a non-default pattern is a real filter.
    const grep = grepRe && grepRe.source !== '.*' ? grepRe.source : undefined;
    const grepInvert = grepInvertRe?.source;
    // File/path filters come from the CLI invocation, not config.grep.
    const fileFilters = detectCliFileFilters();
    if (grep || grepInvert || fileFilters.length > 0) {
      this.isFullRun = false;
      this.filterDetails = {
        ...(grep ? { grep } : {}),
        ...(grepInvert ? { grepInvert } : {}),
        ...(fileFilters.length > 0 ? { files: fileFilters } : {}),
      };
      this.logger.info('Partial run detected (filter active)');
    }

    this.metadata = this.metadataCollector.collect(config, suite, this.options);

    // Snapshot the planned test list so `onEnd` can materialize tests that
    // never ran (e.g. cut short by `maxFailures`) as `didnotrun` cases. The
    // suite is already filtered/sharded, so this matches what this shard
    // attempts.
    this.plannedTests = suite.allTests();

    // Detect Playwright shard config (--shard=1/3)
    const pwShard = (config as any).shard as ShardInfo | null | undefined;
    if (pwShard?.total && pwShard.total > 1) {
      this.shardInfo = { current: pwShard.current, total: pwShard.total };
      this.logger.info(`Shard ${this.shardInfo.current}/${this.shardInfo.total} detected`);
    }

    this.streamManager?.start(
      this.startTime,
      this.metadata,
      this.instanceId,
      this.playwrightVersion,
      this.shardInfo,
      this.isFullRun,
      this.filterDetails,
    );
  }

  /** Playwright reporter hook: called when an individual test begins */
  onTestBegin(test: TestCase, result: TestResult): void {
    const relativeFilePath = path.relative(process.cwd(), test.location.file);
    const { suitePath, suiteConfig } = this.metadataCollector.getSuiteInfo(test);
    const beginEvent: CollectedTestCase = {
      type: 'begin',
      title: test.title,
      location: `${relativeFilePath}:${test.location.line}:${test.location.column}`,
      workerIndex: workerIndexOf(result),
      shardIndex: this.shardInfo?.current ?? null,
      browser: this.metadataCollector.getBrowserConfig(test) || undefined,
      suitePath,
      suiteConfig,
    };

    if (this.streamManager) {
      this.streamManager.queueBeginEvent(toWireTestCase(beginEvent) as StreamEvent);
    }
  }

  /** Track suite-level setup steps (beforeAll/afterAll) not tied to any test */
  private setupSteps: SetupStep[] = [];

  /** Playwright reporter hook: called when a step (including hook/fixture) begins */
  onStepBegin(test: TestCase | undefined, _result: TestResult | undefined, step: any): void {
    if (!this.enabled || !this.streamManager?.enabled) return;
    const cat = step.category;
    if (cat !== 'hook' && cat !== 'fixture') return;

    const event: StreamEvent = {
      type: 'step-begin',
      title: step.title,
      location: step.location ? `${step.location.file}:${step.location.line}:${step.location.column}` : 'unknown',
      stepCategory: cat,
      parentTitle: test?.title || null,
      workerIndex: workerIndexOf(_result),
      startedAt: step.startTime instanceof Date ? step.startTime.getTime() : null,
    };
    this.streamManager?.queueBeginEvent(event);
  }

  /** Playwright reporter hook: called when a step (including hook/fixture) ends */
  onStepEnd(test: TestCase | undefined, _result: TestResult | undefined, step: any): void {
    if (!this.enabled || !this.streamManager?.enabled) return;
    const cat = step.category;
    if (cat !== 'hook' && cat !== 'fixture') return;

    const workerIndex = workerIndexOf(_result);
    const startedAt = step.startTime instanceof Date ? step.startTime.getTime() : null;

    const event: StreamEvent = {
      type: 'step-end',
      title: step.title,
      location: step.location ? `${step.location.file}:${step.location.line}:${step.location.column}` : 'unknown',
      status: step.error ? 'failed' : 'passed',
      duration: step.duration || 0,
      stepCategory: cat,
      parentTitle: test?.title || null,
      workerIndex,
      startedAt,
    };
    this.streamManager?.queueEvent(event);

    // Track suite-level hooks (beforeAll/afterAll) for the timeline
    if (!test && startedAt) {
      this.setupSteps.push({
        title: step.title,
        category: cat,
        startedAt,
        duration: step.duration || 0,
        status: step.error ? 'failed' : 'passed',
        location: step.location ? `${step.location.file}:${step.location.line}:${step.location.column}` : null,
        workerIndex,
      });
    }
  }

  /** Playwright reporter hook: called when an individual test finishes */
  onTestEnd(test: TestCase, result: TestResult): void {
    this.totalTests++;
    const relativeFilePath = path.relative(process.cwd(), test.location.file);

    this.reportedTestIds.add(test.id);

    const { suitePath, suiteConfig } = this.metadataCollector.getSuiteInfo(test);
    const annotations = mergeAnnotations(test, result);
    const status = classifyStatus(result.status, annotations);
    const testCase: CollectedTestCase = {
      type: 'complete',
      title: test.title,
      location: `${relativeFilePath}:${test.location.line}:${test.location.column}`,
      status,
      duration: result.duration,
      error: result.error ? result.error.message : null,
      retries: result.retry,
      workerIndex: workerIndexOf(result),
      shardIndex: this.shardInfo?.current ?? null,
      startedAt: result.startTime ? result.startTime.getTime() : null,
      attachments: result.attachments || [],
      browser: this.metadataCollector.getBrowserConfig(test) || undefined,
      suitePath,
      suiteConfig,
      testAnnotations: annotations.length ? annotations : null,
    };

    if (result.status === 'failed' || result.status === 'timedOut') {
      const snippet = readSourceSnippet(test.location.file, test.location.line, 30);
      if (snippet) testCase.testSource = snippet;
    }

    if (this.options.collectPerformanceMetrics && result.steps?.length > 0) {
      testCase.performanceMetrics = collectStepMetrics(result.steps);
      const stepEvents = extractTestStepEvents(result.steps, result.startTime);
      if (stepEvents.length > 0) testCase.stepEvents = stepEvents;
    }

    if (this.options.collectPerformanceMetrics && result.attachments) {
      this.fileHandler.parsePerformanceAttachments(testCase, result.attachments);
    }

    switch (status) {
      case 'passed':
        this.passedTests++;
        break;
      case 'failed':
        this.failedTests++;
        break;
      case 'skipped':
        this.skippedTests++;
        break;
      case 'didnotrun':
        this.didNotRunTests++;
        break;
      case 'timedOut':
        this.timedOutTests++;
        break;
    }

    this.testCases.push(testCase);

    if (this.streamManager) {
      this.streamManager.queueEvent(toWireTestCase(testCase) as StreamEvent);
      if (this.options.liveFileUploads) this.streamManager.scheduleLiveUpload(testCase);
    }
  }

  /**
   * Synthesize `didnotrun` cases for tests Playwright planned but never reported
   * (no `onTestEnd`) — typically because `maxFailures` cut the run short. These
   * carry no result, so they're emitted with zero duration and no error. In
   * streaming mode they're queued as complete events so the pre-finish drain
   * sends them alongside the rest.
   */
  private materializeUnrunTests(): void {
    for (const test of this.plannedTests) {
      if (this.reportedTestIds.has(test.id)) continue;

      const relativeFilePath = path.relative(process.cwd(), test.location.file);
      const { suitePath, suiteConfig } = this.metadataCollector.getSuiteInfo(test);
      const testCase: CollectedTestCase = {
        type: 'complete',
        title: test.title,
        location: `${relativeFilePath}:${test.location.line}:${test.location.column}`,
        status: 'didnotrun',
        duration: 0,
        error: null,
        retries: 0,
        workerIndex: null,
        shardIndex: this.shardInfo?.current ?? null,
        startedAt: null,
        attachments: [],
        browser: this.metadataCollector.getBrowserConfig(test) || undefined,
        suitePath,
        suiteConfig,
        testAnnotations: test.annotations?.length ? (test.annotations as any) : null,
      };

      this.testCases.push(testCase);
      this.totalTests++;
      this.didNotRunTests++;

      if (this.streamManager) {
        this.streamManager.queueEvent(toWireTestCase(testCase) as StreamEvent);
      }
    }
  }

  /** Playwright reporter hook: called when the full test run finishes */
  async onEnd(result: FullResult): Promise<void> {
    if (!this.enabled) return;

    this.materializeUnrunTests();

    await this.submitter.submit(
      {
        options: this.options,
        testCases: this.testCases,
        startTime: this.startTime,
        playwrightVersion: this.playwrightVersion,
        totalTests: this.totalTests,
        passedTests: this.passedTests,
        failedTests: this.failedTests,
        skippedTests: this.skippedTests,
        timedOutTests: this.timedOutTests,
        didNotRunTests: this.didNotRunTests,
        metadata: this.metadata,
        instanceId: this.instanceId,
        shardInfo: this.shardInfo,
        setupSteps: this.setupSteps,
        isFullRun: this.isFullRun,
        filterDetails: this.filterDetails,
      },
      result,
    );
  }
}
