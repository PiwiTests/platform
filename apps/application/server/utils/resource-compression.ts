import { gzipSync, gunzipSync } from 'zlib';

/**
 * At-rest compression for the shared trace-resource pool
 * (`project-<id>/trace-resources/<name>`).
 *
 * Playwright names each resource by its content hash, so the pool already stores
 * every unique resource once. What it did not do is shrink them: network bodies
 * (HTML, JS, CSS, JSON) are text and compress well, yet were written raw. These
 * helpers gzip a resource on the way in and restore it on the way out.
 *
 * A compressed resource is stored as a self-describing container — a 4-byte
 * magic prefix followed by the gzip stream. The magic is what makes decoding
 * safe: Playwright can legitimately store a resource whose own bytes are already
 * gzip (a response captured still content-encoded), and sniffing for the gzip
 * magic alone would wrongly decode those. A raw resource is written verbatim and
 * never carries the prefix, so {@link decodeResource} touches only the bytes
 * this module compressed. That also means no schema column and no migration: the
 * bytes on disk carry their own encoding, and old raw resources keep reading
 * exactly as before.
 */

/** Marks a container written by {@link compressResource}: "PZ" + version 0x0001. */
const RES_GZIP_MAGIC = Buffer.from([0x50, 0x5a, 0x00, 0x01]);

/** zlib default — most of the ratio, a fraction of level 9's CPU on ingest. */
const GZIP_LEVEL = 6;

/**
 * Upper bound on a decoded resource, matching the trace-entry ceiling in
 * `trace-zip.ts`. Every stored container was produced here from data already
 * bounded at ingest, so this only guards against a corrupt file, never a real
 * resource.
 */
const MAX_RESOURCE_BYTES = 512 * 1024 * 1024;

/**
 * True when `data` is almost certainly already compressed, by magic bytes.
 * Deflating these wastes CPU and tends to grow them; the size guard in
 * {@link compressResource} would catch the growth anyway, but skipping the work
 * up front keeps ingest cheap. Conservative on purpose — anything not listed
 * still goes through the try-and-compare path.
 */
function isLikelyIncompressible(data: Buffer): boolean {
  if (data.length < 4) return true;
  const b0 = data[0]!;
  const b1 = data[1]!;
  const b2 = data[2]!;
  const b3 = data[3]!;
  // PNG
  if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47) return true;
  // JPEG
  if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) return true;
  // GIF ("GIF8")
  if (b0 === 0x47 && b1 === 0x49 && b2 === 0x46 && b3 === 0x38) return true;
  // RIFF container (WebP, and other already-compact media)
  if (b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46) return true;
  // gzip
  if (b0 === 0x1f && b1 === 0x8b) return true;
  // zip / jar / office ("PK")
  if (b0 === 0x50 && b1 === 0x4b) return true;
  // zstd
  if (b0 === 0x28 && b1 === 0xb5 && b2 === 0x2f && b3 === 0xfd) return true;
  // WOFF / WOFF2 (already-compressed web fonts)
  if (b0 === 0x77 && b1 === 0x4f && b2 === 0x46 && (b3 === 0x46 || b3 === 0x32)) return true;
  return false;
}

/**
 * Compress a resource for storage. Returns the bytes to write and whether they
 * were compressed. Falls back to the original bytes when the resource looks
 * already-compressed, is too small to bother with, or does not actually shrink —
 * so a resource is never stored larger than it arrived.
 */
export function compressResource(data: Buffer): { data: Buffer; compressed: boolean } {
  if (data.length === 0 || isLikelyIncompressible(data)) return { data, compressed: false };
  const container = Buffer.concat([RES_GZIP_MAGIC, gzipSync(data, { level: GZIP_LEVEL })]);
  if (container.length < data.length) return { data: container, compressed: true };
  return { data, compressed: false };
}

/**
 * Restore a stored resource to its original bytes. Bytes without the magic
 * prefix — every raw and every pre-compression resource — are returned
 * unchanged, so this is safe to apply at every pool read site.
 */
export function decodeResource(data: Buffer): Buffer {
  if (data.length >= RES_GZIP_MAGIC.length && data.subarray(0, RES_GZIP_MAGIC.length).equals(RES_GZIP_MAGIC)) {
    return gunzipSync(data.subarray(RES_GZIP_MAGIC.length), { maxOutputLength: MAX_RESOURCE_BYTES });
  }
  return data;
}
