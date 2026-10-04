import { describe, test, expect, vi, beforeEach } from 'vitest';

/**
 * Record every storage mutation so a test can assert exactly what was removed.
 * `vi.hoisted` lets the mock factory below reach the shared array and the flag
 * that makes the next `deleteFile` reject (to exercise error handling).
 */
const { ops, control } = vi.hoisted(() => ({
  ops: [] as { op: string; path: string }[],
  control: { failDeleteFile: false, failDeleteDirectory: false },
}));

vi.mock('../../server/storage', () => ({
  getStorage: () => ({
    async deleteFile(path: string) {
      ops.push({ op: 'deleteFile', path });
      if (control.failDeleteFile) throw new Error(`boom: ${path}`);
    },
    async deleteDirectory(path: string) {
      ops.push({ op: 'deleteDirectory', path });
      if (control.failDeleteDirectory) throw new Error(`boom: ${path}`);
    },
  }),
}));

// The report/attachment branches fetch the db but never use it; a bare stub is
// enough to keep them off a real connection.
vi.mock('../../server/database', () => ({ getDatabase: async () => ({}) }));

import { deleteFileRow, deleteRunStorageDir } from '~~/server/utils/delete-run-files';
import type { File } from '~~/server/database/schema';

function fileRow(overrides: Partial<File>): File {
  return {
    id: 1,
    testRunId: 5,
    testRunsCaseId: null,
    type: 'attachment',
    subtype: null,
    label: null,
    path: 'project-1/run-5/thing.bin',
    size: 10,
    blobId: null,
    metadata: null,
    createdAt: new Date(),
    ...overrides,
  } as File;
}

beforeEach(() => {
  ops.length = 0;
  control.failDeleteFile = false;
  control.failDeleteDirectory = false;
});

describe('deleteFileRow — reports', () => {
  test('single-file report deletes only the file, never the project directory', async () => {
    // Blob reports and the gz-extraction fallback store the report directly
    // under project-<id>/, so its dirname is the project root.
    await deleteFileRow(fileRow({ type: 'report', path: 'project-1/run-1699999999-report.zip' }));

    expect(ops).toEqual([{ op: 'deleteFile', path: 'project-1/run-1699999999-report.zip' }]);
    // The regression: it must NOT wipe the whole project.
    expect(ops).not.toContainEqual({ op: 'deleteDirectory', path: 'project-1' });
  });

  test('directory report deletes its own report directory', async () => {
    await deleteFileRow(fileRow({ type: 'report', path: 'project-1/run-1699999999-html-report/index.html' }));

    expect(ops).toEqual([{ op: 'deleteDirectory', path: 'project-1/run-1699999999-html-report' }]);
  });

  test('a report path that is itself the project root deletes just the file', async () => {
    await deleteFileRow(fileRow({ type: 'report', path: 'project-42/report.zip' }));
    expect(ops).toEqual([{ op: 'deleteFile', path: 'project-42/report.zip' }]);
  });
});

describe('deleteFileRow — non-report, non-deduped files', () => {
  test('an attachment deletes exactly its own file', async () => {
    await deleteFileRow(fileRow({ type: 'attachment', path: 'project-1/run-5/screenshot.png' }));
    expect(ops).toEqual([{ op: 'deleteFile', path: 'project-1/run-5/screenshot.png' }]);
  });

  test('a non-deduped trace (no blobId) deletes its own file', async () => {
    await deleteFileRow(fileRow({ type: 'trace', blobId: null, path: 'project-1/run-5/9-trace.zip' }));
    expect(ops).toEqual([{ op: 'deleteFile', path: 'project-1/run-5/9-trace.zip' }]);
  });

  test('a deduplicated trace blob is left untouched — freed later by gcTraceBlobs', async () => {
    // A blob is shared across runs/cases, so its storage can only be freed once
    // the referencing rows are gone. deleteFileRow must not touch it (deleting it
    // here would either leak it or remove one another run still needs).
    await deleteFileRow(fileRow({ type: 'trace', blobId: 7, path: 'project-1/blobs/abc123.zip' }));
    expect(ops).toEqual([]);
  });
});

describe('deleteFileRow — error handling', () => {
  test('a storage failure is caught, not thrown', async () => {
    control.failDeleteFile = true;
    await expect(
      deleteFileRow(fileRow({ type: 'attachment', path: 'project-1/run-5/x.png' })),
    ).resolves.toBeUndefined();
    expect(ops).toEqual([{ op: 'deleteFile', path: 'project-1/run-5/x.png' }]);
  });
});

describe('deleteRunStorageDir', () => {
  test('sweeps exactly the run directory', async () => {
    await deleteRunStorageDir(1, 5);
    expect(ops).toEqual([{ op: 'deleteDirectory', path: 'project-1/run-5' }]);
  });

  test('a sweep failure is caught, not thrown', async () => {
    control.failDeleteDirectory = true;
    await expect(deleteRunStorageDir(2, 9)).resolves.toBeUndefined();
    expect(ops).toEqual([{ op: 'deleteDirectory', path: 'project-2/run-9' }]);
  });
});
