import { describe, expect, test } from 'vitest';
import { downloadInParts, planParts, probe } from '../../../docs/.vitepress/theme/ask-docs/download';

/** A host that serves `bytes` with range requests, and misbehaves on demand. */
function host(
  bytes: Uint8Array,
  behavior: { ignoreRanges?: boolean; failOnce?: Set<string>; short?: Set<string> } = {},
) {
  const requests: string[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const range = new Headers(init?.headers).get('range');
    requests.push(range ?? 'all');
    if (!range || behavior.ignoreRanges) return new Response(bytes, { status: 200 });
    const [, from, to] = range.match(/bytes=(\d+)-(\d+)/)!;
    if (behavior.failOnce?.delete(range)) return new Response('busy', { status: 503 });
    let slice = bytes.slice(Number(from), Number(to) + 1);
    if (behavior.short?.has(range)) slice = slice.slice(0, slice.length - 1);
    return new Response(slice, {
      status: 206,
      headers: { 'content-range': `bytes ${from}-${Number(from) + slice.length - 1}/${bytes.length}` },
    });
  }) as typeof fetch;
  return { fetchImpl, requests };
}

const sample = (size: number) => Uint8Array.from({ length: size }, (_unused, i) => (i * 7 + 3) % 251);
const bytesOf = async (blob: Blob | null) => new Uint8Array(await blob!.arrayBuffer());

describe('planParts', () => {
  test('covers the file in inclusive ranges of at most one part', () => {
    expect(planParts(10, 4)).toEqual([
      [0, 3],
      [4, 7],
      [8, 9],
    ]);
    expect(planParts(8, 4)).toEqual([
      [0, 3],
      [4, 7],
    ]);
    expect(planParts(3, 4)).toEqual([[0, 2]]);
    expect(planParts(0, 4)).toEqual([]);
  });
});

describe('probe', () => {
  test('reads the size from the first byte', async () => {
    expect(await probe('https://host/file', host(sample(1000)).fetchImpl)).toEqual({
      url: 'https://host/file',
      size: 1000,
    });
  });

  test('returns null when the host ignores ranges', async () => {
    expect(await probe('https://host/file', host(sample(1000), { ignoreRanges: true }).fetchImpl)).toBeNull();
  });
});

describe('downloadInParts', () => {
  test('joins the parts in order, whatever order they finish in', async () => {
    const data = sample(1000);
    const { fetchImpl } = host(data);
    const blob = await downloadInParts('https://host/file', { partBytes: 64, connections: 5, fetchImpl });
    expect(await bytesOf(blob)).toEqual(data);
  });

  test('asks for one range per part, and once for the size', async () => {
    const { fetchImpl, requests } = host(sample(1000));
    await downloadInParts('https://host/file', { partBytes: 250, connections: 3, fetchImpl });
    expect(requests.sort()).toEqual(['bytes=0-0', 'bytes=0-249', 'bytes=250-499', 'bytes=500-749', 'bytes=750-999']);
  });

  test('reports progress up to the size of the file', async () => {
    const { fetchImpl } = host(sample(1000));
    const seen: number[] = [];
    await downloadInParts('https://host/file', {
      partBytes: 300,
      fetchImpl,
      onProgress: (loaded, total) => {
        expect(total).toBe(1000);
        seen.push(loaded);
      },
    });
    expect(seen.at(-1)).toBe(1000);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  test('asks again for a part that failed, and for one that came back short', async () => {
    const data = sample(600);
    const { fetchImpl } = host(data, { failOnce: new Set(['bytes=200-399']), short: new Set(['bytes=400-599']) });
    // The short part stays short on every attempt: the download fails instead of returning a damaged file.
    await expect(downloadInParts('https://host/file', { partBytes: 200, fetchImpl, retries: 1 })).rejects.toThrow(
      'short',
    );
    const healthy = host(data, { failOnce: new Set(['bytes=200-399']) });
    expect(
      await bytesOf(await downloadInParts('https://host/file', { partBytes: 200, fetchImpl: healthy.fetchImpl })),
    ).toEqual(data);
  });

  test('gives up as null when the host cannot serve ranges', async () => {
    expect(
      await downloadInParts('https://host/file', { fetchImpl: host(sample(100), { ignoreRanges: true }).fetchImpl }),
    ).toBeNull();
  });
});
