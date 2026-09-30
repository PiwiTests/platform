/** Largest non-multipart request body the server reads. Uploads are multipart and carry their own limits. */
export const MAX_REQUEST_BODY_BYTES = 32 * 1024 * 1024;

// The reporter's batch submit carries a whole run as one JSON document.
const UNCAPPED_PATHS = ['/api/test-runs/submit'];

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Why a request body must be refused before any route reads it, or null. A
 * non-multipart body has to declare its size, since h3 buffers it whole: a
 * chunked one (no `Content-Length`) gets 411, one over
 * {@link MAX_REQUEST_BODY_BYTES} gets 413. Routes that check `Content-Length`
 * against a smaller limit can then rely on it.
 */
export function bodyLimitError(request: {
  method: string;
  path: string;
  contentType?: string | null;
  contentLength?: string | null;
  transferEncoding?: string | null;
}): { statusCode: 411 | 413; message: string } | null {
  if (!BODY_METHODS.has(request.method.toUpperCase())) return null;
  if ((request.contentType ?? '').toLowerCase().startsWith('multipart/form-data')) return null;
  if (request.contentLength == null || request.contentLength === '') {
    return request.transferEncoding
      ? { statusCode: 411, message: 'Send the request body with a Content-Length header' }
      : null;
  }
  const length = Number(request.contentLength);
  const path = request.path.split('?')[0]!;
  if (Number.isFinite(length) && length > MAX_REQUEST_BODY_BYTES && !UNCAPPED_PATHS.includes(path)) {
    return { statusCode: 413, message: `Request body over ${MAX_REQUEST_BODY_BYTES / 1024 / 1024} MB` };
  }
  return null;
}
