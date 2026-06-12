import * as crypto from "crypto";
import * as path from "path";
import * as os from "os";

export function getSetupFilePath(projectName: string): string {
  const hash = crypto.createHash("sha1").update(projectName).digest("hex").slice(0, 16);
  return path.join(os.tmpdir(), `piwi-dashboard-setup-${hash}.json`);
}

export function computeInstanceId(projectName: string): string {
  return crypto.createHash("sha256").update([os.hostname(), projectName].join("|")).digest("hex").slice(0, 16);
}

/**
 * Create a simple concurrency limiter. The returned function runs the given
 * async task as soon as a slot is free, queuing it otherwise.
 */
export function createLimiter(maxConcurrent: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    active--;
    const run = queue.shift();
    if (run) run();
  };

  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        fn().then(resolve, reject).finally(next);
      };
      if (active < maxConcurrent) run();
      else queue.push(run);
    });
  };
}
