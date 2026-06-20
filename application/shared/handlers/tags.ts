import { tags } from '../../server/database/schema.sqlite';
import { eq, asc } from 'drizzle-orm';

import type { DrizzleDB } from './db';

export async function listTags(db: DrizzleDB) {
  const allTags = await db.select().from(tags).orderBy(asc(tags.text));
  return { tags: allTags };
}

export async function createTag(db: DrizzleDB, text: string, color: string) {
  const existing = await db.select().from(tags).where(eq(tags.text, text));
  if (existing.length > 0) throw new Error('A tag with this text already exists');
  const result = await db.insert(tags).values({ text, color }).returning();
  return { tag: result[0]! };
}

export async function updateTag(db: DrizzleDB, id: number, data: { text?: string; color?: string }) {
  const existing = await db.select().from(tags).where(eq(tags.id, id));
  if (!existing[0]) throw new Error('Tag not found');
  const updates: any = { updatedAt: new Date() };
  if (data.text !== undefined) updates.text = data.text;
  if (data.color !== undefined) updates.color = data.color;
  await db.update(tags).set(updates).where(eq(tags.id, id));
  const updated = await db.select().from(tags).where(eq(tags.id, id));
  return { tag: updated[0] };
}

export async function deleteTag(db: DrizzleDB, id: number) {
  const existing = await db.select().from(tags).where(eq(tags.id, id));
  if (!existing[0]) throw new Error('Tag not found');
  await db.delete(tags).where(eq(tags.id, id));
  return { success: true };
}
