export interface ChangedFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface ScmCommit {
  sha: string;
  message: string;
}

export interface ScmCommitDetail {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
}

export interface ScmChanges {
  commits: ScmCommit[];
  files: ChangedFile[];
  /** true when the raw diff was skipped because it exceeded the size cap */
  patchesOmitted?: boolean;
}

export const MAX_SCM_FILES = 30;
export const MAX_PATCH_PER_FILE = 1500;
export const MAX_RAW_DIFF_BYTES = 200_000;
export const FETCH_TIMEOUT_MS = 10_000;

export function truncatePatch(patch: string): string {
  if (patch.length <= MAX_PATCH_PER_FILE) return patch;
  return patch.slice(0, MAX_PATCH_PER_FILE) + '\n[... patch truncated ...]';
}

export abstract class ScmProvider {
  abstract readonly provider: 'github' | 'gitlab' | 'bitbucket';
  protected readonly token: string | null;

  constructor(token: string | null) {
    this.token = token;
  }

  protected makeHeaders(): Record<string, string> {
    const h: Record<string, string> = { 'User-Agent': 'piwi-dashboard' };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  abstract listCommits(limit?: number): Promise<ScmCommitDetail[]>;
  abstract fetchChanges(fromSha: string, toSha: string): Promise<ScmChanges | null>;
  abstract fetchCommitDiff(sha: string): Promise<ScmChanges | null>;
  abstract probeError(): Promise<string | null>;
}
