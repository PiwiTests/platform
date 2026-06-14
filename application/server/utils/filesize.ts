import { stat, readdir } from 'fs/promises';
import { join } from 'path';

/**
 * Calculate the total size of a directory recursively
 * @param dirPath - Path to the directory
 * @returns Total size in bytes
 */
export async function getDirectorySize(dirPath: string): Promise<number> {
  let totalSize = 0;

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);

      if (entry.isDirectory()) {
        totalSize += await getDirectorySize(fullPath);
      } else if (entry.isFile()) {
        const stats = await stat(fullPath);
        totalSize += stats.size;
      }
    }
  } catch (error) {
    console.error(`Error calculating directory size for ${dirPath}:`, error);
    return 0;
  }

  return totalSize;
}
