/**
 * OPFS-backed storage adapter for demo mode.
 *
 * Implements the same StorageAdapter interface used by the server-side local
 * and S3 adapters, but backed by the browser's Origin Private File System
 * (OPFS) via the async File System API.  No COOP / COEP headers are required
 * because only the async API is used.
 */

import type { StorageAdapter } from '~~/server/storage/types'

const ROOT_DIR = 'playwright-dashboard-demo'

async function getRootDir(): Promise<FileSystemDirectoryHandle> {
  const opfsRoot = await navigator.storage.getDirectory()
  return opfsRoot.getDirectoryHandle(ROOT_DIR, { create: true })
}

/**
 * Resolve a chain of path segments relative to `base`, optionally creating
 * intermediate directories.
 */
async function resolveDir(
  base: FileSystemDirectoryHandle,
  segments: string[],
  create = false
): Promise<FileSystemDirectoryHandle> {
  let dir = base
  for (const seg of segments) {
    if (!seg) continue
    dir = await dir.getDirectoryHandle(seg, { create })
  }
  return dir
}

function splitPath(path: string): string[] {
  return path.replace(/^\//, '').split('/').filter(Boolean)
}

export class OPFSStorageAdapter implements StorageAdapter {
  async writeFile(path: string, data: Buffer): Promise<void> {
    const parts = splitPath(path)
    const fileName = parts.pop()!
    const root = await getRootDir()
    const dir = parts.length > 0 ? await resolveDir(root, parts, true) : root
    const fh = await dir.getFileHandle(fileName, { create: true })
    const writable = await fh.createWritable()
    // Buffer.buffer is ArrayBufferLike (may be SharedArrayBuffer) which
    // FileSystemWritableFileStream.write() does not accept. Copy into a plain
    // ArrayBuffer only when necessary to avoid the overhead for normal cases.
    let ab: ArrayBuffer
    if (data.buffer instanceof ArrayBuffer) {
      ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
    } else {
      ab = new ArrayBuffer(data.byteLength)
      new Uint8Array(ab).set(data)
    }
    await writable.write(ab)
    await writable.close()
  }

  async readFile(path: string): Promise<Buffer> {
    const parts = splitPath(path)
    const fileName = parts.pop()!
    const root = await getRootDir()
    const dir = parts.length > 0 ? await resolveDir(root, parts) : root
    const fh = await dir.getFileHandle(fileName)
    const file = await fh.getFile()
    const ab = await file.arrayBuffer()
    return Buffer.from(ab)
  }

  async exists(path: string): Promise<boolean> {
    try {
      const parts = splitPath(path)
      const last = parts.pop()!
      const root = await getRootDir()
      const dir = parts.length > 0 ? await resolveDir(root, parts) : root
      // Try as file first, then as directory
      try {
        await dir.getFileHandle(last)
        return true
      } catch {
        await dir.getDirectoryHandle(last)
        return true
      }
    } catch {
      return false
    }
  }

  async mkdir(path: string): Promise<void> {
    const parts = splitPath(path)
    const root = await getRootDir()
    await resolveDir(root, parts, true)
  }

  async deleteDirectory(path: string): Promise<void> {
    try {
      const parts = splitPath(path)
      const last = parts.pop()!
      const root = await getRootDir()
      const dir = parts.length > 0 ? await resolveDir(root, parts) : root
      await dir.removeEntry(last, { recursive: true })
    } catch {
      // Ignore – already gone
    }
  }

  /** For OPFS the "full path" is just the relative path inside the root dir. */
  getFullPath(path: string): string {
    return path
  }
}
