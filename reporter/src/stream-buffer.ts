import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { hashForProject } from './helpers.js';

export class StreamBuffer {
  private filePath: string;

  constructor(projectName: string) {
    this.filePath = path.join(os.tmpdir(), `piwi-dashboard-stream-${hashForProject(projectName)}.jsonl`);
  }

  append(events: any[]): void {
    if (events.length === 0) return;
    try {
      const lines = events.map((e) => JSON.stringify(e) + '\n').join('');
      fs.appendFileSync(this.filePath, lines, 'utf8');
    } catch {
      // Non-fatal
    }
  }

  load(): any[] {
    try {
      if (fs.existsSync(this.filePath)) {
        const content = fs.readFileSync(this.filePath, 'utf8');
        return content
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line));
      }
    } catch {
      // Non-fatal
    }
    return [];
  }

  clear(): void {
    try {
      if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath);
    } catch {
      // Non-fatal
    }
  }

  clearStale(maxAgeMs: number = 7200000): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const stats = fs.statSync(this.filePath);
        if (Date.now() - stats.mtimeMs > maxAgeMs) {
          fs.unlinkSync(this.filePath);
        }
      }
    } catch {
      // Non-fatal
    }
  }
}
