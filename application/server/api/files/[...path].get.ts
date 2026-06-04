import { extname } from 'path'
import { getStorage } from '../../storage'
import { gunzip } from 'zlib'
import { promisify } from 'util'

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

  // 1. Try exact path
  if (await storage.exists(path)) {
    const fileContent = await storage.readFile(path)
    const ext = extname(path).toLowerCase()
    setResponseHeader(event, 'Content-Type', setContentType(ext))
    setResponseHeader(event, 'Content-Length', fileContent.length)
    return fileContent
  }

  // 2. Try path + /index.html (directory without explicit index.html)
  const indexPath = `${path.replace(/\/+$/, '')}/index.html`
  if (await storage.exists(indexPath)) {
    const fileContent = await storage.readFile(indexPath)
    setResponseHeader(event, 'Content-Type', 'text/html')
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
