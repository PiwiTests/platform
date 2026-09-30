/** The JSON events in a server-sent events body, one per `data:` line. */
export function parseSseText(text: string): Record<string, unknown>[] {
  return text
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => {
      try {
        return JSON.parse(l.slice('data:'.length).trim());
      } catch {
        return null;
      }
    })
    .filter((e): e is Record<string, unknown> => e !== null);
}

/** Read an SSE stream until `predicate` holds for the events so far, or the timeout passes. */
export async function readSseUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (events: Record<string, unknown>[]) => boolean,
  timeoutMs = 5000,
): Promise<Record<string, unknown>[]> {
  const decoder = new TextDecoder();
  let text = '';
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) text += decoder.decode(value, { stream: true });

    const events = parseSseText(text);
    if (predicate(events)) return events;
  }

  return parseSseText(text);
}
