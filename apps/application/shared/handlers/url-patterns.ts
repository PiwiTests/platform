import { and, asc, desc, eq, inArray, like } from 'drizzle-orm';
import { z } from 'zod';
import { urlMatches } from '@piwitests/core/function-match';
import { parsePathPrefix, type PathPrefixProblem } from '@piwitests/core/page-key';
import { graphNodes, locatorUsages, projects, projectUrlPatterns, testRuns } from '../../server/database/schema';
import { projectRouteOrigins, runBaseUrls, urlOrigin } from '#shared/graph';
import type { DrizzleDB } from './db';

/**
 * A project's URL patterns: the addresses its application is served at, which
 * the browser extension resolves the project of a page from. A pattern is a
 * glob over the whole URL with the extension's syntax (`urlMatches`: `*`
 * within one path segment, `**` across segments), so it starts with the scheme
 * or a wildcard. Two optional path prefixes relate the site's paths to the
 * tests': `pathPrefix`, the part of the site's path the tests never saw
 * (`/app`), which the extension removes before comparing the page with the
 * pages the tests recorded, and `testPathPrefix`, the part the tests ran under
 * and the site does not, which it puts in front.
 */

const PATH_PREFIX_MESSAGES: Record<PathPrefixProblem, string> = {
  'query-or-hash': 'A path prefix has no query or hash',
  'not-a-path': 'A path prefix is a plain path such as /app, with no wildcards, spaces or dot segments',
  'too-many-segments': 'A path prefix has at most 4 segments',
  'too-long': 'A path prefix has at most 200 characters',
};

/** A path prefix, normalized (`app/` → `/app`); empty means none. */
export const pathPrefixSchema = z
  .string()
  .nullish()
  .transform((value, ctx) => {
    const result = parsePathPrefix(value);
    if (result.ok) return result.prefix;
    ctx.addIssue({ code: 'custom', message: PATH_PREFIX_MESSAGES[result.problem] });
    return z.NEVER;
  });

export const MAX_URL_PATTERNS_PER_PROJECT = 100;

export const urlPatternInputSchema = z.object({
  pattern: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .refine((p) => /^(https?:\/\/|\*)/i.test(p), 'Start the pattern with http://, https:// or a wildcard'),
  environment: z.string().trim().max(40).nullish(),
  branch: z.string().trim().max(200).nullish(),
  pathPrefix: pathPrefixSchema,
  testPathPrefix: pathPrefixSchema,
});

export const urlPatternListSchema = z.object({
  items: z.array(urlPatternInputSchema).max(MAX_URL_PATTERNS_PER_PROJECT),
});

export type UrlPatternInput = z.input<typeof urlPatternInputSchema>;

export interface UrlPatternItem {
  id: number;
  pattern: string;
  environment: string | null;
  branch: string | null;
  pathPrefix: string | null;
  testPathPrefix: string | null;
  position: number;
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function cleanPrefix(value: string | null | undefined): string | null {
  const result = parsePathPrefix(value);
  return result.ok ? result.prefix : null;
}

export async function listProjectUrlPatterns(db: DrizzleDB, projectId: number): Promise<UrlPatternItem[]> {
  return db
    .select({
      id: projectUrlPatterns.id,
      pattern: projectUrlPatterns.pattern,
      environment: projectUrlPatterns.environment,
      branch: projectUrlPatterns.branch,
      pathPrefix: projectUrlPatterns.pathPrefix,
      testPathPrefix: projectUrlPatterns.testPathPrefix,
      position: projectUrlPatterns.position,
    })
    .from(projectUrlPatterns)
    .where(eq(projectUrlPatterns.projectId, projectId))
    .orderBy(asc(projectUrlPatterns.position), asc(projectUrlPatterns.id));
}

export type UrlPatternWriteResult =
  | { ok: true; items: UrlPatternItem[] }
  | { ok: false; reason: 'not-found' | 'duplicate' | 'too-many'; pattern?: string };

async function projectExists(db: DrizzleDB, projectId: number): Promise<boolean> {
  const [row] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId));
  return !!row;
}

/** Replaces the project's list with `items`, in that order. */
export async function replaceProjectUrlPatterns(
  db: DrizzleDB,
  projectId: number,
  items: UrlPatternInput[],
): Promise<UrlPatternWriteResult> {
  if (!(await projectExists(db, projectId))) return { ok: false, reason: 'not-found' };
  const seen = new Set<string>();
  for (const item of items) {
    const pattern = item.pattern.trim();
    if (seen.has(pattern)) return { ok: false, reason: 'duplicate', pattern };
    seen.add(pattern);
  }
  const now = new Date();
  await db.delete(projectUrlPatterns).where(eq(projectUrlPatterns.projectId, projectId));
  if (items.length > 0) {
    await db.insert(projectUrlPatterns).values(
      items.map((item, position) => ({
        projectId,
        pattern: item.pattern.trim(),
        environment: clean(item.environment),
        branch: clean(item.branch),
        pathPrefix: cleanPrefix(item.pathPrefix),
        testPathPrefix: cleanPrefix(item.testPathPrefix),
        position,
        createdAt: now,
        updatedAt: now,
      })),
    );
  }
  return { ok: true, items: await listProjectUrlPatterns(db, projectId) };
}

