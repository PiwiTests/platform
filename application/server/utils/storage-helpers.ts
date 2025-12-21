import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import type { StorageAdapter } from '../storage/types'

/**
 * Upload a directory tree to storage
 * @param localDir - Local directory path to upload
 * @param storagePrefix - Prefix path in storage
 * @param storage - Storage adapter
 * @returns Total size of uploaded files
 */
export async function uploadDirectory(
  localDir: string,
  storagePrefix: string,
  storage: StorageAdapter
): Promise<number> {
  let totalSize = 0

  const entries = await readdir(localDir, { withFileTypes: true })

  for (const entry of entries) {
    const localPath = join(localDir, entry.name)
    const storagePath = join(storagePrefix, entry.name)

    if (entry.isDirectory()) {
      // Recursively upload subdirectory
      totalSize += await uploadDirectory(localPath, storagePath, storage)
    } else if (entry.isFile()) {
      // Upload file
      const fileContent = await readFile(localPath)
      await storage.writeFile(storagePath, fileContent)
      totalSize += fileContent.length
    }
  }

  return totalSize
}
