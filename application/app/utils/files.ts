/**
 * Convert absolute file path to API file path
 * Removes the storage path prefix to create a relative path for the API
 */
export function getFileApiPath(filePath: string): string {
  const storagePath = '.data/storage/'
  return filePath.replace(storagePath, '')
}
