import type { SessionPick } from './session-storage.js';

/** A pick's name becomes a class field name in the fixture export, so it must be a valid JS identifier. */
export function isValidPickName(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

/** A Playwright POM-style class, one `readonly` field per named pick. */
export function renderFixture(picks: SessionPick[]): string {
  const fields = picks.map((p) => `  readonly ${p.name} = this.page.${p.locator};`).join('\n');
  return [
    `import type { Page } from '@playwright/test';`,
    ``,
    `export class PickedElements {`,
    `  constructor(private readonly page: Page) {}`,
    ``,
    fields,
    `}`,
  ].join('\n');
}

/** A table shareable in a PR description or issue — GitHub-flavored Markdown renders it directly. */
export function renderMarkdown(picks: SessionPick[]): string {
  const header = '| Name | Locator | Page |\n|---|---|---|';
  const rows = picks.map((p) => `| ${p.name} | \`${p.locator}\` | ${p.pageUrl} |`);
  return [header, ...rows].join('\n');
}

export function renderJson(picks: SessionPick[]): string {
  return JSON.stringify({ exportedAt: new Date().toISOString(), picks }, null, 2);
}
