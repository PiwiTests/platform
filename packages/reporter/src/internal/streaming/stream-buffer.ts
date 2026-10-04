import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { hashForProject } from '../support/instance-id.js';
import type { StreamEvent } from '../../types.js';

/**
 * Persistent JSONL buffer on disk for live events that could not be delivered.
 * The file is scoped to the project and the run, so its events are only ever
 * replayed into the run they came from.
 */
export class StreamBuffer {
  private readonly prefix: string;
  private filePath: string | null = null;

  constructor(projectName: string) {
    this.prefix = `piwi-dashboard-stream-${hashForProject(projectName)}`;
  }

  /** Scope the buffer to a run. Until then the buffer is empty and appends are dropped. */
  bindRun(runId: number): void {
    this.filePath = path.join(os.tmpdir(), `${this.prefix}-${runId}.jsonl`);
  }

  /** Append one or more events to the on-disk buffer */
  append(events: StreamEvent[]): void {
    if (!this.filePath || events.length === 0) return;
    try {
      const lines = events.map((e) => JSON.stringify(e) + '\n').join('');
      fs.appendFileSync(this.filePath, lines, 'utf8');
    } catch {
      // Non-fatal
    }
  }

  /** Load all buffered events of the bound run from disk */
  load(): StreamEvent[] {
    if (!this.filePath) return [];
    try {
      if (fs.existsSync(this.filePath)) {
        const content = fs.readFileSync(this.filePath, 'utf8');
        return content
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as StreamEvent);
      }
    } catch {
      // Non-fatal
    }
    return [];
  }

  /** Delete the bound run's buffer file from disk */
  clear(): void {
    if (!this.filePath) return;
    try {
      if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath);
    } catch {
      // Non-fatal
    }
  }

  /** Remove this project's buffer files older than `maxAgeMs` (default 2 hours). Used on startup to discard orphaned data. */
  clearStale(maxAgeMs: number = 7200000): void {
    const dir = os.tmpdir();
    let names: string[];
    try {
      names = fs.readdirSync(dir).filter((name) => name.startsWith(this.prefix));
    } catch {
      return;
    }
    for (const name of names) {
      try {
        const file = path.join(dir, name);
        if (Date.now() - fs.statSync(file).mtimeMs > maxAgeMs) fs.unlinkSync(file);
      } catch {
        // Non-fatal
      }
    }
  }
}
