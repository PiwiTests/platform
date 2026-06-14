import * as crypto from "crypto";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import type { DashboardReporterOptions } from "./config.js";
import { resolveOptions } from "./config.js";
import { HttpClient } from "./http-client.js";

export function hashForProject(projectName: string): string {
  return crypto.createHash("sha1").update(projectName).digest("hex").slice(0, 16);
}

export function getSetupFilePath(projectName: string): string {
  return path.join(os.tmpdir(), `piwi-dashboard-setup-${hashForProject(projectName)}.json`);
}

export function computeInstanceId(projectName: string): string {
  return crypto.createHash("sha256").update([os.hostname(), projectName].join("|")).digest("hex").slice(0, 16);
}

export interface SetupInfo {
  runId: number;
  setupToken: string;
  projectName: string;
}

export function readSetupInfo(projectName: string): SetupInfo | null {
  const setupFile = getSetupFilePath(projectName);
  try {
    if (fs.existsSync(setupFile)) {
      const info = JSON.parse(fs.readFileSync(setupFile, "utf8"));
      fs.unlinkSync(setupFile);
      if (info.projectName === projectName) return info;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function readSourceSnippet(file: string, line: number, context: number): string | null {
  try {
    const content = fs.readFileSync(file, "utf-8");
    const lines = content.split("\n");
    const start = Math.max(0, line - context - 1);
    const end = Math.min(lines.length, line + context);
    return lines
      .slice(start, end)
      .map((l, i) => {
        const lineNum = start + i + 1;
        const marker = lineNum === line ? "> " : "  ";
        return `${marker}${String(lineNum).padStart(4)} | ${l}`;
      })
      .join("\n");
  } catch {
    return null;
  }
}

export function createLimiter(maxConcurrent: number): <T>(fn: () => Promise<T>) => Promise<T> {
  const limitValue = Math.max(1, Math.floor(maxConcurrent));
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
        Promise.resolve().then(fn).then(resolve, reject).finally(next);
      };
      if (active < limitValue) run();
      else queue.push(run);
    });
  };
}

export function createGlobalSetup(
  options?: DashboardReporterOptions,
  userSetup?: (config: any) => any,
): (config: any) => Promise<any> {
  return async function globalSetupFn(config: any) {
    const opts = resolveOptions((options ?? {}) as Record<string, any>);

    if (!opts.serverUrl) {
      console.log("[Piwi Dashboard] Not enabled — set PIWI_DASHBOARD_URL or serverUrl to enable.");
      if (userSetup) return userSetup(config);
      return;
    }

    const piwiReporterPath = path.resolve(__dirname, "index.js");
    const hasPiwi =
      Array.isArray(config?.reporter) &&
      config.reporter.some((r: any) => {
        if (!Array.isArray(r) || typeof r[0] !== "string") return false;
        if (r[0].toLowerCase().includes("piwi")) return true;
        try {
          return path.resolve(require.resolve(r[0])) === piwiReporterPath;
        } catch {
          return false;
        }
      });

    if (!hasPiwi) {
      if (opts.verbose) console.log("[Piwi Dashboard] Not reporting — Piwi is not in the Playwright reporters list.");
      if (userSetup) return userSetup(config);
      return;
    }

    const httpClient = new HttpClient(opts.serverUrl, opts.verbose);

    try {
      const auth = await httpClient.resolveAuth(opts);
      const response = await httpClient.postJSON(
        "/api/test-runs/setup",
        {
          projectName: opts.projectName,
          projectDescription: opts.projectDescription,
          environment: opts.environment || null,
          startTime: new Date().toISOString(),
          instanceId: computeInstanceId(opts.projectName!),
        },
        auth,
      );

      if (response?.runId && response?.setupToken) {
        fs.writeFileSync(
          getSetupFilePath(opts.projectName!),
          JSON.stringify({
            runId: response.runId,
            setupToken: response.setupToken,
            projectName: opts.projectName,
          }),
        );
        if (opts.verbose) console.log(`[Piwi Dashboard] Global setup: initialising run #${response.runId}`);
      }
    } catch (error: any) {
      console.warn(`[Piwi Dashboard] Could not register global setup: ${error.message}`);
    }

    if (userSetup) return userSetup(config);
  };
}
