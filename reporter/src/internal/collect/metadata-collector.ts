import { execSync } from 'node:child_process';
import { errorMessage } from '../support/errors.js';
import type { FullConfig, Suite, TestCase } from '@playwright/test/reporter';
import { Logger } from '../support/logger.js';
import type { SuiteConfigEntry } from '../../types.js';

/**
 * Collects CI/CD environment metadata, SCM (git) information, and Playwright
 * config metadata to attach to each test run submission.
 *
 * Also owns all reach-through access to Playwright-internal suite fields
 * (`_parallelMode`, `_annotations`, `project()`) so the surface area that
 * breaks when Playwright renames those internals is guarded behind one class.
 */
export class MetadataCollector {
  constructor(private readonly logger: Logger = new Logger()) {}

  /** Collect all available metadata from the environment, config, and suite */
  collect(config: FullConfig, suite: Suite, options: any): Record<string, unknown> {
    const metadata: Record<string, unknown> = {};

    if (options.projectDescription) metadata.projectDescription = options.projectDescription;
    if (options.relatedIssue) metadata.relatedIssue = options.relatedIssue;
    if (options.ciInfo) metadata.ciInfo = options.ciInfo;
    if (options.tags && Array.isArray(options.tags)) metadata.tags = options.tags;
    if (options.customData) metadata.customData = options.customData;

    if (options.collectScmInfo) {
      const scm = this.collectScmInfo(options);
      if (scm) metadata.scm = scm;
    }

    if (options.collectCiInfo) {
      const ci = this.collectCiInfo();
      if (ci) metadata.ci = ci;
    }

    const htmlMeta = this.extractPlaywrightConfigMetadata(config);
    if (htmlMeta && Object.keys(htmlMeta).length > 0) metadata.htmlReport = htmlMeta;
    if (config.metadata) metadata.playwrightConfig = config.metadata;

    if (suite?.allTests) {
      const all = suite.allTests();
      if (all.length > 0) {
        const first = all[0];
        if (first?.parent) {
          const proj = (first.parent as any).project();
          if (proj?.metadata) metadata.playwrightProject = proj.metadata;
        }
      }
    }

    return metadata;
  }

