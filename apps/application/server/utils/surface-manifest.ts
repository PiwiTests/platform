/**
 * Declared-surface ingest: turn a manifest — uploaded by the reporter, or fetched
 * from a project's OpenAPI URL — into `route`/`page`/`handler` graph nodes. The
 * pure builder ({@link import('#shared/graph').buildManifestGraph}) and the
 * OpenAPI parser ({@link parseOpenApiSpec}) do the shaping; this module owns the
 * server-only pieces: the outbound fetch and resolving a run id to stamp.
 */

import { desc, eq } from 'drizzle-orm';
import { testRuns } from '../database/schema';
import { ingestManifestGraph } from './graph-ingest';
import { parseOpenApiSpec } from '#shared/openapi';
import type { AppManifest, ManifestSource } from '#shared/types';
import type { DrizzleDB } from '#shared/handlers/db';
import type { DbClient } from '../database';

/** Accepts both the server client and the demo's in-browser SQLite client. */
type DB = DrizzleDB;

/** Cap on the OpenAPI document body we will read, and how long we wait for it. */
const OPENAPI_MAX_BYTES = 5_000_000;
const OPENAPI_FETCH_TIMEOUT_MS = 10_000;

/** The most recent run id for a project, used to stamp declared nodes' last-seen. */
export async function latestRunId(db: DB, projectId: number): Promise<number> {
  const rows = await db
    .select({ id: testRuns.id })
    .from(testRuns)
    .where(eq(testRuns.projectId, projectId))
    .orderBy(desc(testRuns.id))
    .limit(1);
  return rows[0]?.id ?? 0;
}

/**
 * Fetch and parse an OpenAPI document into a manifest. Best-effort: a network
 * failure, a non-2xx response, an oversized body or unparseable JSON all return
 * null rather than throwing, so a declared-surface refresh never breaks ingest.
 */
export async function fetchOpenApiManifest(url: string): Promise<AppManifest | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAPI_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.length > OPENAPI_MAX_BYTES) return null;
    return parseOpenApiSpec(JSON.parse(text));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ingest a declared manifest for a project as canonical graph nodes. Failures are
 * swallowed to a boolean so the caller (an upload endpoint or a recompute) is
 * never broken by a graph write.
 */
export async function ingestProjectManifest(
  db: DB,
  projectId: number,
  manifest: AppManifest,
  source: ManifestSource,
): Promise<boolean> {
  try {
    const runId = await latestRunId(db, projectId);
    await ingestManifestGraph(db as DbClient, projectId, runId, manifest, source);
    return true;
  } catch {
    return false;
  }
}

/** Fetch a project's OpenAPI URL and ingest it as declared surface. No-op when unset. */
export async function refreshOpenApiSurface(db: DB, projectId: number, openApiUrl: string | null): Promise<boolean> {
  if (!openApiUrl?.trim()) return false;
  const manifest = await fetchOpenApiManifest(openApiUrl.trim());
  if (!manifest) return false;
  return ingestProjectManifest(db, projectId, manifest, 'openapi');
}
