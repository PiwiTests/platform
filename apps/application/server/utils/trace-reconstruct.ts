import { getStorage } from '../storage';
import { parseZip, buildZip } from './trace-zip';
import { decodeResource } from './resource-compression';

/**
 * Reconstruct a full Playwright trace ZIP from a slim ZIP and its shared resource pool.
 *
 * The slim ZIP contains only the event/network/stack entries; the manifest lists the
 * resource filenames that were extracted to the project-wide shared pool.  We fetch
 * the resources in parallel and rebuild a complete ZIP that the trace viewer can open.
 *
 * Returns null if any required component is missing so the caller can fall back.
 */
export async function reconstructTraceZip(
  storage: ReturnType<typeof getStorage>,
  slimZipData: Buffer,
  manifestPath: string,
  projectPrefix: string, // e.g. "project-1/"
): Promise<Buffer | null> {
  try {
    const manifestData = await storage.readFile(manifestPath);
    const manifest = JSON.parse(manifestData.toString('utf8')) as { resources?: string[] };
    const resourceNames = manifest.resources ?? [];

    // Parse slim ZIP to recover event entries
    const slimEntries = await parseZip(slimZipData);

    // Fetch shared resources in bounded batches rather than all at once, so a
    // trace with hundreds of resources doesn't open hundreds of simultaneous
    // storage reads (which pressures S3 connection/rate limits); missing
    // resources are skipped.
    const resourceEntries: { name: string; data: Buffer }[] = [];
    const RESOURCE_FETCH_CONCURRENCY = 16;
    for (let i = 0; i < resourceNames.length; i += RESOURCE_FETCH_CONCURRENCY) {
      const batch = resourceNames.slice(i, i + RESOURCE_FETCH_CONCURRENCY);
      const settled = await Promise.all(
        batch.map(async (name) => {
          const resourcePath = `${projectPrefix}trace-resources/${name}`;
          try {
            const data = decodeResource(await storage.readFile(resourcePath));
            return { name: `resources/${name}`, data };
          } catch {
            console.warn(`[TraceZip] Missing shared resource: ${resourcePath}`);
            return null;
          }
        }),
      );
      for (const entry of settled) if (entry) resourceEntries.push(entry);
    }

    return buildZip([...slimEntries, ...resourceEntries]);
  } catch (err) {
    console.warn(`[TraceZip] Reconstruction failed: ${err}`);
    return null;
  }
}

/**
 * Read a stored file, rebuilding it into a complete trace archive when the path
 * points at a slim trace blob. Any other path is returned as stored.
 */
export async function readFileResolvingTrace(path: string): Promise<Buffer | null> {
  const storage = getStorage();
  if (!(await storage.exists(path))) return null;

  const data = await storage.readFile(path);
  if (!path.endsWith('.zip') || !path.includes('/blobs/')) return data;

  const manifestPath = path.replace(/\.zip$/, '.manifest.json');
  const projectPrefix = path.split('/blobs/')[0] + '/';
  if (!(await storage.exists(manifestPath))) return data;

  return (await reconstructTraceZip(storage, data, manifestPath, projectPrefix)) ?? data;
}
