/**
 * The wire shape of an offline export.
 *
 * One bundle drives every output format: the HTML report, the ZIP's
 * `data.json`, the Markdown summary and the JSON download. Collecting it is
 * shared by the server and the demo; only asset bytes are fetched differently.
 */

export type ExportKind = 'execution' | 'cluster';

export const EXPORT_FORMATS = ['html', 'zip', 'pdf', 'json', 'md'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export type ExportOmissionReason = 'too-large' | 'budget-exhausted' | 'unreadable' | 'html-format' | 'pdf-format';

/** An evidence file left out of this export, and why. */
export interface ExportOmission {
  name: string;
  kind: string;
  bytes: number | null;
  reason: ExportOmissionReason;
}

/** A single piece of evidence attached to an execution. */
export interface ExportAsset {
  /** Storage path — the identity used to read the bytes. */
  storagePath: string;
  /** Path inside a ZIP export, relative to its root. */
  zipPath: string;
  kind: 'screenshot' | 'video' | 'trace' | 'attachment';
  name: string;
  contentType: string;
  size: number | null;
}

/** One execution, with its evidence. `detail` is the `getTestRunCase` payload. */
export interface ExportCase {
  executionId: number;
  testCaseId: number | null;
  title: string;
  filePath: string | null;
  location: string | null;
  status: string;
  /** Folder name for this case inside a ZIP export. */
  slug: string;
  detail: Record<string, unknown>;
  traces: Record<string, unknown>[];
  diagnosis: Record<string, unknown> | null;
  assets: ExportAsset[];
}

export interface ExportBundle {
  kind: ExportKind;
  /** ISO timestamp of generation. */
  generatedAt: string;
  /** Piwi version that produced this file. */
  piwiVersion: string | null;
  /** Absolute URL back to the live page, when the server knows its own origin. */
  sourceUrl: string | null;
  title: string;
  project: { id: number; name: string; label: string | null } | null;
  /** Present for `kind: 'cluster'` — the cluster row plus its diagnosis. */
  cluster: Record<string, unknown> | null;
  cases: ExportCase[];
  /** Member cases beyond the export's case cap, listed but not expanded. */
  truncatedCases: { testCaseId: number; title: string; filePath: string | null }[];
  omitted: ExportOmission[];
}

/**
 * Reads evidence bytes for a collected asset. The server reads storage; the
 * demo fetches its committed sample assets over HTTP.
 */
export interface ExportAssetReader {
  read(asset: ExportAsset): Promise<Uint8Array | null>;
}

export interface ExportBudget {
  /** Per-asset ceiling for `data:` inlining in the HTML report. */
  maxInlineBytes: number;
  /** Ceiling for the whole export. */
  maxTotalBytes: number;
}
