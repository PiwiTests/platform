import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import * as crypto from "crypto";
import { HttpClient } from "./http-client.js";

export class CrashRecovery {
  private filePath: string;
  private serverUrl: string;
  private verbose: boolean;

  constructor(serverUrl: string, projectName: string, verbose?: boolean) {
    this.serverUrl = serverUrl;
    this.verbose = verbose ?? false;
    const hash = crypto.createHash("sha1").update(projectName).digest("hex").slice(0, 16);
    this.filePath = path.join(os.tmpdir(), `piwi-dashboard-recovery-${hash}.json`);
  }

  save(data: Record<string, any>): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(data), "utf8");
      console.log("[Piwi Dashboard] Saved recovery data for later upload");
    } catch (error: any) {
      console.error(`[Piwi Dashboard] Failed to save recovery data: ${error.message}`);
    }
  }

  load(): Record<string, any> | null {
    try {
      if (fs.existsSync(this.filePath)) return JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    } catch {
      // Non-fatal
    }
    return null;
  }

  clear(): void {
    try {
      if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath);
    } catch {
      // Non-fatal
    }
  }

  async tryUpload(httpClient: HttpClient, auth?: string | null): Promise<void> {
    const data = this.load();
    if (!data) return;

    console.log("[Piwi Dashboard] Found saved test data from a previous run, uploading...");

    try {
      await httpClient.postJSON("/api/test-runs/submit", data, auth);
      console.log("[Piwi Dashboard] Successfully uploaded saved test data");
      this.clear();
    } catch (error: any) {
      console.warn(`[Piwi Dashboard] Could not upload saved test data: ${error.message}`);
    }
  }
}
