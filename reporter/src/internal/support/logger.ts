/**
 * Tiny prefixed logger. Owns the `[Piwi Dashboard]` prefix and the verbose
 * gate so the prefix isn't typed out ~46× across the package and `verbose`
 * doesn't need to be threaded into every constructor.
 *
 * Channel preservation:
 * - `info`  → stdout (always),
 * - `warn`  → stderr (always),
 * - `error` → stderr (always),
 * - `debug` → stdout (only when `verbose`),
 * - `debugError` → stderr (only when `verbose`).
 *
 * `debugError` exists so verbose-only diagnostics that previously used
 * `console.error` (e.g. HTTP response bodies on failure) keep going to stderr
 * after the refactor.
 */
export class Logger {
  private readonly prefix = '[Piwi Dashboard] ';

  constructor(private readonly verbose: boolean = false) {}

  info(msg: string): void {
    console.log(this.prefix + msg);
  }

  warn(msg: string): void {
    console.warn(this.prefix + msg);
  }

  error(msg: string): void {
    console.error(this.prefix + msg);
  }

  debug(msg: string): void {
    if (this.verbose) console.log(this.prefix + msg);
  }

  debugError(msg: string): void {
    if (this.verbose) console.error(this.prefix + msg);
  }
}
