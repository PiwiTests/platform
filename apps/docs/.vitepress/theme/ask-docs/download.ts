/**
 * Downloads a large file with several connections at once.
 *
 * A single HTTP stream from Hugging Face's CDN carries about 35 to 45 MB/s,
 * while several ranged requests at once reach four times that, and transformers.js
 * fetches a model file on one stream. The file is cut into parts, a few
 * connections take the next part each, and the parts are joined in order. The
 * result is a Blob, which the browser can keep out of the JavaScript heap.
 */

/** Size of one part: large enough that the redirect every request starts with is a small share of its time. */
export const PART_BYTES = 32 * 1024 * 1024
export const CONNECTIONS = 8

/** The inclusive byte ranges that cover `size` bytes in parts of at most `partBytes`. */
export function planParts(size: number, partBytes = PART_BYTES): Array<[number, number]> {
  const parts: Array<[number, number]> = []
  for (let start = 0; start < size; start += partBytes) parts.push([start, Math.min(start + partBytes, size) - 1])
  return parts
}

export interface Remote {
  /** The address the file is served from once redirects are followed. */
  url: string
  size: number
}

/** The size of a file, and where it is served from, by asking for its first byte; null when the host ignores ranges. */
export async function probe(url: string, fetchImpl: typeof fetch = fetch): Promise<Remote | null> {
  const response = await fetchImpl(url, { headers: { Range: 'bytes=0-0' } })
  await response.body?.cancel()
  if (response.status !== 206) return null
  const size = Number(response.headers.get('content-range')?.match(/\/(\d+)$/)?.[1])
  return Number.isFinite(size) && size > 0 ? { url: response.url || url, size } : null
}

export interface DownloadOptions {
  connections?: number
  partBytes?: number
  /** How many times a part that fails is asked for again. */
  retries?: number
  onProgress?: (loaded: number, total: number) => void
  fetchImpl?: typeof fetch
}

/** The whole file, or null when the host cannot serve ranges: the caller then downloads it on one stream. */
export async function downloadInParts(url: string, options: DownloadOptions = {}): Promise<Blob | null> {
  const { connections = CONNECTIONS, partBytes = PART_BYTES, retries = 2, onProgress, fetchImpl = fetch } = options
  const remote = await probe(url, fetchImpl)
  if (!remote) return null

  const parts = planParts(remote.size, partBytes)
  const blobs: Blob[] = new Array(parts.length)
  let loaded = 0
  let next = 0

  async function fetchPart(index: number) {
    const [start, end] = parts[index]!
    for (let attempt = 0; ; attempt++) {
      let got = 0
      try {
        // The resolved address skips the redirect; the original one is the fallback when it has expired.
        const response = await fetchImpl(attempt === 0 ? remote!.url : url, { headers: { Range: `bytes=${start}-${end}` } })
        if (response.status !== 206 || !response.body) throw new Error(`HTTP ${response.status}`)
        const chunks: Uint8Array[] = []
        const reader = response.body.getReader()
        for (let read = await reader.read(); !read.done; read = await reader.read()) {
          chunks.push(read.value)
          got += read.value.length
          loaded += read.value.length
          onProgress?.(loaded, remote!.size)
        }
        if (got !== end - start + 1) throw new Error('a part came back short')
        blobs[index] = new Blob(chunks as BlobPart[])
        return
      } catch (error) {
        loaded -= got
        if (attempt >= retries) throw error
      }
    }
  }

  async function take() {
    for (let index = next++; index < parts.length; index = next++) await fetchPart(index)
  }

  await Promise.all(Array.from({ length: Math.min(connections, parts.length) }, take))
  return new Blob(blobs)
}