  /** Walk the test's parent hierarchy to extract the resolved browser/project configuration */
  getBrowserConfig(test: TestCase): Record<string, any> | null {
    try {
      let suite: Suite | undefined = test.parent;
      let depth = 0;
      while (suite && depth < 20) {
        depth++;
        const project = (suite as any).project?.();
        if (project) {
          const use = project.use ?? {};
          const config: Record<string, any> = { projectName: project.name };
          if (use.browserName) config.browserName = use.browserName;
          if (use.channel) config.channel = use.channel;
          if (use.viewport) config.viewport = { width: use.viewport.width, height: use.viewport.height };
          if (use.deviceScaleFactor != null) config.deviceScaleFactor = use.deviceScaleFactor;
          if (use.isMobile != null) config.isMobile = use.isMobile;
          if (use.hasTouch != null) config.hasTouch = use.hasTouch;
          if (use.locale) config.locale = use.locale;
          if (use.timezoneId) config.timezoneId = use.timezoneId;
          if (use.geolocation) {
            config.geolocation = {
              longitude: use.geolocation.longitude,
              latitude: use.geolocation.latitude,
              ...(use.geolocation.accuracy != null && { accuracy: use.geolocation.accuracy }),
            };
          }
          if (use.colorScheme) config.colorScheme = use.colorScheme;
          if (use.reducedMotion) config.reducedMotion = use.reducedMotion;
          if (use.forcedColors) config.forcedColors = use.forcedColors;
          if (use.offline) config.offline = use.offline;
          if (use.bypassCSP) config.bypassCSP = use.bypassCSP;
          if (use.javaScriptEnabled === false) config.javaScriptEnabled = false;
          if (use.serviceWorkers) config.serviceWorkers = use.serviceWorkers;
          if (use.userAgent) config.userAgent = use.userAgent;
          return config;
        }
        suite = suite.parent;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Walk the test's parent `describe` suites to extract the suite path (titles)
   * and per-level config (parallel mode + annotations). Reaches into Playwright
   * suite internals (`_parallelMode`, `_annotations`) — kept here next to
   * `getBrowserConfig` so all such access is guarded behind one class.
   */
  getSuiteInfo(test: TestCase): { suitePath: string[]; suiteConfig: SuiteConfigEntry[] } {
    const suitePath: string[] = [];
    const suiteConfig: SuiteConfigEntry[] = [];
    const suites: Suite[] = [];

    let suite: Suite | undefined = test.parent;
    while (suite && suite.type === 'describe') {
      suites.unshift(suite);
      suite = suite.parent;
    }

    for (const s of suites) {
      if (!s.title) continue;
      suitePath.push(s.title);
      const rawMode = (s as any)._parallelMode as string | undefined;
      const mode: SuiteConfigEntry['mode'] =
        rawMode === 'parallel' ? 'parallel' : rawMode === 'serial' ? 'serial' : 'default';
      const annotations: Array<{ type: string; description?: string }> = (s as any)._annotations ?? [];
      suiteConfig.push({ mode, annotations });
    }

    return { suitePath, suiteConfig };
  }

  private collectScmInfo(_options: any): Record<string, string> | undefined {
    const scm: Record<string, string> = {};
    try {
      const execOpts = { encoding: 'utf8' as const, timeout: 5000, maxBuffer: 1024 * 1024 };
      scm.commit = execSync('git rev-parse HEAD', execOpts).trim();
      scm.branch = execSync('git rev-parse --abbrev-ref HEAD', execOpts).trim();
      scm.author = execSync('git log -1 --pretty=format:"%an"', execOpts).trim();
      scm.commitMessage = execSync('git log -1 --pretty=format:"%s"', execOpts).trim();
      try {
        scm.remoteUrl = execSync('git config --get remote.origin.url', execOpts).trim();
      } catch {
        /* optional */
      }
    } catch (error) {
      this.logger.debug(`Git info not available: ${errorMessage(error)}`);
    }
    return Object.keys(scm).length > 0 ? scm : undefined;
  }

  private collectCiInfo(): Record<string, string | boolean | undefined> | undefined {
    // Env vars are `string | undefined`; undefined values are dropped on JSON
    // serialization, so collecting them directly preserves the prior behavior.
    const ci: Record<string, string | boolean | undefined> = {};
    const env = process.env;

    if (env.JENKINS_URL) {
      ci.provider = 'Jenkins';
      ci.buildNumber = env.BUILD_NUMBER;
      ci.buildUrl = env.BUILD_URL;
      ci.jobName = env.JOB_NAME;
    } else if (env.GITHUB_ACTIONS) {
      ci.provider = 'GitHub Actions';
      ci.runId = env.GITHUB_RUN_ID;
      ci.runNumber = env.GITHUB_RUN_NUMBER;
      ci.workflow = env.GITHUB_WORKFLOW;
      ci.actor = env.GITHUB_ACTOR;
      ci.repository = env.GITHUB_REPOSITORY;
      ci.ref = env.GITHUB_REF;
      ci.sha = env.GITHUB_SHA;
      ci.serverUrl = env.GITHUB_SERVER_URL;
      if (ci.serverUrl && ci.repository && ci.runId) {
        ci.buildUrl = `${ci.serverUrl}/${ci.repository}/actions/runs/${ci.runId}`;
      }
    } else if (env.GITLAB_CI) {
      ci.provider = 'GitLab CI';
      ci.pipelineId = env.CI_PIPELINE_ID;
      ci.pipelineUrl = env.CI_PIPELINE_URL;
      ci.jobId = env.CI_JOB_ID;
      ci.jobUrl = env.CI_JOB_URL;
      ci.jobName = env.CI_JOB_NAME;
    } else if (env.CIRCLECI) {
      ci.provider = 'CircleCI';
      ci.buildNumber = env.CIRCLE_BUILD_NUM;
      ci.buildUrl = env.CIRCLE_BUILD_URL;
      ci.jobName = env.CIRCLE_JOB;
      ci.workflow = env.CIRCLE_WORKFLOW_ID;
    } else if (env.TRAVIS) {
      ci.provider = 'Travis CI';
      ci.buildNumber = env.TRAVIS_BUILD_NUMBER;
      ci.buildUrl = env.TRAVIS_BUILD_WEB_URL;
      ci.jobNumber = env.TRAVIS_JOB_NUMBER;
    } else if (env.TF_BUILD) {
      ci.provider = 'Azure Pipelines';
      ci.buildNumber = env.BUILD_BUILDNUMBER;
      ci.buildId = env.BUILD_BUILDID;
      if (env.SYSTEM_TEAMFOUNDATIONSERVERURI && env.SYSTEM_TEAMPROJECT && env.BUILD_BUILDID) {
        ci.buildUrl = `${env.SYSTEM_TEAMFOUNDATIONSERVERURI}${env.SYSTEM_TEAMPROJECT}/_build/results?buildId=${env.BUILD_BUILDID}`;
      }
      ci.jobName = env.AGENT_JOBNAME;
    } else if (env.CI) {
      ci.provider = 'Unknown CI';
      ci.detected = true;
    }

    return Object.keys(ci).length > 0 ? ci : undefined;
  }

  private extractPlaywrightConfigMetadata(config: FullConfig): Record<string, unknown> {
    const meta: Record<string, unknown> = {};
    if (config.projects?.length > 0) {
      meta.projects = config.projects.map((p: any) => ({
        name: p.name,
        testDir: p.testDir,
        use: {
          browserName: p.use?.browserName || p.name,
          viewport: p.use?.viewport,
          deviceScaleFactor: p.use?.deviceScaleFactor,
        },
      }));
    }
    meta.workers = config.workers;
    meta.timeout = config.globalTimeout;
    meta.fullyParallel = config.fullyParallel;
    return meta;
  }
}
