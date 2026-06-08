import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { compressDirectory } from './compression.js'

export class FileHandler {
  findHTMLReportDirectory(customDir?: string): string | null {
    const possibleDirs = customDir
      ? [customDir, path.join(process.cwd(), customDir)]
      : ['playwright-report', './playwright-report', path.join(process.cwd(), 'playwright-report')]

    for (const reportDir of possibleDirs) {
      if (fs.existsSync(reportDir) && fs.statSync(reportDir).isDirectory()) {
        if (fs.existsSync(path.join(reportDir, 'index.html'))) return reportDir
      }
    }
    return null
  }

  findReportDirectory(dir: string): string | null {
    const candidates = [dir, path.join(process.cwd(), dir)]
    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate
    }
    return null
  }

  async compressReportDirectory(reportDir: string): Promise<Buffer | null> {
    try {
      return (await compressDirectory(reportDir)) || null
    } catch (error: any) {
      console.warn(`[Piwi Dashboard] Failed to compress report directory ${reportDir}: ${error.message}`)
      return null
    }
  }

  findTraceFiles(testCase: any): string[] {
    const set = new Set<string>()
    if (testCase.attachments) {
      for (const a of testCase.attachments) {
        if (a.name === 'trace' && a.path) set.add(path.resolve(a.path))
      }
    }
    return Array.from(set)
  }

  findAllAttachments(testCase: any): Array<{ name: string; path: string; contentType: string; originalName: string }> {
    const result: Array<{ name: string; path: string; contentType: string; originalName: string }> = []
    if (testCase.attachments) {
      for (const a of testCase.attachments) {
        if (a.name === 'trace') continue
        if (a.name?.startsWith('piwi-dashboard-')) continue
        if (a.path && fs.existsSync(a.path)) {
          result.push({
            name: a.name || 'attachment',
            path: path.resolve(a.path),
            contentType: a.contentType || 'application/octet-stream',
            originalName: path.basename(a.path)
          })
        }
      }
    }
    return result
  }

  getDefaultReportDirs(): Record<string, string> {
    return {
      html: 'playwright-report',
      monocart: 'monocart-report',
      allure: 'allure-report',
      blob: 'blob-report'
    }
  }

  async computeTraceHashes(testCases: any[]): Promise<Map<number, { tracePath: string; hash: string; size: number }>> {
    const result = new Map<number, { tracePath: string; hash: string; size: number }>()
    for (let i = 0; i < testCases.length; i++) {
      const tracePaths = this.findTraceFiles(testCases[i])
      let lastPath: string | null = null
      for (const tp of tracePaths) {
        if (fs.existsSync(tp)) lastPath = tp
      }
      if (!lastPath) continue

      const hash = crypto.createHash('sha256')
      await new Promise<void>((resolve, reject) => {
        fs.createReadStream(lastPath!)
          .on('data', (chunk: Buffer) => hash.update(chunk))
          .on('end', resolve)
          .on('error', reject)
      })
      result.set(i, { tracePath: lastPath, hash: hash.digest('hex'), size: fs.statSync(lastPath).size })
    }
    return result
  }

  async checkMissingTraces(httpClient: { postJSON(path: string, payload: any, auth?: string | null): Promise<any> }, projectName: string, traceHashMap: Map<number, { hash: string }>, auth: string | null): Promise<Set<string>> {
    if (traceHashMap.size === 0) return new Set()
    const hashes = [...traceHashMap.values()].map(h => h.hash)

    try {
      const response = await httpClient.postJSON('/api/traces/check', { projectName, hashes }, auth)
      const missing = Array.isArray(response.missing) ? response.missing : hashes
      return new Set(missing)
    } catch (error: any) {
      return new Set(hashes)
    }
  }
}
