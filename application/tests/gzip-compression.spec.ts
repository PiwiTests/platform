import { test, expect } from '@playwright/test'
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { gzip } from 'zlib'
import { promisify } from 'util'

const gzipAsync = promisify(gzip)

/** Build a custom .gz archive (same format as reporter/compression.js) from a list of { path, content } entries */
async function buildArchive(files: Array<{ path: string, content: Buffer }>): Promise<Buffer> {
  const parts: Buffer[] = []
  for (const file of files) {
    const pathBuffer = Buffer.from(file.path, 'utf8')
    const pathLengthBuffer = Buffer.allocUnsafe(4)
    pathLengthBuffer.writeUInt32LE(pathBuffer.length, 0)
    const contentLengthBuffer = Buffer.allocUnsafe(4)
    contentLengthBuffer.writeUInt32LE(file.content.length, 0)
    parts.push(pathLengthBuffer, pathBuffer, contentLengthBuffer, file.content)
  }
  const uncompressed = Buffer.concat(parts)
  return gzipAsync(uncompressed, { level: 9 })
}

test.describe('Gzip Compression Tests', () => {
  const tempDir = join(process.cwd(), '.test-temp-gzip')

  test.beforeAll(async () => {
    // Create temp directory for test files
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true })
    }

    // Create a mock HTML report structure
    const reportDir = join(tempDir, 'mock-report')
    mkdirSync(reportDir, { recursive: true })

    writeFileSync(join(reportDir, 'index.html'), `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Test Report</title>
          <link rel="stylesheet" href="style.css">
        </head>
        <body>
          <h1>Playwright Test Report</h1>
          <script src="script.js"></script>
        </body>
      </html>
    `)

    writeFileSync(join(reportDir, 'style.css'), `
      body { font-family: Arial, sans-serif; }
      h1 { color: #007bff; }
    `)

    writeFileSync(join(reportDir, 'script.js'), `
      console.log('Test report loaded');
    `)

    // Create a gzip-compressed archive
    const files: Array<{ path: string, content: Buffer }> = []

    function collectFiles(dir: string, baseDir = '') {
      const entries = readdirSync(dir, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        const relativePath = join(baseDir, entry.name)

        if (entry.isDirectory()) {
          collectFiles(fullPath, relativePath)
        } else if (entry.isFile()) {
          const content = readFileSync(fullPath)
          files.push({
            path: relativePath,
            content: content
          })
        }
      }
    }

    collectFiles(reportDir)

    // Create simple archive format
    const parts: Buffer[] = []

    for (const file of files) {
      const pathBuffer = Buffer.from(file.path, 'utf8')
      const pathLengthBuffer = Buffer.allocUnsafe(4)
      pathLengthBuffer.writeUInt32LE(pathBuffer.length, 0)

      const contentLengthBuffer = Buffer.allocUnsafe(4)
      contentLengthBuffer.writeUInt32LE(file.content.length, 0)

      parts.push(pathLengthBuffer, pathBuffer, contentLengthBuffer, file.content)
    }

    const uncompressed = Buffer.concat(parts)
    const compressed = await gzipAsync(uncompressed, { level: 9 })

    writeFileSync(join(tempDir, 'report.gz'), compressed)

    // Create a mock blob-report archive (contains a .zip file, not index.html)
    const blobArchive = await buildArchive([
      { path: 'report.zip', content: Buffer.from('PK\x03\x04mock-zip-content') }
    ])
    writeFileSync(join(tempDir, 'blob-report.gz'), blobArchive)
  })

  test('should upload test results with gzip-compressed HTML report', async ({ request }) => {
    const reportBuffer = readFileSync(join(tempDir, 'report.gz'))

    const response = await request.post('/api/test-runs/upload', {
      multipart: {
        projectName: 'gzip-test-project',
        testRun: JSON.stringify({
          status: 'passed',
          startTime: new Date().toISOString(),
          duration: 120000,
          totalTests: 3,
          passedTests: 3,
          failedTests: 0,
          skippedTests: 0
        }),
        testCases: JSON.stringify([
          {
            title: 'test with gzip report',
            status: 'passed',
            duration: 1000,
            location: 'tests/test.spec.ts:10:5'
          }
        ]),
        htmlReport: {
          name: 'playwright-report.gz',
          mimeType: 'application/gzip',
          buffer: reportBuffer
        }
      }
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.success).toBe(true)
    expect(data.testRunId).toBeDefined()
    expect(data.projectId).toBeDefined()
    expect(data.reportPath).toBeDefined()
  })

  test('should decompress and serve HTML report files', async ({ request }) => {
    const reportBuffer = readFileSync(join(tempDir, 'report.gz'))

    // Upload the report
    const uploadResponse = await request.post('/api/test-runs/upload', {
      multipart: {
        projectName: 'gzip-serve-test-project',
        testRun: JSON.stringify({
          status: 'passed',
          startTime: new Date().toISOString(),
          duration: 60000,
          totalTests: 1,
          passedTests: 1,
          failedTests: 0,
          skippedTests: 0
        }),
        testCases: JSON.stringify([{
          title: 'serve test',
          status: 'passed',
          duration: 500
        }]),
        htmlReport: {
          name: 'playwright-report.gz',
          mimeType: 'application/gzip',
          buffer: reportBuffer
        }
      }
    })

    const uploadData = await uploadResponse.json()
    expect(uploadData.reportPath).toBeDefined()

    // Try to download the decompressed index.html
    if (uploadData.reportPath) {
      const reportPath = uploadData.reportPath.replace('.data/storage/', '')
      const downloadResponse = await request.get(`/api/files/${reportPath}`)

      expect(downloadResponse.ok()).toBeTruthy()
      expect(downloadResponse.headers()['content-type']).toContain('text/html')

      const htmlContent = await downloadResponse.text()
      expect(htmlContent).toContain('Playwright Test Report')
    }
  })

  test('should handle gzip file MIME type correctly', async ({ request }) => {
    const reportBuffer = readFileSync(join(tempDir, 'report.gz'))

    // Upload and then verify MIME type if served as .gz
    const uploadResponse = await request.post('/api/test-runs/upload', {
      multipart: {
        projectName: 'gzip-mime-test',
        testRun: JSON.stringify({
          status: 'passed',
          startTime: new Date().toISOString(),
          duration: 60000,
          totalTests: 1,
          passedTests: 1,
          failedTests: 0,
          skippedTests: 0
        }),
        testCases: JSON.stringify([{
          title: 'mime test',
          status: 'passed',
          duration: 500
        }]),
        htmlReport: {
          name: 'report.gz',
          mimeType: 'application/gzip',
          buffer: reportBuffer
        }
      }
    })

    expect(uploadResponse.ok()).toBeTruthy()
  })

  test('blob report: stored path points to the zip file, not index.html', async ({ request }) => {
    const reportBuffer = readFileSync(join(tempDir, 'blob-report.gz'))

    const uploadResponse = await request.post('/api/test-runs/upload', {
      multipart: {
        projectName: 'blob-gz-test-project',
        testRun: JSON.stringify({
          status: 'passed',
          startTime: new Date().toISOString(),
          duration: 30000,
          totalTests: 1,
          passedTests: 1,
          failedTests: 0,
          skippedTests: 0
        }),
        testCases: JSON.stringify([{ title: 'blob test', status: 'passed', duration: 300 }]),
        report_blob: {
          name: 'blob-report.gz',
          mimeType: 'application/gzip',
          buffer: reportBuffer
        }
      }
    })

    expect(uploadResponse.ok()).toBeTruthy()
    const uploadData = await uploadResponse.json()
    const blobReport = uploadData.reports?.find((r: { type: string }) => r.type === 'blob')
    expect(blobReport).toBeDefined()
    // Path must end with .zip (the blob report archive), NOT index.html
    expect(blobReport.path).toMatch(/\.zip$/)
    expect(blobReport.path).not.toMatch(/index\.html$/)

    // The zip file must be downloadable
    const downloadResponse = await request.get(`/api/files/${blobReport.path}`)
    expect(downloadResponse.ok()).toBeTruthy()
  })
})
