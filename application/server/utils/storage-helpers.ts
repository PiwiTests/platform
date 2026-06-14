import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import type { StorageAdapter } from '../storage/types';

/**
 * Upload a directory tree to storage.
 * @param localDir - Local directory path to upload
 * @param storagePrefix - Prefix path in storage
 * @param storage - Storage adapter
 * @returns Total size of uploaded files
 */
export async function uploadDirectory(
  localDir: string,
  storagePrefix: string,
  storage: StorageAdapter,
): Promise<number> {
  const entries = await readdir(localDir, { withFileTypes: true });

  const uploadTasks = entries.map(async (entry) => {
    const localPath = join(localDir, entry.name);
    const storagePath = join(storagePrefix, entry.name);

    if (entry.isDirectory()) {
      return uploadDirectory(localPath, storagePath, storage);
    }

    if (entry.isFile()) {
      const fileContent = await readFile(localPath);
      await storage.writeFile(storagePath, fileContent);
      return fileContent.length;
    }

    return 0;
  });

  const sizes = await Promise.all(uploadTasks);
  return sizes.reduce((a, b) => a + b, 0);
}
