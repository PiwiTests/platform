/// <reference lib="webworker" />
/**
 * The "Ask the docs" worker: loads the index that scripts/generate-rag-index.mjs
 * publishes, ranks passages for a question, and picks the sentences to quote.
 *
 * Keyword ranking works as soon as the index is in. The embedding model
 * (transformers.js, served from the site itself) loads in the background; once
 * it is ready, questions are ranked by keywords and embeddings together and the
 * quoted sentences are chosen by embedding similarity. Nothing leaves the page:
 * every request goes to the site's own static files.
 */
import type { AnswerBlock, Source, WorkerMessage, WorkerRequest } from './protocol'
import {
  KeywordIndex,
  assess,
  assessKeywords,
  denseScores,
  excerpt,
  parseVectors,
  pickSources,
  quoteBlocks,
  rankPassages,
  topScores,
  type Confidence,
  type RagIndex,
  type VectorStore,
} from './search'

interface Loaded {
  index: RagIndex
  store: VectorStore
  keywords: KeywordIndex
}

type Embed = (input: string | string[], options: { pooling: string; normalize: boolean }) => Promise<{ data: Float32Array }>

const scope = self as unknown as DedicatedWorkerGlobalScope
const post = (message: WorkerMessage) => scope.postMessage(message)

let base = '/'
let loaded: Promise<Loaded> | null = null
let embed: Embed | null = null
let modelLoading = false

const RANKED = 30
const ANSWER_PASSAGES = 3

/** The index and the vectors of the same build: a browser may hold an older index.json than the vectors on the site. */
async function fetchIndex(cache: RequestCache): Promise<{ index: RagIndex; vectors: Response }> {
  const indexResponse = await fetch(`${base}rag/index.json`, { cache })
  if (!indexResponse.ok) throw new Error('the docs index could not be downloaded')
  const index = (await indexResponse.json()) as RagIndex
  return { index, vectors: await fetch(`${base}rag/${index.vectors}`) }
}

async function loadIndex(): Promise<Loaded> {
  let { index, vectors } = await fetchIndex('default')
  if (!vectors.ok) ({ index, vectors } = await fetchIndex('reload'))
  if (!vectors.ok) throw new Error('the docs index could not be downloaded')
  const store = parseVectors(await vectors.arrayBuffer(), index.passages.length, index.model.dim)
  return { index, store, keywords: new KeywordIndex(index.passages) }
}

async function loadModel(): Promise<void> {
  if (embed || modelLoading) return
  modelLoading = true
  try {
    const { index } = await loaded!
    const { pipeline, env } = await import('@huggingface/transformers')
    const root = new URL(base, scope.location.origin).href
    env.allowLocalModels = true
    env.allowRemoteModels = false
    // A root-relative path, not a full URL: transformers.js finds a local model's tokenizer files only for a path.
    env.localModelPath = `${base}rag/models/`
    const onnx = env.backends.onnx as { wasm: { wasmPaths: unknown; numThreads: number } }
    onnx.wasm.wasmPaths = {
      mjs: `${root}rag/ort/ort-wasm-simd-threaded.mjs`,
      wasm: `${root}rag/ort/ort-wasm-simd-threaded.wasm`,
    }
    // Multi-threaded WebAssembly needs cross-origin isolation, which static hosting cannot send.
    onnx.wasm.numThreads = 1

    const extractor = await pipeline('feature-extraction', index.model.id, {
      dtype: index.model.dtype as 'q8',
      device: 'wasm',
      progress_callback: (event: { status: string; file?: string; loaded?: number }) => {
        if (event.status === 'progress' && event.file?.endsWith('.onnx')) {
          post({ type: 'model-progress', loaded: event.loaded ?? 0, total: index.model.bytes })
        }
      },
    })
    embed = extractor as unknown as Embed
    post({ type: 'model-ready' })
  } catch (error) {
    post({ type: 'model-error', message: error instanceof Error ? error.message : String(error) })
  } finally {
    modelLoading = false
  }
}

async function ask(id: number, query: string): Promise<void> {
  const started = performance.now()
  const { index, store, keywords } = await loaded!
  const keywordHits = keywords.search(query, RANKED)

  let queryVector: Float32Array | null = null
  let denseHits = topScores([], 0)
  if (embed) {
    const output = await embed(index.model.queryPrefix + query, { pooling: index.model.pooling, normalize: true })
    queryVector = output.data
    denseHits = topScores(denseScores(store, queryVector), RANKED)
  }

  const ranked = rankPassages(query, denseHits, keywordHits)
  const shown = pickSources(query, ranked, index.passages)

  let confidence: Confidence = queryVector
    ? assess(query, denseHits[0]?.score ?? 0, keywords.unknownShare(query), keywordHits[0]?.matched ?? 0)
    : assessKeywords(query, keywordHits[0]?.matched ?? 0)

  let answer: AnswerBlock[] = []
  if (confidence === 'answer' && queryVector) {
    const { dim, pooling } = index.model
    answer = await quoteBlocks(
      query,
      queryVector,
      shown.slice(0, ANSWER_PASSAGES).map((hit) => index.passages[hit.index]!.text),
      async (texts) => (await embed!(texts, { pooling, normalize: true })).data,
      dim,
    )
    if (!answer.length) confidence = 'related'
  }

  const sources: Source[] =
    confidence === 'none'
      ? []
      : shown.map(({ index: at }) => {
          const { page, anchor, title, headings, text } = index.passages[at]!
          return { page, anchor, title, headings, excerpt: excerpt(text, query), markdown: text }
        })
  post({
    type: 'result',
    id,
    mode: queryVector ? 'hybrid' : 'keyword',
    confidence,
    answer,
    sources,
    ms: Math.round(performance.now() - started),
  })
}

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data
  if (request.type === 'init') {
    base = request.base
    loaded = loadIndex()
    loaded.then(
      ({ index }) => {
        post({
          type: 'index-ready',
          passages: index.passages.length,
          downloadBytes: index.model.bytes + index.model.runtimeBytes,
        })
        if (request.loadModel) void loadModel()
      },
      (error: unknown) => post({ type: 'index-error', message: error instanceof Error ? error.message : String(error) }),
    )
  } else if (request.type === 'load-model') {
    void loadModel()
  } else if (request.type === 'ask') {
    ask(request.id, request.query).catch((error: unknown) =>
      post({ type: 'error', id: request.id, message: error instanceof Error ? error.message : String(error) }),
    )
  }
}
