import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { decompress as zstdDecompress } from '@mongodb-js/zstd'

/**
 * Decompress a zstd-compressed archive buffer
 * @param compressedBuffer - Compressed buffer
 * @param targetDir - Directory to extract files to
 * @throws Error if decompression fails or archive is malformed
 */
export async function decompressDirectory(compressedBuffer: Buffer, targetDir: string): Promise<void> {
  try {
    // Decompress
    const uncompressed = Buffer.from(await zstdDecompress(compressedBuffer))

    // Parse the archive format (little-endian byte order)
    let offset = 0
    let fileCount = 0

    while (offset < uncompressed.length) {
      // Read path length
      if (offset + 4 > uncompressed.length) {
        if (offset !== uncompressed.length) {
          console.warn(`Incomplete archive data at offset ${offset}, expected ${uncompressed.length}`)
        }
        break
      }
      const pathLength = uncompressed.readUInt32LE(offset)
      offset += 4

      // Validate path length
      if (pathLength === 0 || pathLength > 10000) {
        throw new Error(`Invalid path length: ${pathLength} at offset ${offset - 4}`)
      }

      // Read path
      if (offset + pathLength > uncompressed.length) {
        throw new Error(`Incomplete path data at offset ${offset}`)
      }
      const filePath = uncompressed.toString('utf8', offset, offset + pathLength)
      offset += pathLength

      // Read content length
      if (offset + 4 > uncompressed.length) {
        throw new Error(`Incomplete content length at offset ${offset}`)
      }
      const contentLength = uncompressed.readUInt32LE(offset)
      offset += 4

      // Read content
      if (offset + contentLength > uncompressed.length) {
        throw new Error(`Incomplete content data at offset ${offset}, expected ${contentLength} bytes`)
      }
      const content = uncompressed.subarray(offset, offset + contentLength)
      offset += contentLength

      // Write file
      const fullPath = join(targetDir, filePath)
      const dirPath = dirname(fullPath)

      if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true })
      }

      writeFileSync(fullPath, content)
      fileCount++
    }

    console.log(`Successfully decompressed ${fileCount} files from archive`)
  } catch (error) {
    console.error('Failed to decompress archive:', error)
    throw error
  }
}
