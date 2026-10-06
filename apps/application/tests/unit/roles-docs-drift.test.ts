import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  PERMISSION_LABELS,
  PROJECT_PERMISSIONS,
  PROJECT_ROLES,
  PROJECT_ROLE_LABELS,
  roleGrants,
} from '#shared/permissions';

// The docs page carries the same matrix as Settings → Roles. Both come from
// `shared/permissions.ts`; this keeps the hand-written docs table equal to it.
const page = readFileSync(join(__dirname, '../../../docs/operate/project-access.md'), 'utf8');

function docsMatrix() {
  const section = page.slice(page.indexOf('## What each role can do'));
  const lines = section.split('\n').filter((line) => line.startsWith('|'));
  const [header, , ...rows] = lines.map((line) =>
    line
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim()),
  );
  return { header: header!, rows: rows.filter((row) => row[1]?.startsWith('`')) };
}

describe('the role matrix in the docs', () => {
  const { header, rows } = docsMatrix();

  test('lists the roles in order', () => {
    expect(header.slice(2)).toEqual(PROJECT_ROLES.map((role) => PROJECT_ROLE_LABELS[role]));
  });

  test('lists every project permission once, with its label', () => {
    expect(rows.map((row) => row[1]!.replaceAll('`', ''))).toEqual([...PROJECT_PERMISSIONS]);
    for (const row of rows) {
      const permission = row[1]!.replaceAll('`', '') as (typeof PROJECT_PERMISSIONS)[number];
      expect(row[0], permission).toBe(PERMISSION_LABELS[permission]);
    }
  });

  test('ticks exactly the roles that grant each permission', () => {
    for (const row of rows) {
      const permission = row[1]!.replaceAll('`', '') as (typeof PROJECT_PERMISSIONS)[number];
      PROJECT_ROLES.forEach((role, i) => {
        expect(row[2 + i] === '✓', `${permission} for ${role}`).toBe(roleGrants(role, permission));
      });
    }
  });
});
