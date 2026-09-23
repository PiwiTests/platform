/**
 * The weekly gaps digest: the top new gaps per project since the last digest,
 * off by default, delivered through the notification outbox and subscriptions.
 * The selection is pure so the demo and the tests run it; the scheduled task
 * loads the gaps and enqueues the message.
 */

/** A gap as the digest needs it. */
export interface DigestGap {
  projectId: number;
  projectName: string;
  id: number;
  title: string;
  class: string;
  score: number | null;
  createdAt: number;
}

/** One project's slice of the digest. */
export interface DigestProject {
  projectId: number;
  projectName: string;
  gaps: DigestGap[];
}

/** How many gaps per project the digest lists. */
export const DIGEST_PER_PROJECT = 5;

/**
 * Select the top new gaps per project for the digest: gaps created since the last
 * digest, grouped by project, the highest-scoring {@link DIGEST_PER_PROJECT} in
 * each, projects with at least one new gap only, ordered by their top gap's
 * score. Pure.
 */
export function selectWeeklyDigest(gaps: DigestGap[], since: number, perProject = DIGEST_PER_PROJECT): DigestProject[] {
  const byProject = new Map<number, DigestProject>();
  for (const g of gaps) {
    if (g.createdAt <= since) continue;
    const entry = byProject.get(g.projectId) ?? { projectId: g.projectId, projectName: g.projectName, gaps: [] };
    entry.gaps.push(g);
    byProject.set(g.projectId, entry);
  }
  const projects = [...byProject.values()];
  for (const p of projects) {
    p.gaps.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    p.gaps = p.gaps.slice(0, perProject);
  }
  return projects.filter((p) => p.gaps.length > 0).sort((a, b) => (b.gaps[0]?.score ?? 0) - (a.gaps[0]?.score ?? 0));
}

/** Render the digest as a Markdown message body for the notification outbox. */
export function renderDigest(projects: DigestProject[]): string {
  if (projects.length === 0) return '';
  const lines = ['**New scenario gaps this week**', ''];
  for (const p of projects) {
    lines.push(`**${p.projectName}**`);
    for (const g of p.gaps) {
      lines.push(`- ${g.title} · ${g.class} · score ${(g.score ?? 0).toFixed(3)}`);
    }
    lines.push('');
  }
  lines.push('Proposed tests that do not exist yet — observed reach, never instrumented coverage.');
  return lines.join('\n');
}
