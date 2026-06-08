import { execSync } from 'child_process'

export class MetadataCollector {
  collect(config: any, suite: any, options: any): Record<string, unknown> {
    const metadata: Record<string, unknown> = {}

    if (options.projectDescription) metadata.projectDescription = options.projectDescription
    if (options.relatedIssue) metadata.relatedIssue = options.relatedIssue
    if (options.ciInfo) metadata.ciInfo = options.ciInfo
    if (options.tags && Array.isArray(options.tags)) metadata.tags = options.tags
    if (options.customData) metadata.customData = options.customData

    if (options.collectScmInfo) {
      const scm = this.collectScmInfo(options)
      if (scm) metadata.scm = scm
    }

    if (options.collectCiInfo) {
      const ci = this.collectCiInfo()
      if (ci) metadata.ci = ci
    }

    const htmlMeta = this.extractHtmlReportMetadata(config)
    if (htmlMeta && Object.keys(htmlMeta).length > 0) metadata.htmlReport = htmlMeta
    if (config.metadata) metadata.playwrightConfig = config.metadata

    if (suite?.allTests) {
      const all = suite.allTests()
      if (all.length > 0) {
        const first = all[0]
        if (first?.parent?.project) {
          const proj = first.parent.project()
          if (proj?.metadata) metadata.playwrightProject = proj.metadata
        }
      }
    }

    return metadata
  }

  private collectScmInfo(options: any): Record<string, string> | undefined {
    const scm: Record<string, string> = {}
    try {
      const execOpts = { encoding: 'utf8' as const, timeout: 5000, maxBuffer: 1024 * 1024 }
      scm.commit = execSync('git rev-parse HEAD', execOpts).trim()
      scm.branch = execSync('git rev-parse --abbrev-ref HEAD', execOpts).trim()
      scm.author = execSync('git log -1 --pretty=format:"%an"', execOpts).trim()
      scm.commitMessage = execSync('git log -1 --pretty=format:"%s"', execOpts).trim()
      try { scm.remoteUrl = execSync('git config --get remote.origin.url', execOpts).trim() } catch { /* optional */ }
    } catch (error: any) {
      if (options.verbose) console.log('[Piwi Dashboard] Git info not available:', error.message)
    }
    return Object.keys(scm).length > 0 ? scm : undefined
  }

  private collectCiInfo(): Record<string, string | boolean> | undefined {
    const ci: Record<string, string | boolean> = {}
    const env = process.env

    if (env.JENKINS_URL) {
      ci.provider = 'Jenkins'
      ci.buildNumber = env.BUILD_NUMBER
      ci.buildUrl = env.BUILD_URL
      ci.jobName = env.JOB_NAME
    } else if (env.GITHUB_ACTIONS) {
      ci.provider = 'GitHub Actions'
      ci.runId = env.GITHUB_RUN_ID
      ci.runNumber = env.GITHUB_RUN_NUMBER
      ci.workflow = env.GITHUB_WORKFLOW
      ci.actor = env.GITHUB_ACTOR
      ci.repository = env.GITHUB_REPOSITORY
      ci.ref = env.GITHUB_REF
      ci.sha = env.GITHUB_SHA
      ci.serverUrl = env.GITHUB_SERVER_URL
      if (ci.serverUrl && ci.repository && ci.runId) {
        ci.buildUrl = `${ci.serverUrl}/${ci.repository}/actions/runs/${ci.runId}`
      }
    } else if (env.GITLAB_CI) {
      ci.provider = 'GitLab CI'
      ci.pipelineId = env.CI_PIPELINE_ID
      ci.pipelineUrl = env.CI_PIPELINE_URL
      ci.jobId = env.CI_JOB_ID
      ci.jobUrl = env.CI_JOB_URL
      ci.jobName = env.CI_JOB_NAME
    } else if (env.CIRCLECI) {
      ci.provider = 'CircleCI'
      ci.buildNumber = env.CIRCLE_BUILD_NUM
      ci.buildUrl = env.CIRCLE_BUILD_URL
      ci.jobName = env.CIRCLE_JOB
      ci.workflow = env.CIRCLE_WORKFLOW_ID
    } else if (env.TRAVIS) {
      ci.provider = 'Travis CI'
      ci.buildNumber = env.TRAVIS_BUILD_NUMBER
      ci.buildUrl = env.TRAVIS_BUILD_WEB_URL
      ci.jobNumber = env.TRAVIS_JOB_NUMBER
    } else if (env.TF_BUILD) {
      ci.provider = 'Azure Pipelines'
      ci.buildNumber = env.BUILD_BUILDNUMBER
      ci.buildId = env.BUILD_BUILDID
      if (env.SYSTEM_TEAMFOUNDATIONSERVERURI && env.SYSTEM_TEAMPROJECT && env.BUILD_BUILDID) {
        ci.buildUrl = `${env.SYSTEM_TEAMFOUNDATIONSERVERURI}${env.SYSTEM_TEAMPROJECT}/_build/results?buildId=${env.BUILD_BUILDID}`
      }
      ci.jobName = env.AGENT_JOBNAME
    } else if (env.CI) {
      ci.provider = 'Unknown CI'
      ci.detected = true
    }

    return Object.keys(ci).length > 0 ? ci : undefined
  }

  private extractHtmlReportMetadata(config: any): Record<string, unknown> {
    const meta: Record<string, unknown> = {}
    if (config.projects?.length > 0) {
      meta.projects = config.projects.map((p: any) => ({
        name: p.name,
        testDir: p.testDir,
        use: {
          browserName: p.use?.browserName || p.name,
          viewport: p.use?.viewport,
          deviceScaleFactor: p.use?.deviceScaleFactor
        }
      }))
    }
    meta.workers = config.workers
    meta.timeout = config.timeout
    meta.fullyParallel = config.fullyParallel
    return meta
  }
}
