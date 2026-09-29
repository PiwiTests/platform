import { apiError } from './api-error';
import type { UrlPatternWriteResult } from '#shared/handlers/url-patterns';

/** The HTTP error for a refused URL-pattern write. */
export function urlPatternWriteError(result: Extract<UrlPatternWriteResult, { ok: false }>) {
  if (result.reason === 'not-found') return apiError({ statusCode: 404, message: 'Project not found' });
  if (result.reason === 'too-many')
    return apiError({ statusCode: 400, message: 'A project has at most 100 URL patterns' });
  return apiError({ statusCode: 409, message: `The project already has the pattern ${result.pattern}` });
}
