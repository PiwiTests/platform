import { eq } from 'drizzle-orm'
import { appSettings } from '../database/schema'

type DbClient = Awaited<ReturnType<typeof import('../database').getDatabase>>

export async function getAppSetting<T>(db: DbClient, key: string): Promise<T | null> {
  const rows = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key))
  if (!rows[0]) return null
  return rows[0].value as T
}

export async function setAppSetting(db: DbClient, key: string, value: unknown): Promise<void> {
  await db.insert(appSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } })
}

export async function deleteAppSetting(db: DbClient, key: string): Promise<void> {
  await db.delete(appSettings).where(eq(appSettings.key, key))
}
