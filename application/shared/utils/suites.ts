export const SUITE_PATH_SEP = '\x1f';

export function splitSuitePath(path: string | null | undefined): string[] {
  return path ? path.split(SUITE_PATH_SEP).filter(Boolean) : [];
}

export function joinSuitePath(path: string[] | null | undefined): string {
  return path?.length ? path.join(SUITE_PATH_SEP) : '';
}

export interface SuiteRow {
  filePath: string;
  suitePath: string;
  mode: string;
  annotations: unknown;
}

export interface FormattedSuite {
  filePath: string;
  suitePath: string[];
  mode: string;
  annotations: Array<{ type: string; description?: string }>;
}

function formatSuites(suiteRows: SuiteRow[]): FormattedSuite[] {
  return suiteRows.map((s) => ({
    filePath: s.filePath,
    suitePath: splitSuitePath(s.suitePath),
    mode: s.mode,
    annotations: (s.annotations as Array<{ type: string; description?: string }>) ?? [],
  }));
}

export async function fetchAndFormatSuites(
  db: any,
  testSuitesTable: any,
  projectId: number,
  filePaths: string[],
  eq: any,
  and: any,
  inArray: any,
): Promise<FormattedSuite[]> {
  if (filePaths.length === 0) return [];
  const suiteRows = await db
    .select({
      filePath: testSuitesTable.filePath,
      suitePath: testSuitesTable.suitePath,
      mode: testSuitesTable.mode,
      annotations: testSuitesTable.annotations,
    })
    .from(testSuitesTable)
    .where(and(eq(testSuitesTable.projectId, projectId), inArray(testSuitesTable.filePath, filePaths)));
  return formatSuites(suiteRows);
}
