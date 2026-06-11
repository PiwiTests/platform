import { extname } from 'path'
import { getStorage } from '../../storage'
import { gunzip } from 'zlib'
import { promisify } from 'util'
import { parseZip, buildZip } from '../../utils/trace-zip'

const gunzipAsync = promisify(gunzip)

/**
 * Parse a compressed report archive and find a specific file by name.
 * Archive format: custom binary with LE length-prefixed path+content pairs.
 */
async function findInArchive(buffer: Buffer, targetName: string): Promise<Buffer | null> {
  const uncompressed = await gunzipAsync(buffer)
  let offset = 0
  while (offset < uncompressed.length) {
    if (offset + 4 > uncompressed.length) break
    const pathLength = uncompressed.readUInt32LE(offset)
    offset += 4
    if (pathLength === 0 || pathLength > 10000) break
    if (offset + pathLength > uncompressed.length) break
    const filePath = uncompressed.toString('utf8', offset, offset + pathLength)
    offset += pathLength
    if (offset + 4 > uncompressed.length) break
    const contentLength = uncompressed.readUInt32LE(offset)
    offset += 4
    if (offset + contentLength > uncompressed.length) break
    if (filePath === targetName || filePath.endsWith(targetName)) {
      return uncompressed.subarray(offset, offset + contentLength)
    }
    offset += contentLength
  }
  return null
}

/**
 * Reconstruct a full Playwright trace ZIP from a slim ZIP and its shared resource pool.
 *
 * The slim ZIP contains only the event/network/stack entries; the manifest lists the
 * resource filenames that were extracted to the project-wide shared pool.  We fetch
 * the resources in parallel and rebuild a complete ZIP that the trace viewer can open.
 *
 * Returns null if any required component is missing so the caller can fall back.
 */
async function reconstructTraceZip(
  storage: ReturnType<typeof getStorage>,
  slimZipData: Buffer,
  manifestPath: string,
  projectPrefix: string // e.g. "project-1/"
): Promise<Buffer | null> {
  try {
    const manifestData = await storage.readFile(manifestPath)
    const manifest = JSON.parse(manifestData.toString('utf8')) as { resources?: string[] }
    const resourceNames = manifest.resources ?? []

    // Parse slim ZIP to recover event entries
    const slimEntries = parseZip(slimZipData)

    // Fetch all shared resources in parallel; skip any that are missing
    const resourceEntries = (
      await Promise.all(
        resourceNames.map(async (name) => {
          const resourcePath = `${projectPrefix}trace-resources/${name}`
          try {
            const data = await storage.readFile(resourcePath)
            return { name: `resources/${name}`, data }
          } catch {
            console.warn(`[TraceZip] Missing shared resource: ${resourcePath}`)
            return null
          }
        })
      )
    ).filter((e): e is NonNullable<typeof e> => e !== null)

    return buildZip([...slimEntries, ...resourceEntries])
  } catch (err) {
    console.warn(`[TraceZip] Reconstruction failed: ${err}`)
    return null
  }
}

export default eventHandler(async (event) => {
  const path = getRouterParam(event, 'path')

  if (!path) {
    throw createError({
      statusCode: 400,
      message: 'File path is required'
    })
  }

  // Security: Prevent path traversal
  if (path.includes('..') || path.startsWith('/')) {
    throw createError({
      statusCode: 403,
      message: 'Invalid file path'
    })
  }

  const storage = getStorage()

  // Security headers applied to all file responses
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  setResponseHeader(event, 'Cache-Control', 'no-store')

  // Helper to serve a file with the right content type
  function setContentType(ext: string): string {
    if (ext === '.html' || ext === '.htm') return 'text/html'
    if (ext === '.gz') return 'application/gzip'
    if (ext === '.zip') return 'application/zip'
    if (ext === '.json') return 'application/json'
    if (ext === '.js') return 'application/javascript'
    if (ext === '.css') return 'text/css'
    if (ext === '.png') return 'image/png'
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
    if (ext === '.svg') return 'image/svg+xml'
    if (ext === '.woff' || ext === '.woff2') return 'font/woff2'
    if (ext === '.ttf') return 'font/ttf'
    return 'application/octet-stream'
  }

  /**
   * Apply a Content-Security-Policy sandbox to untrusted HTML responses.
   * User-uploaded report HTML can contain arbitrary scripts; sandboxing
   * prevents them from executing in the dashboard's origin.
   */
  function applyHtmlCsp(): void {
    // Sandbox with allow-scripts so Playwright/Monocart reports (which rely on
    // JavaScript to render) are usable.  allow-same-origin is needed for
    // self-contained resource loads (CSS, JS, fonts, images bundled in the
    // same directory).  All other sandbox restrictions — no forms, no popups,
    // no navigation — remain in place.
    setResponseHeader(event, 'Content-Security-Policy', 'sandbox allow-scripts allow-same-origin')
  }

  // 1. Try exact path
  if (await storage.exists(path)) {
    const fileContent = await storage.readFile(path)
    const ext = extname(path).toLowerCase()

    // Slim trace blob: reconstruct full ZIP from shared resource pool
    if (ext === '.zip' && path.includes('/blobs/')) {
      const manifestPath = path.replace(/\.zip$/, '.manifest.json')
      const projectPrefix = path.split('/blobs/')[0] + '/'
      if (await storage.exists(manifestPath)) {
        const fullZip = await reconstructTraceZip(storage, fileContent, manifestPath, projectPrefix)
        if (fullZip) {
          setResponseHeader(event, 'Content-Type', 'application/zip')
          setResponseHeader(event, 'Content-Length', fullZip.length)
          return fullZip
        }
        // Reconstruction failed — fall through to serve the slim ZIP as-is
      }
    }

    // If the file is a .gz archive, try to serve index.html from inside
    if (ext === '.gz') {
      try {
        const htmlContent = await findInArchive(fileContent, 'index.html')
        if (htmlContent) {
          setResponseHeader(event, 'Content-Type', 'text/html')
          applyHtmlCsp()
          setResponseHeader(event, 'Content-Length', htmlContent.length)
          return htmlContent
        }
      } catch {
        // Fall through to serve raw gzip
      }
    }

    const contentType = setContentType(ext)
    setResponseHeader(event, 'Content-Type', contentType)
    setResponseHeader(event, 'Content-Length', fileContent.length)
    if (contentType === 'text/html') {
      applyHtmlCsp()
    }
    return fileContent
  }

  // 2. Try path + /index.html (directory without explicit index.html)
  const indexPath = `${path.replace(/\/+$/, '')}/index.html`
  if (await storage.exists(indexPath)) {
    const fileContent = await storage.readFile(indexPath)
    setResponseHeader(event, 'Content-Type', 'text/html')
    applyHtmlCsp()
    setResponseHeader(event, 'Content-Length', fileContent.length)
    return fileContent
  }

  // 3. Try path + .gz (compressed archive - decompress and serve index.html)
  const gzPath = `${path}.gz`
  if (await storage.exists(gzPath)) {
    const gzContent = await storage.readFile(gzPath)
    try {
      const htmlContent = await findInArchive(gzContent, 'index.html')
      if (htmlContent) {
        setResponseHeader(event, 'Content-Type', 'text/html')
        applyHtmlCsp()
        setResponseHeader(event, 'Content-Length', htmlContent.length)
        return htmlContent
      }
    } catch {
      // Fall through to 404
    }
  }

  throw createError({
    statusCode: 404,
    message: 'File not found'
  })
})
