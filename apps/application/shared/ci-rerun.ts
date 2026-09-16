/**
 * CI re-run — settings and the durable shapes shared by the server, the demo
 * and the tests.
 *
 * From a failure cluster's page, a reporter or admin can ask CI to re-run
 * exactly the affected tests, using the SCM token already configured for the
 * project. The target is provider-specific — a GitHub workflow, a GitLab
 * pipeline, a Bitbucket custom pipeline — so the settings hold one block per
 * provider; the project's repository URL decides which one is used.
 *
 * Off by default: dispatching a pipeline spends CI minutes and needs a token
 * with write scope, so it stays an explicit per-project opt-in.
 *
 * Pure + dependency-free (mirrors `shared/auto-heal.ts`): the code that talks to
 * GitHub / GitLab / Bitbucket lives in `server/utils/scm/`.
 */

import type { ScmProviderName } from '#shared/scm-urls';

/** GitHub `workflow_dispatch` target. */
export interface GitHubRerunTarget {
  /** Workflow file name (e.g. `e2e.yml`) or its numeric id. */
  workflow: string;
  /** Git ref (branch or tag) the workflow runs on. */
  ref: string;
  /** The `workflow_dispatch` input that receives the Playwright arguments. */
  inputName: string;
}

/** GitLab pipeline target. */
export interface GitLabRerunTarget {
  /** Git ref the pipeline runs on. */
  ref: string;
  /** The pipeline variable that receives the Playwright arguments. */
  variableName: string;
}

/** Bitbucket custom-pipeline target. */
export interface BitbucketRerunTarget {
  /** The `custom:` pipeline name defined in `bitbucket-pipelines.yml`. */
  pipeline: string;
  /** The pipeline variable that receives the Playwright arguments. */
  variableName: string;
}

export interface CiRerunSettings {
  /** Master switch. Off by default — dispatching CI needs an explicit opt-in. */
  enabled: boolean;
  github?: GitHubRerunTarget;
  gitlab?: GitLabRerunTarget;
  bitbucket?: BitbucketRerunTarget;
}

export const DEFAULT_CI_RERUN: CiRerunSettings = { enabled: false };

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Merge a partial (possibly untrusted) payload onto the defaults, dropping empties. */
export function resolveCiRerunSettings(input?: Partial<CiRerunSettings> | null): CiRerunSettings {
  const out: CiRerunSettings = { enabled: input?.enabled === true };

  const gh = input?.github;
  if (gh) {
    const workflow = str(gh.workflow);
    const ref = str(gh.ref);
    const inputName = str(gh.inputName);
    if (workflow && ref && inputName) out.github = { workflow, ref, inputName };
  }

  const gl = input?.gitlab;
  if (gl) {
    const ref = str(gl.ref);
    const variableName = str(gl.variableName);
    if (ref && variableName) out.gitlab = { ref, variableName };
  }

  const bb = input?.bitbucket;
  if (bb) {
    const pipeline = str(bb.pipeline);
    const variableName = str(bb.variableName);
    if (pipeline && variableName) out.bitbucket = { pipeline, variableName };
  }

  return out;
}

/** True when the settings hold a usable target for the given provider. */
export function hasRerunTarget(settings: CiRerunSettings | null | undefined, provider: ScmProviderName): boolean {
  if (!settings?.enabled) return false;
  return Boolean(settings[provider]);
}

/** One recorded CI re-run dispatch, kept on the cluster so the page can show the last one. */
export interface ClusterRerunDispatch {
  /** Provider the dispatch went to. */
  provider: ScmProviderName;
  /** The provider's runs/pipeline URL to watch the re-run. */
  url: string;
  /** The Playwright arguments handed to CI. */
  args: string;
  /** Epoch ms of the dispatch. */
  at: number;
  /** Display name of the user who triggered it. */
  byName: string | null;
  /** Id of the user who triggered it. */
  byUserId: number | null;
}
