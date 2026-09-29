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
import type { AnswerLine, Source, WorkerMessage, WorkerRequest } from './protocol'
import {
  KeywordIndex,
  assess,
  assessKeywords,
  candidateSentences,
  cosine,
  denseScores,
  excerpt,
  identifiersIn,
  limitPerPage,
  looksLikeIdentifier,
  mentionsIdentifier,
  parseVectors,
  rankPassages,
  selectAnswer,
  topScores,
  type Confidence,
  type RagIndex,
  type ScoredSentence,
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
const SHOWN = 5
const PER_PAGE = 2
const ANSWER_PASSAGES = 3

async function loadIndex(): Promise<Loaded> {
  const [indexResponse, vectorsResponse] = await Promise.all([
    fetch(`${base}rag/index.json`),
    fetch(`${base}rag/vectors.bin`),
  ])
  if (!indexResponse.ok || !vectorsResponse.ok) throw new Error('the docs index could not be downloaded')
  const index = (await indexResponse.json()) as RagIndex
  const store = parseVectors(await vectorsResponse.arrayBuffer(), index.passages.length, index.model.dim)
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
  // A bare name lists the passages that contain it, when there are any.
  const identifiers = identifiersIn(query)
  const exact = looksLikeIdentifier(query)
    ? ranked.filter(({ index: at }) => mentionsIdentifier(index.passages[at]!.text, identifiers))
    : []
  const shown = limitPerPage(exact.length ? exact : ranked, index.passages, PER_PAGE, SHOWN)

  let confidence: Confidence = queryVector
    ? assess(query, denseHits[0]?.score ?? 0, keywords.unknownShare(query), keywordHits[0]?.matched ?? 0)
    : assessKeywords(query, keywordHits[0]?.matched ?? 0)

  let answer: AnswerLine[] = []
  if (confidence === 'answer' && queryVector) {
    answer = await quote(query, queryVector, shown.slice(0, ANSWER_PASSAGES).map((hit) => hit.index), index)
    if (!answer.length) confidence = 'related'
  }

  const sources: Source[] =
    confidence === 'none'
      ? []
      : shown.map(({ index: at }) => {
          const { page, anchor, title, headings, text } = index.passages[at]!
          return { page, anchor, title, headings, excerpt: excerpt(text, query) }
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

/** Pick the sentences of the best passages that answer the question: by embedding similarity, or by the words of a bare name. */
async function quote(query: string, queryVector: Float32Array, passages: number[], index: RagIndex): Promise<AnswerLine[]> {
  const candidates = passages.flatMap((at, passage) =>
    candidateSentences(index.passages[at]!.text).map((text, order) => ({ text, passage, order })),
  )
  if (!candidates.length) return []

  let scored: ScoredSentence[]
  let chosen: ScoredSentence[]
  if (looksLikeIdentifier(query)) {
    const identifiers = identifiersIn(query)
    scored = candidates.map((candidate) => ({ ...candidate, score: mentionsIdentifier(candidate.text, identifiers) }))
    chosen = selectAnswer(scored, 0.9, 0.1)
  } else {
    const { dim, pooling } = index.model
    const output = await embed!(
      candidates.map((candidate) => candidate.text),
      { pooling, normalize: true },
    )
    scored = candidates.map((candidate, k) => ({
      ...candidate,
      score: cosine(queryVector, output.data.subarray(k * dim, (k + 1) * dim)),
    }))
    chosen = selectAnswer(scored)
  }
  return chosen.map(({ text, passage }) => ({ text, source: passage }))
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
