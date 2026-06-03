const { execSync } = require('child_process');

/**
 * Collect SCM (git) information
 * @param {Object} options - Reporter options (for verbose flag)
 * @returns {Object|undefined} SCM info or undefined if not available
 */
function collectScmInfo(options) {
  const scm = {};
  try {
    const execOptions = { encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024 };

    // Get git commit hash
    scm.commit = execSync('git rev-parse HEAD', execOptions).trim();

    // Get git branch
    scm.branch = execSync('git rev-parse --abbrev-ref HEAD', execOptions).trim();

    // Get git author
    scm.author = execSync('git log -1 --pretty=format:"%an"', execOptions).trim();

    // Get git commit message
    scm.commitMessage = execSync('git log -1 --pretty=format:"%s"', execOptions).trim();

    // Get git remote URL (if available)
    try {
      scm.remoteUrl = execSync('git config --get remote.origin.url', execOptions).trim();
    } catch (e) {
      // Remote URL may not be available
    }
  } catch (error) {
    // Git not available or not a git repository
    if (options && options.verbose) {
      console.log('[Piwi Dashboard] Git info not available:', error.message);
    }
  }
  return Object.keys(scm).length > 0 ? scm : undefined;
}

/**
 * Collect CI environment information
 * @returns {Object|undefined} CI info or undefined if not in CI
 */
function collectCiInfo() {
  const ci = {};
  const env = process.env;

  // Detect and collect CI-specific information

  // Jenkins
  if (env.JENKINS_URL) {
    ci.provider = 'Jenkins';
    ci.buildNumber = env.BUILD_NUMBER;
    ci.buildUrl = env.BUILD_URL;
    ci.jobName = env.JOB_NAME;
  }

  // GitHub Actions
  else if (env.GITHUB_ACTIONS) {
    ci.provider = 'GitHub Actions';
    ci.runId = env.GITHUB_RUN_ID;
    ci.runNumber = env.GITHUB_RUN_NUMBER;
    ci.workflow = env.GITHUB_WORKFLOW;
    ci.actor = env.GITHUB_ACTOR;
    ci.repository = env.GITHUB_REPOSITORY;
    ci.ref = env.GITHUB_REF;
    ci.sha = env.GITHUB_SHA;
    ci.serverUrl = env.GITHUB_SERVER_URL;
    // Only construct build URL if all required parts are available
    if (ci.serverUrl && ci.repository && ci.runId) {
      ci.buildUrl = `${ci.serverUrl}/${ci.repository}/actions/runs/${ci.runId}`;
    }
  }

  // GitLab CI
  else if (env.GITLAB_CI) {
    ci.provider = 'GitLab CI';
    ci.pipelineId = env.CI_PIPELINE_ID;
    ci.pipelineUrl = env.CI_PIPELINE_URL;
    ci.jobId = env.CI_JOB_ID;
    ci.jobUrl = env.CI_JOB_URL;
    ci.jobName = env.CI_JOB_NAME;
  }

  // CircleCI
  else if (env.CIRCLECI) {
    ci.provider = 'CircleCI';
    ci.buildNumber = env.CIRCLE_BUILD_NUM;
    ci.buildUrl = env.CIRCLE_BUILD_URL;
    ci.jobName = env.CIRCLE_JOB;
    ci.workflow = env.CIRCLE_WORKFLOW_ID;
  }

  // Travis CI
  else if (env.TRAVIS) {
    ci.provider = 'Travis CI';
    ci.buildNumber = env.TRAVIS_BUILD_NUMBER;
    ci.buildUrl = env.TRAVIS_BUILD_WEB_URL;
    ci.jobNumber = env.TRAVIS_JOB_NUMBER;
  }

  // Azure Pipelines
  else if (env.TF_BUILD) {
    ci.provider = 'Azure Pipelines';
    ci.buildNumber = env.BUILD_BUILDNUMBER;
    ci.buildId = env.BUILD_BUILDID;
    // Only construct build URL if all required parts are available
    if (env.SYSTEM_TEAMFOUNDATIONSERVERURI && env.SYSTEM_TEAMPROJECT && env.BUILD_BUILDID) {
      ci.buildUrl = `${env.SYSTEM_TEAMFOUNDATIONSERVERURI}${env.SYSTEM_TEAMPROJECT}/_build/results?buildId=${env.BUILD_BUILDID}`;
    }
    ci.jobName = env.AGENT_JOBNAME;
  }

  // Generic CI detection
  else if (env.CI) {
    ci.provider = 'Unknown CI';
    ci.detected = true;
  }

  return Object.keys(ci).length > 0 ? ci : undefined;
}

/**
 * Extract metadata from the Playwright HTML reporter config
 * @param {Object} config - Playwright FullConfig
 * @returns {Object} HTML report metadata
 */
function extractHtmlReportMetadata(config) {
  const metadata = {};

  // Extract browser/project info from config
  if (config.projects && config.projects.length > 0) {
    metadata.projects = config.projects.map(p => ({
      name: p.name,
      testDir: p.testDir,
      use: {
        browserName: p.use?.browserName,
        viewport: p.use?.viewport,
        deviceScaleFactor: p.use?.deviceScaleFactor
      }
    }));
  }

  // Add test configuration
  metadata.workers = config.workers;
  metadata.timeout = config.timeout;
  metadata.fullyParallel = config.fullyParallel;

  return metadata;
}

/**
 * Collect all metadata for the test run
 * @param {Object} config - Playwright FullConfig
 * @param {Object} suite - Playwright Suite
 * @param {Object} options - Reporter options
 * @returns {Object} Collected metadata
 */
function collectMetadata(config, suite, options) {
  const metadata = {};

  // Add user-provided metadata from options
  if (options.projectDescription) {
    metadata.projectDescription = options.projectDescription;
  }
  if (options.relatedIssue) {
    metadata.relatedIssue = options.relatedIssue;
  }
  if (options.ciInfo) {
    metadata.ciInfo = options.ciInfo;
  }
  if (options.tags && Array.isArray(options.tags)) {
    metadata.tags = options.tags;
  }
  if (options.customData) {
    metadata.customData = options.customData;
  }

  // Collect SCM info (git)
  if (options.collectScmInfo) {
    metadata.scm = collectScmInfo(options);
  }

  // Collect CI info from environment
  if (options.collectCiInfo) {
    metadata.ci = collectCiInfo();
  }

  // Extract metadata from Playwright HTML report if available
  const htmlMetadata = extractHtmlReportMetadata(config);
  if (htmlMetadata && Object.keys(htmlMetadata).length > 0) {
    metadata.htmlReport = htmlMetadata;
  }

  // Extract metadata from Playwright config
  if (config.metadata) {
    metadata.playwrightConfig = config.metadata;
  }

  // Extract project metadata from suite
  if (suite && suite.allTests && suite.allTests().length > 0) {
    const firstTest = suite.allTests()[0];
    if (firstTest && firstTest.parent && firstTest.parent.project) {
      const project = firstTest.parent.project();
      if (project && project.metadata) {
        metadata.playwrightProject = project.metadata;
      }
    }
  }

  return metadata;
}

module.exports = {
  collectScmInfo,
  collectCiInfo,
  extractHtmlReportMetadata,
  collectMetadata
};
