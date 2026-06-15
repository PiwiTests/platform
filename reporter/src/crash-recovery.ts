import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { hashForProject } from './helpers.js';
import { HttpClient } from './http-client.js';

/**
 * Persists a test-run payload to disk when all upload strategies fail, so the
 * data can be retried on the next run.
 */
export class CrashRecovery {
  private filePath: string;
  private verbose: boolean;

  /**
   * @param projectName Used to derive the temp-file name so recovery data is project-scoped.
   * @param verbose     Enable verbose logging.
   */
  constructor(projectName: string, verbose?: boolean) {
    this.verbose = verbose ?? false;
    this.filePath = path.join(os.tmpdir(), `piwi-dashboard-recovery-${hashForProject(projectName)}.json`);
  }

  /** Serialise the payload to a temp file for later retry */
  save(data: Record<string, any>): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(data), 'utf8');
      console.log('[Piwi Dashboard] Saved recovery data for later upload');
    } catch (error: any) {
      console.error(`[Piwi Dashboard] Failed to save recovery data: ${error.message}`);
    }
  }

  /** Read the saved payload from disk, or return `null` if none exists */
  load(): Record<string, any> | null {
    try {
      if (fs.existsSync(this.filePath)) return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch {
      // Non-fatal
    }
    return null;
  }

  /** Delete the recovery file from disk */
  clear(): void {
    try {
      if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath);
    } catch {
      // Non-fatal
    }
  }

  /** Attempt to submit a previously saved payload. Clears the recovery file on success. */
  async tryUpload(httpClient: HttpClient, auth?: string | null): Promise<void> {
    const data = this.load();
    if (!data) return;

    console.log('[Piwi Dashboard] Found saved test data from a previous run, uploading...');

    try {
      await httpClient.postJSON('/api/test-runs/submit', data, auth);
      console.log('[Piwi Dashboard] Successfully uploaded saved test data');
      this.clear();
    } catch (error: any) {
      console.warn(`[Piwi Dashboard] Could not upload saved test data: ${error.message}`);
    }
  }
}
