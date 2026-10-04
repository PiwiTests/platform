import { LocalStorageAdapter } from './local';
import { S3StorageAdapter } from './s3';
import type { StorageAdapter, S3Config } from './types';

let storageInstance: StorageAdapter | null = null;

/**
 * Get the storage adapter instance
 * Uses environment variables to determine which storage backend to use
 *
 * Environment variables:
 * - PIWI_STORAGE_TYPE: 'local' (default) or 's3'
 * - PIWI_STORAGE_PATH: Path for local storage (default: '.data/storage')
 * - PIWI_S3_BUCKET: S3 bucket name (required if PIWI_STORAGE_TYPE=s3)
 * - PIWI_S3_REGION: AWS region (required if PIWI_STORAGE_TYPE=s3)
 * - PIWI_S3_ACCESS_KEY_ID: Optional static S3 access key
 * - PIWI_S3_SECRET_ACCESS_KEY: Optional static S3 secret key
 * - PIWI_S3_ENDPOINT: Optional custom S3 endpoint
 */
export function getStorage(): StorageAdapter {
  if (storageInstance) {
    return storageInstance;
  }

  const storageType = process.env.PIWI_STORAGE_TYPE || 'local';

  if (storageType === 's3') {
    // Validate S3 configuration
    const bucket = process.env.PIWI_S3_BUCKET;
    const region = process.env.PIWI_S3_REGION;
    const accessKeyId = process.env.PIWI_S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.PIWI_S3_SECRET_ACCESS_KEY;

    if (!bucket || !region) {
      throw new Error('S3 storage requires PIWI_S3_BUCKET and PIWI_S3_REGION environment variables');
    }
    if (!!accessKeyId !== !!secretAccessKey) {
      throw new Error(
        'PIWI_S3_ACCESS_KEY_ID and PIWI_S3_SECRET_ACCESS_KEY must be set together when using static S3 credentials',
      );
    }

    const baseConfig = {
      bucket,
      region,
      endpoint: process.env.PIWI_S3_ENDPOINT,
      // When PIWI_S3_FORCE_PATH_STYLE is explicitly set, use its value; otherwise default to true when a custom endpoint is configured
      ...(process.env.PIWI_S3_FORCE_PATH_STYLE !== undefined && {
        forcePathStyle: process.env.PIWI_S3_FORCE_PATH_STYLE !== 'false',
      }),
    };
    const s3Config: S3Config =
      accessKeyId && secretAccessKey ? { ...baseConfig, accessKeyId, secretAccessKey } : baseConfig;

    console.log(`[Storage] Initializing S3 storage with bucket: ${bucket}, region: ${region}`);
    storageInstance = new S3StorageAdapter(s3Config);
  } else {
    // Default to local storage
    const storagePath = process.env.PIWI_STORAGE_PATH || '.data/storage';
    console.log(`[Storage] Initializing local storage at: ${storagePath}`);
    storageInstance = new LocalStorageAdapter(storagePath);
  }

  return storageInstance;
}

/**
 * Reset the storage instance (useful for testing)
 */
export function resetStorage(): void {
  storageInstance = null;
}
