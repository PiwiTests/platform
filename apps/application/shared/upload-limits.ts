/**
 * Size ceiling for the multipart ingest endpoints.
 *
 * The upload and import endpoints buffer the body whole before parsing, so for
 * them the cap bounds peak memory as much as it bounds the wire; `case-files`
 * streams its parts to disk. The cap is exposed to the browser by the import
 * pre-flight endpoint, letting the import page reject an oversized archive
 * before spending the upload.
 */

/** Default ceiling for `/api/test-runs/upload` and `/api/test-runs/import`. */
export const DEFAULT_MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

/** Lowest and highest values `PIWI_IMPORT_MAX_BYTES` may set. */
export const MIN_IMPORT_MAX_BYTES = 1024 * 1024;
export const MAX_IMPORT_MAX_BYTES = 5 * 1024 * 1024 * 1024;
