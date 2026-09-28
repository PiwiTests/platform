const startedAt = Date.now();
export function track(event) {
  return [event, Date.now() - startedAt];
}
globalThis.piwiTrack = track;
