import { testFunctions } from '../../server/database/schema';
import { eq, asc } from 'drizzle-orm';
import type { DrizzleDB } from './db';
import type {
  FunctionParam,
  FunctionPatternStep,
  FunctionParamSource,
  TestFunctionEntry,
} from '@piwitests/core/function-match';

export interface TestFunctionInput {
  name: string;
  kind: 'page-object-method' | 'helper' | 'fixture';
  module: string;
  receiver?: string | null;
  importName?: string | null;
  params: FunctionParam[];
  returnsPage?: boolean;
  urlPattern?: string | null;
  steps: FunctionPatternStep[];
  paramSources?: FunctionParamSource[];
  source?: 'manual' | 'scanned' | 'recorded' | 'ai-extracted';
  confidence?: number;
}

/** Row shape as stored — JSON columns still serialized. */
type TestFunctionRow = typeof testFunctions.$inferSelect;

/** Deserializes a stored row into the shape `@piwitests/core/function-match` matches against. */
export function toTestFunctionEntry(row: TestFunctionRow): TestFunctionEntry {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as TestFunctionEntry['kind'],
    module: row.module,
    receiver: row.receiver,
    importName: row.importName,
    params: JSON.parse(row.params) as FunctionParam[],
    urlPattern: row.urlPattern,
    steps: JSON.parse(row.steps) as FunctionPatternStep[],
    paramSources: JSON.parse(row.paramSources) as FunctionParamSource[],
  };
}

export async function listProjectTestFunctions(db: DrizzleDB, projectId: number) {
  const rows = await db
    .select()
    .from(testFunctions)
    .where(eq(testFunctions.projectId, projectId))
    .orderBy(asc(testFunctions.name));
  return { testFunctions: rows.map((row) => ({ ...row, entry: toTestFunctionEntry(row) })) };
}

export async function createTestFunction(db: DrizzleDB, projectId: number, data: TestFunctionInput) {
  const result = await db
    .insert(testFunctions)
    .values({
      projectId,
      name: data.name,
      kind: data.kind,
      module: data.module,
      receiver: data.receiver ?? null,
      importName: data.importName ?? null,
      params: JSON.stringify(data.params),
      returnsPage: data.returnsPage ?? false,
      urlPattern: data.urlPattern ?? null,
      steps: JSON.stringify(data.steps),
      paramSources: JSON.stringify(data.paramSources ?? []),
      source: data.source ?? 'manual',
      confidence: data.confidence ?? 1,
    })
    .returning();
  return { success: true, testFunction: result[0]! };
}

export async function updateTestFunction(db: DrizzleDB, id: number, data: Partial<TestFunctionInput>) {
  const existing = await db.select().from(testFunctions).where(eq(testFunctions.id, id));
  if (!existing[0]) throw new Error('Test function not found');

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (data.name !== undefined) updates.name = data.name;
  if (data.kind !== undefined) updates.kind = data.kind;
  if (data.module !== undefined) updates.module = data.module;
  if (data.receiver !== undefined) updates.receiver = data.receiver;
  if (data.importName !== undefined) updates.importName = data.importName;
  if (data.params !== undefined) updates.params = JSON.stringify(data.params);
  if (data.returnsPage !== undefined) updates.returnsPage = data.returnsPage;
  if (data.urlPattern !== undefined) updates.urlPattern = data.urlPattern;
  if (data.steps !== undefined) updates.steps = JSON.stringify(data.steps);
  if (data.paramSources !== undefined) updates.paramSources = JSON.stringify(data.paramSources);
  if (data.source !== undefined) updates.source = data.source;
  if (data.confidence !== undefined) updates.confidence = data.confidence;

  await db.update(testFunctions).set(updates).where(eq(testFunctions.id, id));
  const updated = await db.select().from(testFunctions).where(eq(testFunctions.id, id));
  return { success: true, testFunction: updated[0]! };
}

export async function deleteTestFunction(db: DrizzleDB, id: number) {
  const existing = await db.select().from(testFunctions).where(eq(testFunctions.id, id));
  if (!existing[0]) throw new Error('Test function not found');
  await db.delete(testFunctions).where(eq(testFunctions.id, id));
  return { success: true };
}

/** Every catalog entry for a project, deserialized and ready to hand to `rankFunctionMatches`/`matchFunctionAt`/`renderSpec`. */
export async function getProjectFunctionCatalog(db: DrizzleDB, projectId: number): Promise<TestFunctionEntry[]> {
  const rows = await db.select().from(testFunctions).where(eq(testFunctions.projectId, projectId));
  return rows.map(toTestFunctionEntry);
}
