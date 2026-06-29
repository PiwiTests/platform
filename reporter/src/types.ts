/**
 * Reporter-local domain model, split by audience:
 *  - `types/wire.ts` — the **external** contract sent to / received from the server.
 *  - `types/collected.ts` — the **internal** model the reporter accumulates in process.
 *
 * This barrel re-exports both so `./types.js` imports keep resolving. Prefer
 * importing from the specific module (`./types/wire.js` / `./types/collected.js`)
 * so each import site shows whether it touches the wire contract or the internal model.
 */
export * from './types/wire.js';
export * from './types/collected.js';
