import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../../server/database/schema.sqlite';
import { openTempDb, type TempDb } from './temp-db';

// The schema barrel picks the PostgreSQL schema when PIWI_DATABASE_URL is set,
// so clear it before the handler modules (which import the barrel) are loaded.
delete process.env.PIWI_DATABASE_URL;
const { createProject, updateProject } = await import('../../shared/handlers/projects');
const { setProjectMembers, setUserAssignments } = await import('../../shared/handlers/project-assignments');

let db: TempDb;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await openTempDb());
  await db.insert(schema.tags).values([
    { id: 1, text: 'smoke' },
    { id: 2, text: 'nightly' },
  ]);
});

afterEach(() => close());

async function tagIdsOf(projectId: number) {
  const rows = await db
    .select({ tagId: schema.projectTags.tagId })
    .from(schema.projectTags)
    .where(eq(schema.projectTags.projectId, projectId));
  return rows.map((r) => r.tagId).sort();
}

async function projectRow(id: number) {
  const [row] = await db.select().from(schema.projects).where(eq(schema.projects.id, id));
  return row;
}

describe('createProject', () => {
  test('an unknown tag id is refused before the project is created', async () => {
    await expect(createProject(db as never, 'web', null, null, [1, 99])).rejects.toThrow(
      'One or more tag IDs are invalid',
    );
    expect(await db.select().from(schema.projects)).toEqual([]);
  });

  test('a repeated tag id links the tag once', async () => {
    const { project } = await createProject(db as never, 'web', null, null, [1, 1]);
    expect(await tagIdsOf(project.id)).toEqual([1]);
  });
});

describe('updateProject', () => {
  beforeEach(async () => {
    await db.insert(schema.projects).values({
      id: 7,
      name: 'web',
      label: 'Web',
      diagnosisInstructions: 'Prefer network evidence',
      scmToken: 'enc:stored',
    });
    await db.insert(schema.projectTags).values({ projectId: 7, tagId: 1 });
  });

  test('an unknown tag id changes nothing', async () => {
    await expect(updateProject(db as never, 7, { label: 'Renamed', tagIds: [2, 99] })).rejects.toThrow(
      'One or more tag IDs are invalid',
    );
    expect((await projectRow(7))?.label).toBe('Web');
    expect(await tagIdsOf(7)).toEqual([1]);
  });

  test('a repeated tag id replaces the tags with one link', async () => {
    await updateProject(db as never, 7, { tagIds: [2, 2] });
    expect(await tagIdsOf(7)).toEqual([2]);
  });

  test('null or an empty string clears the diagnosis instructions; omitting them keeps them', async () => {
    await updateProject(db as never, 7, { label: 'Web app' });
    expect((await projectRow(7))?.diagnosisInstructions).toBe('Prefer network evidence');

    await updateProject(db as never, 7, { diagnosisInstructions: null });
    expect((await projectRow(7))?.diagnosisInstructions).toBeNull();

    await updateProject(db as never, 7, { diagnosisInstructions: 'Check the API first' });
    await updateProject(db as never, 7, { diagnosisInstructions: '' });
    expect((await projectRow(7))?.diagnosisInstructions).toBeNull();
  });

  test('an omitted SCM token keeps the stored one; null removes it', async () => {
    await updateProject(db as never, 7, { label: 'Web app', tagIds: [] });
    expect((await projectRow(7))?.scmToken).toBe('enc:stored');

    await updateProject(db as never, 7, { scmToken: null });
    expect((await projectRow(7))?.scmToken).toBeNull();
  });
});

describe('project access writes', () => {
  beforeEach(async () => {
    await db.insert(schema.users).values([
      { id: 2, username: 'robin', password: '', role: 'user' },
      { id: 3, username: 'sam', password: '', role: 'user' },
    ]);
    await db.insert(schema.projects).values([
      { id: 5, name: 'api' },
      { id: 6, name: 'web' },
    ]);
  });

  async function assignments() {
    return db
      .select({ userId: schema.projectAssignments.userId, projectId: schema.projectAssignments.projectId })
      .from(schema.projectAssignments);
  }

  test('a repeated user id in the member list grants access once', async () => {
    await setProjectMembers(db as never, 5, [2, 2, 3]);
    expect(await assignments()).toEqual(
      expect.arrayContaining([
        { userId: 2, projectId: 5 },
        { userId: 3, projectId: 5 },
      ]),
    );
    expect(await assignments()).toHaveLength(2);
  });

  test('a repeated project id in a user assignment grants access once', async () => {
    await setUserAssignments(db as never, 2, { global: false, projectIds: [6, 6, 5] });
    expect(await assignments()).toHaveLength(2);
  });
});
