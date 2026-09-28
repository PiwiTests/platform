import { describe, expect, it } from 'vitest';
import { MCP_TOOLS } from '../../server/utils/mcp/tools';

const tool = MCP_TOOLS.find((t) => t.name === 'predict_locator_breaks')!;
// A reporter who can open project 1 only. Each refusal comes before any query, so no database is needed.
const ctx = { user: null, scope: new Set([1]) };
const db = {} as never;

describe('predict_locator_breaks', () => {
  it('refuses a project out of scope', async () => {
    await expect(tool.handler(db, { projectId: 2, diff: 'x' }, ctx)).rejects.toThrow('No access to project 2');
  });

  it('asks for a diff', async () => {
    await expect(tool.handler(db, { projectId: 1, diff: '  ' }, ctx)).rejects.toThrow(/diff is required/);
  });
});
