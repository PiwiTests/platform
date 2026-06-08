import * as crypto from 'crypto'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'
import { HttpClient } from './http-client.js'

import { type DashboardReporterOptions, resolveOptions } from './config.js'
export function getSetupFilePath(projectName: string): string {
  const hash = crypto.createHash('sha1').update(projectName).digest('hex').slice(0, 16)
  return path.join(os.tmpdir(), `piwi-dashboard-setup-${hash}.json`)
}

export function computeInstanceId(projectName: string): string {
  return crypto.createHash('sha256')
    .update([os.hostname(), projectName].join('|'))
    .digest('hex')
    .slice(0, 16)
}

export function createGlobalSetup(
  options: DashboardReporterOptions,
  userSetup?: (config: any) => any
): (config: any) => Promise<any> {
  return async function globalSetupFn(config: any) {
    const opts = resolveOptions(options as any)
    const httpClient = new HttpClient(opts.serverUrl!, opts.verbose)

    try {
      let auth: string | null = opts.apiKey || null
      if (!auth && opts.username && opts.password) {
        auth = await httpClient.login(opts.username, opts.password)
      }

      const response = await httpClient.postJSON('/api/test-runs/setup', {
        projectName: opts.projectName,
        projectDescription: opts.projectDescription,
        environment: opts.environment || null,
        startTime: new Date().toISOString(),
        instanceId: computeInstanceId(opts.projectName!)
      }, auth)

      if (response?.runId && response?.setupToken) {
        fs.writeFileSync(getSetupFilePath(opts.projectName!), JSON.stringify({
          runId: response.runId,
          setupToken: response.setupToken,
          projectName: opts.projectName
        }))
        if (opts.verbose) console.log(`[Piwi Dashboard] Global setup: initialising run #${response.runId}`)
      }
    } catch (error: any) {
      console.warn(`[Piwi Dashboard] Could not register global setup: ${error.message}`)
    }

    if (userSetup) return userSetup(config)
  }
}
