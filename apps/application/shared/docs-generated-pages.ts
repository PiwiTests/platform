/**
 * The docs pages the docs build writes from a registry (`npm run docs:gen`, the
 * `apps/docs/scripts/generate-*.mjs` scripts) rather than a person. They are
 * gitignored, so a checkout only has them once the docs have been built.
 *
 * One list for everything that must skip them: the docs-drift test, the docs
 * bundled into the server for the MCP `describe_piwi` tool (nuxt.config.ts),
 * and that tool's reader, which answers for them from the same registries or
 * points at the published copy. No imports, so nuxt.config.ts can load it.
 */
export const GENERATED_DOCS_PAGES = {
  'reference/analytics-widgets': 'the analytics widget registry',
  'reference/configuration': 'the PIWI_* variable registry',
  'reference/features': 'the feature catalog and the ecosystem registry',
  'reference/mcp-tools': 'the MCP tool catalog',
  'reference/metrics': 'the metric catalog',
  'reference/reporter-options': "the reporter's options interface",
  'reference/whats-new': 'the changelog',
} as const;

export type GeneratedDocsPage = keyof typeof GENERATED_DOCS_PAGES;

export function isGeneratedDocsPage(path: string): path is GeneratedDocsPage {
  return Object.hasOwn(GENERATED_DOCS_PAGES, path);
}
