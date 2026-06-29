import * as path from 'node:path';
import { errorMessage } from '../support/errors.js';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { hashForProject } from '../support/instance-id.js';
import type { HttpClient } from '../transport/http-client.js';
import { Logger } from '../support/logger.js';

/**
 * Persists a test-run payload to disk when all upload strategies fail, so the
 * data can be retried on the next run.
 */
export class CrashRecovery {
  private readonly filePath: string;

  /**
   * @param projectName Used to derive the temp-file name so recovery data is project-scoped.
   * @param logger      Prefixed logger.
   */
  constructor(
    projectName: string,
    private readonly logger: Logger = new Logger(),
  ) {
    this.filePath = path.join(os.tmpdir(), `piwi-dashboard-recovery-${hashForProject(projectName)}.json`);
  }

  /** Serialise the payload to a temp file for later retry */
  save(data: Record<string, unknown>): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(data), 'utf8');
      this.logger.info('Saved recovery data for later upload');
    } catch (error) {
      this.logger.error(`Failed to save recovery data: ${errorMessage(error)}`);
    }
  }

  /** Read the saved payload from disk, or return `null` if none exists */
  load(): Record<string, unknown> | null {
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

    this.logger.info('Found saved test data from a previous run, uploading...');

    // Strip instanceId so /submit doesn't cancel the current run (which shares
    // the same instanceId for the same project + hostname combination).
    delete data.instanceId;

    try {
      await httpClient.postJSON('/api/test-runs/submit', data, auth);
      this.logger.info('Successfully uploaded saved test data');
      this.clear();
    } catch (error) {
      this.logger.warn(`Could not upload saved test data: ${errorMessage(error)}`);
    }
  }
}
