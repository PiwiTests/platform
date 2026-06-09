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
