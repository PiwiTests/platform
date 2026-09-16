/**
 * Type declarations for the demo failure-story fixture module.
 * See `failure-stories.mjs` for the data itself.
 */

export interface StoryFrame {
  file: string;
  line: number;
  column: number;
  fn?: string;
}

export interface FailingCase {
  title: string;
  failingLine: number;
  column: number;
  /** Innermost first — mirrors the reporter's collectSourceFrames order. */
  frames: StoryFrame[];
  /** Full reporter-format error text (message head, call log, at-frames). */
  error: string;
}

export interface StoryConsoleEntry {
  type: string;
  text: string;
  location: string | null;
}

export interface StoryNetworkRequest {
  method: string;
  url: string;
  status: number;
  duration: number;
  resourceType: string;
  contentType?: string;
  serverLogs?: Array<{ timestamp: number; level: string; category: string; message: string; stack?: string }>;
}

export interface StoryDialog {
  type: string;
  message: string;
  defaultValue?: string | null;
}

export interface StoryEvidence {
  consoleOnFail?: StoryConsoleEntry[];
  failingNetwork?: StoryNetworkRequest[];
  /** A browser dialog left open at the failure moment. */
  dialogOnFail?: StoryDialog;
  /** localStorage keys missing from the failing page state (vs the passing template). */
  pageStateDropKeys?: string[];
  /** Crash stories: the page is gone — no console/aria/page-state/web-vitals at all. */
  noPageArtifacts?: boolean;
}

export interface StoryDiagnosis {
  seeded: boolean;
  kind: string;
  area: string;
  fix: { description: string; file: string; patch: string };
}

export interface StoryMedia {
  screenshot?: string;
  trace?: string;
  video?: string;
  visualDiffBaseline?: string;
}

export interface StoryFiring {
  /** Run index (newest = 0) at which the story started firing. */
  startAgo: number;
  /** Chance the story fires on an eligible run (deterministic PRNG). */
  chance: number;
  /** Only fire on runs whose browser config has this colorScheme. */
  requiresColorScheme?: string;
}

export interface StoryDomSnapshot {
  /** The recorded page viewport, for the picker's proportion-preserving zoom. */
  viewport: { width: number; height: number };
  /** Self-contained full-page HTML, served as if extracted from the case's trace. */
  html: string;
}

export interface FailureStory {
  key: string;
  clusterId: number;
  projectId: number;
  specFile: string;
  locator: string | null;
  /** The locator call-site healing snapshots are keyed on (innermost frame). */
  captureLocation?: string;
  failingCases: FailingCase[];
  aria: string | null;
  /** Authored failure-time DOM for the locator picker / DOM snapshot card. */
  domSnapshot?: StoryDomSnapshot;
  evidence: StoryEvidence;
  appFiles: string[];
  suspectSha: string;
  diagnosis: StoryDiagnosis;
  media: StoryMedia;
  firing: StoryFiring;
}

export interface DemoCase {
  file: string;
  title: string;
  declLine: number;
  declColumn: number;
}

export interface DemoBrowserProfile {
  projectName: string;
  browserName: string;
  channel: string | null;
  viewport: { width: number; height: number } | null;
  deviceScaleFactor?: number;
  isMobile?: boolean;
  hasTouch?: boolean;
  locale?: string;
  timezoneId?: string;
  colorScheme?: string;
  reducedMotion?: string;
  userAgent?: string;
}

export interface DemoProject {
  id: number;
  name: string;
  baseUrl: string | null;
  cases: DemoCase[];
  suites: Record<string, { suitePath: string[]; mode: string; annotations: Array<{ type: string }> }>;
  browsers: DemoBrowserProfile[];
  browserRotation: number[];
  network: StoryNetworkRequest[];
  consolePassing: StoryConsoleEntry[] | null;
  webVitals: boolean;
  pageState: {
    url: string;
    localStorage: Array<{ key: string; length: number }>;
    sessionStorage: Array<{ key: string; length: number }>;
    cookies: Array<Record<string, unknown>>;
  } | null;
  stepTitles: DemoStepTitle[];
}

/** A themed step for a project's cases; `children` nest inside its time window. */
export interface DemoStepTitle {
  title: string;
  category: string;
  weight: number;
  subtitle?: string;
  params?: Record<string, string | number | boolean>;
  children?: DemoStepTitle[];
}

export interface ScmCommitFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface ScmCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
  branch: string;
  files: ScmCommitFile[];
}

export interface ScmRepo {
  repositoryUrl: string;
  defaultBranch: string;
  branches: string[];
  commits: ScmCommit[];
}

export declare const SOURCE_FILES: Record<string, string[]>;
export declare const FAILURE_STORIES: FailureStory[];
export declare const DEMO_PROJECTS: DemoProject[];
export declare const SCM_REPOS: Record<number, ScmRepo>;
export declare const SIMULATOR_ERRORS: {
  checkoutPayTimeout: string;
  checkoutPayTimeoutPaypal: string;
  emailLabelRenamed: string;
};

export declare function renderSnippet(
  lines: string[],
  opts: { declLine?: number | null; failingLine?: number | null; context: number },
): string;
export declare function lineOf(lines: string[], needle: string, nth?: number): number;
export declare function buildTestTimeoutError(p: {
  timeoutMs: number;
  action: string;
  callLog: string[];
  frames: StoryFrame[];
}): string;
export declare function buildActionTimeoutError(p: {
  action: string;
  timeoutMs: number;
  callLog: string[];
  frames: StoryFrame[];
}): string;
export declare function buildValueAssertionError(p: {
  matcherLine: string;
  body: string[];
  frames: StoryFrame[];
}): string;
export declare function buildWebAssertionError(p: {
  matcher: string;
  locator: string;
  expected: string;
  received: string;
  timeoutMs: number;
  callLog: string[];
  frames: StoryFrame[];
  ansi?: boolean;
}): string;
export declare function buildStrictModeError(p: {
  action: string;
  selector: string;
  elements: string[];
  callLog: string[];
  frames: StoryFrame[];
}): string;
export declare function buildCrashError(p: { action: string; callLog: string[]; frames: StoryFrame[] }): string;
export declare function derivePatch(
  file: string,
  source: string[],
  op: { at: number; remove?: number; add?: string[]; context?: number },
): string;
export declare function sourceText(path: string): string;
export declare function buildTestSource(
  story: { specFile: string },
  failing: { failingLine: number },
  declLine: number,
): string;
export declare function buildSourceFrames(failing: {
  frames: Array<{ file: string; line: number }>;
}): Array<{ file: string; line: number; snippet: string }>;
export declare function storyByClusterId(clusterId: number): FailureStory | null;
export declare function storyForCase(projectId: number, filePath: string, title: string): FailureStory | null;
export declare function projectSourceFilePaths(projectId: number): string[];
