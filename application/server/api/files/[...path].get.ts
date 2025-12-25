import { extname } from 'path'
import { getStorage } from '../../storage'

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

  if (!await storage.exists(path)) {
    throw createError({
      statusCode: 404,
      message: 'File not found'
    })
  }

  try {
    const fileContent = await storage.readFile(path)
    const ext = extname(path).toLowerCase()

    // Set appropriate content type
    let contentType = 'application/octet-stream'
    if (ext === '.html' || ext === '.htm') {
      contentType = 'text/html'
    } else if (ext === '.gz') {
      contentType = 'application/gzip'
    } else if (ext === '.zip') {
      contentType = 'application/zip'
    } else if (ext === '.json') {
      contentType = 'application/json'
    } else if (ext === '.js') {
      contentType = 'application/javascript'
    } else if (ext === '.css') {
      contentType = 'text/css'
    } else if (ext === '.png') {
      contentType = 'image/png'
    } else if (ext === '.jpg' || ext === '.jpeg') {
      contentType = 'image/jpeg'
    } else if (ext === '.svg') {
      contentType = 'image/svg+xml'
    } else if (ext === '.woff' || ext === '.woff2') {
      contentType = 'font/woff2'
    } else if (ext === '.ttf') {
      contentType = 'font/ttf'
    }

    setResponseHeader(event, 'Content-Type', contentType)
    setResponseHeader(event, 'Content-Length', fileContent.length)

    return fileContent
  } catch (error: unknown) {
    console.error('Failed to read file:', path, error)
    throw createError({
      statusCode: 500,
      message: 'Failed to read file'
    })
  }
})
