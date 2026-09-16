/**
 * HTTP errors for demo-mode handlers.
 *
 * The demo router runs inside a service worker, so it cannot throw Nitro's
 * `createError`. Handlers throw these instead; `demo-sw.ts` maps the
 * `statusCode` onto the HTTP response so client errors surface as 4xx (with
 * the right code for the app's error handling, e.g. 409 → "already running")
 * instead of a generic 500. The `errorCode` mirrors the real API's
 * `data.errorCode` so the demo answers with the same error contract.
 */

import { type ErrorCode, errorCodeForStatus } from '#shared/utils/error-codes';

export interface DemoHttpError extends Error {
  statusCode: number;
  errorCode: ErrorCode;
}

export function demoHttpError(statusCode: number, message: string, errorCode?: ErrorCode): DemoHttpError {
  const error = new Error(message) as DemoHttpError;
  error.statusCode = statusCode;
  error.errorCode = errorCode ?? errorCodeForStatus(statusCode);
  return error;
}
