import { extname } from 'path';
import { requireAuth } from '../../utils/auth';
import { requireProjectAccess } from '../../utils/project-access';
import { getStorage } from '../../storage';
import { gunzip } from 'zlib';
import { promisify } from 'util';
import { parseZip, buildZip } from '../../utils/trace-zip';
import { Role } from '../../../shared/types';
import sharp from 'sharp';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Files'],
    summary: 'Download a stored file',
    description:
      'Serves stored files including test reports, trace archives, and attachments. Supports trace ZIP reconstruction from slim blobs and gzip decompression for report archives.',
    parameters: [{ name: 'path', in: 'path', required: true, schema: { type: 'string' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

const gunzipAsync = promisify(gunzip);

/**
 * Parse a compressed report archive and find a specific file by name.
 * Archive format: custom binary with LE length-prefixed path+content pairs.
 */
async function findInArchive(buffer: Buffer, targetName: string): Promise<Buffer | null> {
  const uncompressed = await gunzipAsync(buffer);
  let offset = 0;
  while (offset < uncompressed.length) {
    if (offset + 4 > uncompressed.length) break;
    const pathLength = uncompressed.readUInt32LE(offset);
    offset += 4;
    if (pathLength === 0 || pathLength > 10000) break;
    if (offset + pathLength > uncompressed.length) break;
    const filePath = uncompressed.toString('utf8', offset, offset + pathLength);
    offset += pathLength;
    if (offset + 4 > uncompressed.length) break;
    const contentLength = uncompressed.readUInt32LE(offset);
    offset += 4;
    if (offset + contentLength > uncompressed.length) break;
    if (filePath === targetName || filePath.endsWith(targetName)) {
      return uncompressed.subarray(offset, offset + contentLength);
    }
    offset += contentLength;
  }
  return null;
}

/**
 * Reconstruct a full Playwright trace ZIP from a slim ZIP and its shared resource pool.
 *
 * The slim ZIP contains only the event/network/stack entries; the manifest lists the
 * resource filenames that were extracted to the project-wide shared pool.  We fetch
 * the resources in parallel and rebuild a complete ZIP that the trace viewer can open.
 *
 * Returns null if any required component is missing so the caller can fall back.
 */
async function reconstructTraceZip(
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

    // Fetch all shared resources in parallel; skip any that are missing
    const resourceEntries = (
      await Promise.all(
        resourceNames.map(async (name) => {
          const resourcePath = `${projectPrefix}trace-resources/${name}`;
          try {
            const data = await storage.readFile(resourcePath);
            return { name: `resources/${name}`, data };
          } catch {
            console.warn(`[TraceZip] Missing shared resource: ${resourcePath}`);
            return null;
          }
        }),
      )
    ).filter((e): e is NonNullable<typeof e> => e !== null);

    return buildZip([...slimEntries, ...resourceEntries]);
  } catch (err) {
    console.warn(`[TraceZip] Reconstruction failed: ${err}`);
    return null;
  }
}

const COMPRESSIBLE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export default eventHandler(async (event) => {
  const path = getRouterParam(event, 'path');
  const query = getQuery(event);
  const overrideContentType = typeof query.contentType === 'string' ? query.contentType : null;
  const wantCompressed = query.compress === '1';

  // Extract project ID from path for access control
  const pathStr = path || '';
  const pathMatch = pathStr.match(/^project-(\d+)\//);
  if (pathMatch && pathMatch[1]) {
    const projectId = parseInt(pathMatch[1]);
    if (projectId) {
      await requireProjectAccess(event, projectId);
    } else {
      await requireAuth(event);
    }
  } else {
    await requireAuth(event);
  }

  if (!path) {
    throw createError({
      statusCode: 400,
      message: 'File path is required',
    });
  }

  // Security: Prevent path traversal
  if (path.includes('..') || path.startsWith('/')) {
    throw createError({
      statusCode: 403,
      message: 'Invalid file path',
    });
  }

  const storage = getStorage();

  // Security headers applied to all file responses
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff');
  setResponseHeader(event, 'Cache-Control', 'no-store');

  // Trace archives are fetched cross-origin by the hosted Playwright trace
  // viewer (trace.playwright.dev) from the user's browser
  if (path.endsWith('.zip')) {
    setResponseHeader(event, 'Access-Control-Allow-Origin', '*');
  }

  // Content types that should be displayed inline rather than downloaded
  const inlineDispositionTypes = new Set([
    'text/html',
    'text/css',
    'text/markdown',
    'text/plain',
    'application/json',
    'application/javascript',
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/svg+xml',
    'image/webp',
    'font/woff2',
    'font/ttf',
  ]);

  // Helper to serve a file with the right content type
  function setContentType(ext: string): string {
    if (ext === '.html' || ext === '.htm') return 'text/html';
    if (ext === '.gz') return 'application/gzip';
    if (ext === '.zip') return 'application/zip';
    if (ext === '.json') return 'application/json';
    if (ext === '.js') return 'application/javascript';
    if (ext === '.css') return 'text/css';
    if (ext === '.md' || ext === '.mdx') return 'text/markdown';
    if (ext === '.txt') return 'text/plain';
    if (ext === '.png') return 'image/png';
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.gif') return 'image/gif';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.svg') return 'image/svg+xml';
    if (ext === '.woff' || ext === '.woff2') return 'font/woff2';
    if (ext === '.ttf') return 'font/ttf';
    if (ext === '.wasm') return 'application/wasm';
    return 'application/octet-stream';
  }

  function applyInlineDisposition(contentType: string): void {
    if (inlineDispositionTypes.has(contentType)) {
      setResponseHeader(event, 'Content-Disposition', 'inline');
    }
  }

  function resolveContentType(ext: string): string {
    // If caller provided a content type override, use it for unrecognized extensions
    const guessed = setContentType(ext);
    if (guessed === 'application/octet-stream' && overrideContentType) {
      return overrideContentType;
    }
    return guessed;
  }

  /**
   * Apply a Content-Security-Policy sandbox to untrusted HTML responses.
   * User-uploaded report HTML can contain arbitrary scripts; sandboxing
   * prevents them from executing in the dashboard's origin.
   */
  function applyHtmlCsp(): void {
    // Sandbox with allow-scripts so Playwright/Monocart reports (which rely on
    // JavaScript to render) are usable.  allow-same-origin is needed for
    // self-contained resource loads (CSS, JS, fonts, images bundled in the
    // same directory).  All other sandbox restrictions — no forms, no popups,
    // no navigation — remain in place.
    setResponseHeader(event, 'Content-Security-Policy', 'sandbox allow-scripts allow-same-origin');
  }

  // 1. Try exact path
  if (await storage.exists(path)) {
    const fileContent = await storage.readFile(path);
    const ext = extname(path).toLowerCase();

    // Slim trace blob: reconstruct full ZIP from shared resource pool
    if (ext === '.zip' && path.includes('/blobs/')) {
      const manifestPath = path.replace(/\.zip$/, '.manifest.json');
      const projectPrefix = path.split('/blobs/')[0] + '/';
      if (await storage.exists(manifestPath)) {
        const fullZip = await reconstructTraceZip(storage, fileContent, manifestPath, projectPrefix);
        if (fullZip) {
          setResponseHeader(event, 'Content-Type', 'application/zip');
          setResponseHeader(event, 'Content-Length', fullZip.length);
          return fullZip;
        }
        // Reconstruction failed — fall through to serve the slim ZIP as-is
      }
    }

    // If the file is a .gz archive, try to serve index.html from inside
    if (ext === '.gz') {
      try {
        const htmlContent = await findInArchive(fileContent, 'index.html');
        if (htmlContent) {
          setResponseHeader(event, 'Content-Type', 'text/html');
          applyHtmlCsp();
          applyInlineDisposition('text/html');
          setResponseHeader(event, 'Content-Length', htmlContent.length);
          return htmlContent;
        }
      } catch {
        // Fall through to serve raw gzip
      }
    }

    const contentType = resolveContentType(ext);

    // Compress image on demand: resize to max 1280px, output as WebP
    if (wantCompressed && COMPRESSIBLE_IMAGE_TYPES.has(contentType)) {
      try {
        const compressed = await sharp(fileContent).resize(1280, 1280, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 90 }).toBuffer();
        setResponseHeader(event, 'Content-Type', 'image/webp');
        setResponseHeader(event, 'Content-Length', compressed.length);
        applyInlineDisposition('image/webp');
        return compressed;
      } catch {
        // Fall through to serve original if sharp fails
      }
    }

    setResponseHeader(event, 'Content-Type', contentType);
    setResponseHeader(event, 'Content-Length', fileContent.length);
    applyInlineDisposition(contentType);
    if (contentType === 'text/html') {
      applyHtmlCsp();
    }
    return fileContent;
  }

  // 2. Try path + /index.html (directory without explicit index.html)
  const indexPath = `${path.replace(/\/+$/, '')}/index.html`;
  if (await storage.exists(indexPath)) {
    const fileContent = await storage.readFile(indexPath);
    setResponseHeader(event, 'Content-Type', 'text/html');
    applyHtmlCsp();
    applyInlineDisposition('text/html');
    setResponseHeader(event, 'Content-Length', fileContent.length);
    return fileContent;
  }

  // 3. Try path + .gz (compressed archive - decompress and serve index.html)
  const gzPath = `${path}.gz`;
  if (await storage.exists(gzPath)) {
    const gzContent = await storage.readFile(gzPath);
    try {
      const htmlContent = await findInArchive(gzContent, 'index.html');
      if (htmlContent) {
        setResponseHeader(event, 'Content-Type', 'text/html');
        applyHtmlCsp();
        applyInlineDisposition('text/html');
        setResponseHeader(event, 'Content-Length', htmlContent.length);
        return htmlContent;
      }
    } catch {
      // Fall through to 404
    }
  }

  throw createError({
    statusCode: 404,
    message: 'File not found',
  });
});
