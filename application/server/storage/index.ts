import { LocalStorageAdapter } from './local'
import { S3StorageAdapter } from './s3'
import type { StorageAdapter, S3Config } from './types'

let storageInstance: StorageAdapter | null = null

/**
 * Get the storage adapter instance
 * Uses environment variables to determine which storage backend to use
 *
 * Environment variables:
 * - STORAGE_TYPE: 'local' (default) or 's3'
 * - STORAGE_PATH: Path for local storage (default: '.data/storage')
 * - S3_BUCKET: S3 bucket name (required if STORAGE_TYPE=s3)
 * - S3_REGION: AWS region (required if STORAGE_TYPE=s3)
 * - S3_ACCESS_KEY_ID: AWS access key (required if STORAGE_TYPE=s3)
 * - S3_SECRET_ACCESS_KEY: AWS secret key (required if STORAGE_TYPE=s3)
 * - S3_ENDPOINT: Optional custom S3 endpoint
 */
export function getStorage(): StorageAdapter {
  if (storageInstance) {
    return storageInstance
  }

  const storageType = process.env.STORAGE_TYPE || 'local'

  if (storageType === 's3') {
    // Validate S3 configuration
    const bucket = process.env.S3_BUCKET
    const region = process.env.S3_REGION
    const accessKeyId = process.env.S3_ACCESS_KEY_ID
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY

    if (!bucket || !region || !accessKeyId || !secretAccessKey) {
      throw new Error(
        'S3 storage requires S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY environment variables'
      )
    }

    const s3Config: S3Config = {
      bucket,
      region,
      accessKeyId,
      secretAccessKey,
      endpoint: process.env.S3_ENDPOINT
    }

    console.log(`[Storage] Initializing S3 storage with bucket: ${bucket}, region: ${region}`)
    storageInstance = new S3StorageAdapter(s3Config)
  } else {
    // Default to local storage
    const storagePath = process.env.STORAGE_PATH || '.data/storage'
    console.log(`[Storage] Initializing local storage at: ${storagePath}`)
    storageInstance = new LocalStorageAdapter(storagePath)
  }

  return storageInstance
}

/**
 * Reset the storage instance (useful for testing)
 */
export function resetStorage(): void {
  storageInstance = null
}
