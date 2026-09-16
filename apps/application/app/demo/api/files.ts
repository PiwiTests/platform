/**
 * Client-side file serving for demo mode.
 *
 * Serves the demo's committed binary assets (screenshots, trace archives,
 * videos under public/demo/) by fetching the built static assets and
 * returning them as binary data through the service worker.
 *
 * Files that arrived with an imported run are served from IndexedDB instead —
 * they exist only in this visitor's browser, so there is nothing to fetch.
 */

import { getDemoDbBaseUrl, getDemoImportedFile } from '../db.client';

/** Path prefixes (relative to public/) that demo mode is allowed to serve. */
const ALLOWED_PREFIXES = ['demo/screenshots/', 'demo/traces/', 'demo/videos/'];

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  zip: 'application/zip',
  webm: 'video/webm',
  mp4: 'video/mp4',
};

/**
 * Serve a demo file. For allowed paths under public/demo/, fetches the actual
 * file from the build output (resolved against the demo base URL, so it works
 * when the demo is deployed under a sub-path like /demo/) and returns it as
 * binary data.
 */
export async function apiGetDemoFile(apiPath: string): Promise<unknown> {
  const filePath = decodeURIComponent(apiPath.replace(/^\/api\/files\//, ''));

  // Imported runs point at paths this visitor's browser holds, not at the
  // committed sample assets.
  const imported = await getDemoImportedFile(filePath);
  if (imported) return binaryResponse(imported, filePath, 'application/octet-stream');

  if (!ALLOWED_PREFIXES.some((prefix) => filePath.startsWith(prefix))) {
    return { available: false, message: 'File not available in demo mode' };
  }

  try {
    const base = getDemoDbBaseUrl().replace(/\/$/, '');
    const response = await fetch(`${base}/${filePath}`);
    if (!response.ok) {
      return { available: false, message: 'File not found' };
    }

    const blob = await response.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return binaryResponse(bytes, filePath, blob.type);
  } catch {
    return { available: false, message: 'Failed to load file' };
  }
}

/** Wrap bytes in the base64 envelope the service worker turns into a Response. */
export function binaryResponse(bytes: Uint8Array, filePath: string, fallbackType: string) {
  // Chunked so a multi-megabyte trace does not blow the argument limit of
  // `String.fromCharCode(...bytes)`.
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }

  const ext = filePath.toLowerCase().split('.').pop() || '';
  return {
    _binary: true,
    data: btoa(binary),
    contentType: CONTENT_TYPES[ext] || fallbackType || 'application/octet-stream',
  };
}
