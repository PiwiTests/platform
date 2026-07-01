import { getDatabase } from '../../database';
import { getAdminStats } from '#shared/handlers/admin';
import { requireAuth } from '../../utils/auth';
import { Role } from '#shared/types';
import { getStorage } from '../../storage';
import { getDirectorySize } from '../../utils/filesize';
import { resolve } from 'path';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR];

defineRouteMeta({
  openAPI: {
    tags: ['Admin'],
    summary: 'Get admin statistics',
    description:
      'Returns aggregate statistics about projects, test runs, test cases, files, and storage disk usage. Requires administrator role.',
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event, REQUIRED_ROLES);

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

  return {
    ...stats,
    storageSizeOnDisk,
  };
});
