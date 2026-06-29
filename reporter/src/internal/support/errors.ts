/**
 * Extract a human-readable message from an unknown thrown value.
 *
 * `catch` bindings are typed `unknown` (TypeScript strict mode), so reach for
 * this instead of `(error as any).message` — it returns `error.message` for any
 * `Error` (including `HttpError`) and a stringified form otherwise.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
