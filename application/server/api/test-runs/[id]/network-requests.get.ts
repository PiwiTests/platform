import { getDatabase } from '../../../database'
import { testRuns, testCases, testRunsCases } from '../../../database/schema'
import { eq } from 'drizzle-orm'

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Get aggregated network request data',
    description: 'Returns aggregated network request summaries from test cases in a test run, grouped by HTTP method and normalized route, sorted by average duration. Excludes static asset requests.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }]
  }
})

interface NetworkRequest {
  method: string
  url: string
  status: number
  duration: number
  resourceType: string
  startTime?: number
}

interface EndpointSummary {
  method: string
  route: string
  count: number
  avgDuration: number
  maxDuration: number
  minDuration: number
  p90Duration: number
  errorRate: number
  testCases: string[]
}

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0')

  if (!id) {
    throw createError({ statusCode: 400, message: 'Invalid test run ID' })
  }

  const db = await getDatabase()

  // Verify run exists
  const runResults = await db.select({ id: testRuns.id })
    .from(testRuns).where(eq(testRuns.id, id))

  if (!runResults[0]) {
    throw createError({ statusCode: 404, message: 'Test run not found' })
  }

  // Fetch all test cases for this run that have network request data
  const runsCases = await db.select({
    networkRequests: testRunsCases.networkRequests,
    title: testCases.title
  })
    .from(testRunsCases)
    .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
    .where(eq(testRunsCases.testRunId, id))

  // Aggregate all network requests, keyed by method + normalized route
  const grouped = new Map<string, {
    method: string
    route: string
    durations: number[]
    statuses: number[]
    testCases: Set<string>
  }>()

  for (const runCase of runsCases) {
    const requests = runCase.networkRequests as NetworkRequest[] | null
    if (!requests || !Array.isArray(requests)) continue

    for (const req of requests) {
      // Only include API/document requests; skip static assets (script, stylesheet, image, font, media)
      // because those are not actionable for endpoint performance analysis and would add noise.
      if (req.resourceType && !['fetch', 'xhr', 'document', 'other'].includes(req.resourceType)) continue

      const route = normalizeRoute(req.url)
      const key = `${req.method}|${route}`

      if (!grouped.has(key)) {
        grouped.set(key, {
          method: req.method,
          route,
          durations: [],
          statuses: [],
          testCases: new Set()
        })
      }

      const group = grouped.get(key)!
      group.durations.push(req.duration)
      group.statuses.push(req.status)
      group.testCases.add(runCase.title)
    }
  }

  // Convert to summary objects and sort by avg duration descending
  const summaries: EndpointSummary[] = []
  for (const group of grouped.values()) {
    const sorted = [...group.durations].sort((a, b) => a - b)
    const sum = group.durations.reduce((a, b) => a + b, 0)
    const errorCount = group.statuses.filter(s => s >= 400 || s === 0).length

    summaries.push({
      method: group.method,
      route: group.route,
      count: group.durations.length,
      avgDuration: Math.round(sum / group.durations.length),
      maxDuration: sorted[sorted.length - 1] ?? 0,
      minDuration: sorted[0] ?? 0,
      p90Duration: percentile(sorted, 90),
      errorRate: group.durations.length > 0
        ? Math.round((errorCount / group.durations.length) * 100)
        : 0,
      testCases: Array.from(group.testCases)
    })
  }

  summaries.sort((a, b) => b.avgDuration - a.avgDuration)

  return summaries
})
