import { getDatabase } from '../../database';
import { getAdminStats } from '#shared/handlers/admin';
import { requireAuth } from '../../utils/auth';
import { getStorage } from '../../storage';
import { getDirectorySize } from '../../utils/filesize';
import { resolve } from 'path';

defineRouteMeta({
  openAPI: {
    tags: ['Admin'],
    summary: 'Get admin statistics',
    description:
      'Returns aggregate statistics about projects, test runs, test cases, files, and storage disk usage. Requires `storage:manage` (administrators only).',
    'x-required-permission': 'storage:manage',
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);

  const stats = await getAdminStats(await getDatabase());

  // Try to get actual storage size on disk (local storage only — server-specific)
  let storageSizeOnDisk: number | null = null;
  try {
    const storage = getStorage();
    const storagePath = storage.getFullPath('');
    const absolutePath = resolve(storagePath);
    storageSizeOnDisk = await getDirectorySize(absolutePath);
  } catch {
    // S3 or other storage — skip disk size
  }

  // Where the data physically resides (resolved absolute paths for the local
  // SQLite + filesystem backends; a label for the remote ones so no credentials
  // leak). Mirrors how storageSizeOnDisk is computed at the route level.
  const databaseLocation = process.env.PIWI_DATABASE_URL
    ? 'PostgreSQL (external database)'
    : resolve(process.env.PIWI_DATABASE_PATH || '.data/piwi.db');
  const storageLocation =
    (process.env.PIWI_STORAGE_TYPE || 'local') === 's3'
      ? `S3 bucket: ${process.env.PIWI_S3_BUCKET || '(not set)'}`
      : resolve(process.env.PIWI_STORAGE_PATH || '.data/storage');

  return {
    ...stats,
    storageSizeOnDisk,
    databaseLocation,
    storageLocation,
  };
});
