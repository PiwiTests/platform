import { readFile as fsReadFile, writeFile as fsWriteFile, mkdir as fsMkdir, existsSync } from 'fs';
import { rm } from 'fs/promises';
import { join, dirname } from 'path';
import { promisify } from 'util';
import type { StorageAdapter } from './types';

const readFileAsync = promisify(fsReadFile);
const writeFileAsync = promisify(fsWriteFile);
const mkdirAsync = promisify(fsMkdir);

/**
 * Local file system storage adapter
 * Stores files in a local directory
 */
export class LocalStorageAdapter implements StorageAdapter {
  private readonly basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  async writeFile(path: string, data: Buffer): Promise<void> {
    const fullPath = join(this.basePath, path);
    const dirPath = dirname(fullPath);

    // Ensure directory exists
    if (!existsSync(dirPath)) {
      await mkdirAsync(dirPath, { recursive: true });
    }

    await writeFileAsync(fullPath, data);
  }

  async readFile(path: string): Promise<Buffer> {
    const fullPath = join(this.basePath, path);
    return await readFileAsync(fullPath);
  }

  async exists(path: string): Promise<boolean> {
    const fullPath = join(this.basePath, path);
    return existsSync(fullPath);
  }

  async mkdir(path: string): Promise<void> {
    const fullPath = join(this.basePath, path);
    if (!existsSync(fullPath)) {
      await mkdirAsync(fullPath, { recursive: true });
    }
  }

  getFullPath(path: string): string {
    return join(this.basePath, path);
  }

  async deleteFile(path: string): Promise<void> {
    const fullPath = join(this.basePath, path);
    try {
      await rm(fullPath, { force: true });
    } catch {
      // Ignore if it doesn't exist
    }
  }

  async deleteDirectory(path: string): Promise<void> {
    const fullPath = join(this.basePath, path);
    if (existsSync(fullPath)) {
      await rm(fullPath, { recursive: true, force: true });
    }
  }
}
