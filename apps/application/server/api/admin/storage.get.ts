import { getDatabase } from '../../database';
import { getStorageAnalysis } from '#shared/handlers/admin-storage';
import { requireAuth } from '../../utils/auth';
import { getStorage } from '../../storage';
import { getDirectorySize } from '../../utils/filesize';
import { resolve } from 'path';
import type { StorageAnalysis } from '../../../types/api';

defineRouteMeta({
  openAPI: {
    tags: ['Admin'],
    summary: 'Get storage analysis',
    description:
      'Returns a breakdown of stored evidence by project, by file kind and over time, plus the physical storage location and (for local storage) the measured on-disk size. Requires administrator role.',
    'x-required-roles': ['administrator'],
  },
});

export default eventHandler(async (event): Promise<StorageAnalysis> => {
  await requireAuth(event);

  const analysis = await getStorageAnalysis(await getDatabase());

  // Actual on-disk size (local storage only). It can exceed the tracked total
  // when untracked files linger, so it doubles as an orphan signal.
  let storageSizeOnDisk: number | null = null;
  try {
    const storage = getStorage();
    storageSizeOnDisk = await getDirectorySize(resolve(storage.getFullPath('')));
  } catch {
    // S3 or other remote storage — no walkable local directory.
  }

  const databaseLocation = process.env.PIWI_DATABASE_URL
    ? 'PostgreSQL (external database)'
    : resolve(process.env.PIWI_DATABASE_PATH || '.data/piwi.db');
  const storageLocation =
    (process.env.PIWI_STORAGE_TYPE || 'local') === 's3'
      ? `S3 bucket: ${process.env.PIWI_S3_BUCKET || '(not set)'}`
      : resolve(process.env.PIWI_STORAGE_PATH || '.data/storage');

  return { ...analysis, storageSizeOnDisk, databaseLocation, storageLocation };
});
