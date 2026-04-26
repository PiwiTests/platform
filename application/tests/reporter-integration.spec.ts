import { test, expect } from '@playwright/test'
import { readFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

test.describe('Reporter Integration Tests', () => {
  const tempDir = join(process.cwd(), '.test-temp')

  test.beforeAll(() => {
    // Create temp directory for test files
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true })
    }
  })

  test('reporter package.json should have correct metadata', async () => {
    const packageJsonPath = join(process.cwd(), '..', 'reporter', 'package.json')
    expect(existsSync(packageJsonPath)).toBe(true)

    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))

    expect(packageJson.name).toBe('playwright-dashboard-reporter')
    expect(packageJson.main).toBe('index.js')
    expect(packageJson.types).toBe('index.d.ts')
    expect(packageJson.peerDependencies).toBeDefined()
    expect(packageJson.peerDependencies['@playwright/test']).toBeDefined()
  })

  test('reporter should have TypeScript definitions', async () => {
    const typeDefsPath = join(process.cwd(), '..', 'reporter', 'index.d.ts')
    expect(existsSync(typeDefsPath)).toBe(true)

    const typeDefs = readFileSync(typeDefsPath, 'utf-8')
    expect(typeDefs).toContain('DashboardReporterOptions')
    expect(typeDefs).toContain('serverUrl')
    expect(typeDefs).toContain('projectName')
    expect(typeDefs).toContain('uploadReport')
    expect(typeDefs).toContain('uploadTraces')
  })

  test('reporter TypeScript definitions should include reports array option', async () => {
    const typeDefsPath = join(process.cwd(), '..', 'reporter', 'index.d.ts')
    const typeDefs = readFileSync(typeDefsPath, 'utf-8')

    // Verify the new multi-report option is documented
    expect(typeDefs).toContain('reports')
    expect(typeDefs).toContain('type: string')
    expect(typeDefs).toContain('dir?: string')
    expect(typeDefs).toContain('label?: string')
  })

  test('reporter fixtures.js should exist', async () => {
    const fixturesPath = join(process.cwd(), '..', 'reporter', 'fixtures.js')
    expect(existsSync(fixturesPath)).toBe(true)
  })

  test('reporter fixtures should export dashboardFixtures and test', async () => {
    const fixturesPath = join(process.cwd(), '..', 'reporter', 'fixtures.js')
    expect(existsSync(fixturesPath)).toBe(true)

    // Verify fixture exports by inspecting the source (avoids resolving @playwright/test
    // from the reporter directory which has no node_modules)
    const fixturesSource = readFileSync(fixturesPath, 'utf-8')
    expect(fixturesSource).toContain('dashboardFixtures')
    expect(fixturesSource).toContain('module.exports')
    expect(fixturesSource).toContain('page.on')
    expect(fixturesSource).toContain('requestfinished')
    expect(fixturesSource).toContain('playwright-dashboard-network')
    expect(fixturesSource).toContain('playwright-dashboard-web-vitals')
  })

  test('reporter TypeScript definitions should export dashboardFixtures type', async () => {
    const typeDefsPath = join(process.cwd(), '..', 'reporter', 'index.d.ts')
    const typeDefs = readFileSync(typeDefsPath, 'utf-8')

    expect(typeDefs).toContain('dashboardFixtures')
    expect(typeDefs).toContain('collectPerformanceMetrics')
  })

  test('reporter lib/steps.js should exist with step metrics functions', async () => {
    const stepsPath = join(process.cwd(), '..', 'reporter', 'lib', 'steps.js')
    expect(existsSync(stepsPath)).toBe(true)

    const source = readFileSync(stepsPath, 'utf-8')
    expect(source).toContain('collectStepMetrics')
    expect(source).toContain('computePerformanceSummary')
    expect(source).toContain('flattenSteps')
    expect(source).toContain('categorizeStep')
  })

  test('reporter lib/metadata.js should exist with metadata collection functions', async () => {
    const metadataPath = join(process.cwd(), '..', 'reporter', 'lib', 'metadata.js')
    expect(existsSync(metadataPath)).toBe(true)

    const source = readFileSync(metadataPath, 'utf-8')
    expect(source).toContain('collectMetadata')
    expect(source).toContain('collectScmInfo')
    expect(source).toContain('collectCiInfo')
  })

  test('reporter lib/upload.js should exist with HTTP helpers', async () => {
    const uploadPath = join(process.cwd(), '..', 'reporter', 'lib', 'upload.js')
    expect(existsSync(uploadPath)).toBe(true)

    const source = readFileSync(uploadPath, 'utf-8')
    expect(source).toContain('postJSON')
    expect(source).toContain('postFormData')
  })

  test('reporter lib/files.js should exist with file discovery functions', async () => {
    const filesPath = join(process.cwd(), '..', 'reporter', 'lib', 'files.js')
    expect(existsSync(filesPath)).toBe(true)

    const source = readFileSync(filesPath, 'utf-8')
    expect(source).toContain('findHTMLReportDirectory')
    expect(source).toContain('findReportDirectory')
    expect(source).toContain('compressReportDirectory')
    expect(source).toContain('findTraceFiles')
    expect(source).toContain('DEFAULT_REPORT_DIRS')
  })

  test('reporter lib/files.js DEFAULT_REPORT_DIRS should include monocart, and blob', async () => {
    const filesPath = join(process.cwd(), '..', 'reporter', 'lib', 'files.js')
    const source = readFileSync(filesPath, 'utf-8')

    expect(source).toContain('monocart')
    expect(source).toContain('blob')
  })
})