/** Appends one pattern; refuses one the project already has. */
export async function addProjectUrlPattern(
  db: DrizzleDB,
  projectId: number,
  input: UrlPatternInput,
): Promise<UrlPatternWriteResult> {
  if (!(await projectExists(db, projectId))) return { ok: false, reason: 'not-found' };
  const existing = await listProjectUrlPatterns(db, projectId);
  const pattern = input.pattern.trim();
  if (existing.some((p) => p.pattern === pattern)) return { ok: false, reason: 'duplicate', pattern };
  if (existing.length >= MAX_URL_PATTERNS_PER_PROJECT) return { ok: false, reason: 'too-many' };
  const now = new Date();
  await db.insert(projectUrlPatterns).values({
    projectId,
    pattern,
    environment: clean(input.environment),
    branch: clean(input.branch),
    pathPrefix: cleanPrefix(input.pathPrefix),
    testPathPrefix: cleanPrefix(input.testPathPrefix),
    position: existing.reduce((max, p) => Math.max(max, p.position + 1), 0),
    createdAt: now,
    updatedAt: now,
  });
  return { ok: true, items: await listProjectUrlPatterns(db, projectId) };
}

export interface VisibleUrlPattern {
  projectId: number;
  projectName: string;
  projectLabel: string;
  pattern: string;
  environment: string | null;
  branch: string | null;
  pathPrefix: string | null;
  testPathPrefix: string | null;
}

/**
 * Every pattern of the projects in `scope`, ordered by project then by each
 * project's own order: the order the extension tries them in.
 */
export async function listVisibleUrlPatterns(db: DrizzleDB, scope: 'all' | Set<number>): Promise<VisibleUrlPattern[]> {
  if (scope !== 'all' && scope.size === 0) return [];
  const rows = await db
    .select({
      projectId: projectUrlPatterns.projectId,
      projectName: projects.name,
      projectLabel: projects.label,
      pattern: projectUrlPatterns.pattern,
      environment: projectUrlPatterns.environment,
      branch: projectUrlPatterns.branch,
      pathPrefix: projectUrlPatterns.pathPrefix,
      testPathPrefix: projectUrlPatterns.testPathPrefix,
    })
    .from(projectUrlPatterns)
    .innerJoin(projects, eq(projects.id, projectUrlPatterns.projectId))
    .where(scope === 'all' ? undefined : inArray(projectUrlPatterns.projectId, [...scope]))
    .orderBy(asc(projectUrlPatterns.projectId), asc(projectUrlPatterns.position), asc(projectUrlPatterns.id));
  return rows.map((r) => ({ ...r, projectLabel: r.projectLabel || r.projectName }));
}

export type UrlPatternSuggestionSource = 'base-url' | 'test-map' | 'locator-pages';

export interface UrlPatternSuggestion {
  pattern: string;
  origin: string;
  sources: UrlPatternSuggestionSource[];
  /** How many recorded URLs pointed at this origin: the order suggestions are shown in. */
  hits: number;
}

const SUGGESTION_RUNS = 20;
const SUGGESTION_ROWS = 2000;

/**
 * One `https://host/**` pattern per origin the project's suite visited: the
 * Playwright `baseURL` of its recent runs and its own route origins, the URL
 * of each page node of the Test Map, and each absolute page its locators ran
 * on. Origins an existing pattern already covers are left out.
 */
export async function suggestUrlPatterns(db: DrizzleDB, projectId: number): Promise<UrlPatternSuggestion[]> {
  const byOrigin = new Map<string, { sources: Set<UrlPatternSuggestionSource>; hits: number }>();
  const add = (url: unknown, source: UrlPatternSuggestionSource) => {
    const origin = typeof url === 'string' ? urlOrigin(url) : null;
    if (!origin || !/^https?:\/\//.test(origin)) return;
    let entry = byOrigin.get(origin);
    if (!entry) byOrigin.set(origin, (entry = { sources: new Set(), hits: 0 }));
    entry.sources.add(source);
    entry.hits++;
  };

  const [project] = await db
    .select({ routeOrigins: projects.routeOrigins })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) return [];
  for (const origin of projectRouteOrigins(project.routeOrigins)) add(origin, 'base-url');

  const runs = await db
    .select({ metadata: testRuns.metadata })
    .from(testRuns)
    .where(eq(testRuns.projectId, projectId))
    .orderBy(desc(testRuns.id))
    .limit(SUGGESTION_RUNS);
  for (const run of runs) for (const url of runBaseUrls(run.metadata)) add(url, 'base-url');

  const pageNodes = await db
    .select({ attrs: graphNodes.attrs })
    .from(graphNodes)
    .where(and(eq(graphNodes.projectId, projectId), eq(graphNodes.kind, 'page')))
    .limit(SUGGESTION_ROWS);
  for (const node of pageNodes) add((node.attrs as { url?: unknown } | null)?.url, 'test-map');

  const pages = await db
    .selectDistinct({ page: locatorUsages.page })
    .from(locatorUsages)
    .where(and(eq(locatorUsages.projectId, projectId), like(locatorUsages.page, 'http%')))
    .limit(SUGGESTION_ROWS);
  for (const row of pages) add(row.page, 'locator-pages');

  const existing = await listProjectUrlPatterns(db, projectId);
  return [...byOrigin.entries()]
    .filter(([origin]) => !existing.some((p) => urlMatches(p.pattern, `${origin}/`)))
    .map(([origin, entry]) => ({
      pattern: `${origin}/**`,
      origin,
      sources: [...entry.sources].sort(),
      hits: entry.hits,
    }))
    .sort((a, b) => b.hits - a.hits || a.origin.localeCompare(b.origin));
}
