import { describe, expect, it } from 'vitest';
import { MCP_TOOLS } from '../../server/utils/mcp/tools';

const handler = (name: string) => {
  const tool = MCP_TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool.handler;
};

// A reporter who can open project 1 only. The refusal comes before any query, so no database is needed.
const ctx = { user: null, scope: new Set([1]) };
const db = {} as never;

describe('the analytics and report tools enforce the project scope', () => {
  const calls: Array<[string, Record<string, unknown>]> = [
    ['get_quality_report', { dashboard: 'executive', projectIds: [1, 2] }],
    ['get_dashboard', { id: 'overview', projectIds: [2] }],
    ['get_metric_trend', { metric: 'test-pass-rate', projectIds: [2] }],
    ['compare_periods', { a: 'last-7d', b: 'last-14d', projectIds: [2] }],
  ];
  for (const [name, params] of calls) {
    it(`${name} refuses a project out of scope instead of leaving it out of the answer`, async () => {
      await expect(handler(name)(db, params, ctx)).rejects.toThrow('No access to project 2');
    });
  }
});
