interface FixPromptInput {
  title?: string | null
  location?: string | null
  status?: string | null
  error?: string | null
  retries?: number | null
  steps?: Array<{ title: string, duration: number, category: string }> | null
  networkRequests?: Array<{ method: string, url: string, status: number, duration: number }> | null
  webVitals?: {
    navigation?: { ttfb?: number, domInteractive?: number, domContentLoaded?: number, loadComplete?: number } | null
  } | null
  duration?: number | null
  slowestStep?: string | null
  slowestStepDuration?: number | null
}

export function generateFixPrompt(tc: FixPromptInput): string {
  const title = tc.title || 'Unknown test'
  const location = tc.location || 'unknown'
  const status = tc.status || 'unknown'
  const error = tc.error
  const retries = tc.retries ?? 0
  const steps = tc.steps || []
  const networkRequests = tc.networkRequests || []
  const duration = tc.duration

  const lines: string[] = []
  lines.push(`My Playwright test "${title}" ${status === 'failed' || status === 'timedOut' ? 'failed' : 'had issues'} at ${location}.`)
  lines.push('')

  if (error) {
    lines.push('Error:')
    lines.push('```')
    lines.push(error)
    lines.push('```')
    lines.push('')
  }

  if (duration !== null && duration !== undefined) {
    const durSec = (duration / 1000).toFixed(1)
    lines.push(`Total duration: ${durSec}s.`)
  }

  if (retries > 0) {
    lines.push(`This test retried ${retries} ${retries === 1 ? 'time' : 'times'} before completing.`)
  }

  if (steps.length > 0) {
    lines.push('')
    lines.push(`The test performed ${steps.length} steps:`)
    for (const step of steps) {
      const durMs = step.duration ? ` (${step.duration}ms)` : ''
      lines.push(`  [${step.category}] ${step.title}${durMs}`)
    }
  }

  if (networkRequests.length > 0) {
    const failedRequests = networkRequests.filter(r => r.status >= 400)
    if (failedRequests.length > 0) {
      lines.push('')
      lines.push('Network requests that returned errors:')
      for (const req of failedRequests) {
        lines.push(`  ${req.method} ${req.url} → ${req.status} (${req.duration}ms)`)
      }
    }
  }

  lines.push('')
  lines.push('What went wrong and how do I fix it?')
  lines.push('')
  lines.push('Consider: Playwright best practices, locator strategies, wait conditions,')
  lines.push('network stability, test isolation, and environment differences.')

  return lines.join('\n')
}
