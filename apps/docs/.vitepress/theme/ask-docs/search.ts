/**
 * Retrieval for the "Ask the docs" panel: pure functions over the index that
 * scripts/generate-rag-index.mjs writes, with no DOM and no model, so the worker
 * and the unit tests share them.
 *
 * Two rankings are combined. The keyword ranking (BM25) finds exact names such
 * as `PIWI_AI_PROVIDER` or `runLabel`, which a small embedding model blurs. The
 * dense ranking (cosine similarity of embeddings) finds a passage that answers
 * the question in other words. Reciprocal rank fusion merges the two lists.
 */

export interface Passage {
  page: string
  /** VitePress anchor of the passage's section; empty for a page's lead. */
  anchor: string
  title: string
  headings: string[]
  text: string
}

export interface ModelInfo {
  id: string
  dtype: string
  dim: number
  pooling: 'cls' | 'mean'
  queryPrefix: string
  /** Size of the model file, then of the WebAssembly runtime it runs on, in bytes. */
  bytes: number
  runtimeBytes: number
}

export interface RagIndex {
  version: string
  model: ModelInfo
  passages: Passage[]
}

/** Int8 embeddings, one row per passage, each with its own float32 scale. */
export interface VectorStore {
  count: number
  dim: number
  scales: Float32Array
  data: Int8Array
}

export interface Scored {
  index: number
  score: number
}

// ── Vectors ───────────────────────────────────────────────────────────────────

/** Read vectors.bin: `count` float32 scales, then `count * dim` int8 values. */
export function parseVectors(buffer: ArrayBuffer, count: number, dim: number): VectorStore {
  const expected = count * 4 + count * dim
  if (buffer.byteLength !== expected) {
    throw new Error(`vectors.bin is ${buffer.byteLength} bytes, expected ${expected} for ${count} passages`)
  }
  return {
    count,
    dim,
    scales: new Float32Array(buffer, 0, count),
    data: new Int8Array(buffer, count * 4, count * dim),
  }
}

/** Cosine similarity of a unit-length query with every passage (their vectors are unit length before quantizing). */
export function denseScores(store: VectorStore, query: ArrayLike<number>): Float32Array {
  const scores = new Float32Array(store.count)
  for (let row = 0; row < store.count; row++) {
    let sum = 0
    const offset = row * store.dim
    for (let j = 0; j < store.dim; j++) sum += query[j]! * store.data[offset + j]!
    scores[row] = sum * store.scales[row]!
  }
  return scores
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!
  return sum
}

/** The `limit` highest scores above `floor`, best first. */
export function topScores(scores: ArrayLike<number>, limit: number, floor = -Infinity): Scored[] {
  const all: Scored[] = []
  for (let index = 0; index < scores.length; index++) {
    if (scores[index]! > floor) all.push({ index, score: scores[index]! })
  }
  return all.sort((a, b) => b.score - a.score).slice(0, limit)
}

// ── Keywords ──────────────────────────────────────────────────────────────────

const STOP_WORDS = new Set(
  'a an and are as at be been by can could do does for from get gets how i if in into is it its me my no not of on or our should so that the their them then there these they this to us use used using want was we what when where which who why will with would you your'.split(
    ' ',
  ),
)

/** Drops a plural `s`: "failures" and "failure" index the same term. */
function stem(word: string): string {
  return word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word
}

/**
 * The terms of a text: lower-case words with a plural `s` dropped and stop
 * words removed. An identifier (`PIWI_AI_PROVIDER`, `runLabel`) counts as itself
 * and as its parts, so "AI provider" finds the variable.
 */
export function searchTerms(text: string): string[] {
  const terms: string[] = []
  for (const raw of text.split(/[^\p{L}\p{N}_]+/u)) {
    if (raw.length < 2) continue
    const whole = raw.toLowerCase()
    if (!STOP_WORDS.has(whole)) terms.push(stem(whole))
    if (raw.includes('_') || /[a-z][A-Z]/.test(raw)) {
      for (const part of raw.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[\s_]+/)) {
        const lower = part.toLowerCase()
        if (lower.length >= 2 && !STOP_WORDS.has(lower)) terms.push(stem(lower))
      }
    }
  }
  return terms
}

export interface KeywordHit extends Scored {
  /** How many distinct terms of the query the passage contains. */
  matched: number
}

/** BM25 over the passages; the title and headings count three times. */
export class KeywordIndex {
  private readonly frequencies: Map<string, number>[] = []
  private readonly lengths: number[] = []
  private readonly documentFrequency = new Map<string, number>()
  private readonly averageLength: number

  constructor(passages: Passage[]) {
    for (const passage of passages) {
      const heading = [passage.title, ...passage.headings].join(' ')
      const terms = [...searchTerms(heading), ...searchTerms(heading), ...searchTerms(heading), ...searchTerms(passage.text)]
      const counts = new Map<string, number>()
      for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1)
      for (const term of counts.keys()) this.documentFrequency.set(term, (this.documentFrequency.get(term) ?? 0) + 1)
      this.frequencies.push(counts)
      this.lengths.push(terms.length)
    }
    this.averageLength = this.lengths.reduce((sum, n) => sum + n, 0) / Math.max(1, this.lengths.length)
  }

  /** The share of the query's terms that appear in no passage, from 0 to 1: a name the docs never use. */
  unknownShare(query: string): number {
    const terms = [...new Set(searchTerms(query))]
    if (!terms.length) return 0
    return terms.filter((term) => !this.documentFrequency.has(term)).length / terms.length
  }

  search(query: string, limit: number): KeywordHit[] {
    const terms = [...new Set(searchTerms(query))]
    const total = this.frequencies.length
    const hits: KeywordHit[] = []
    for (let index = 0; index < total; index++) {
      const counts = this.frequencies[index]!
      let score = 0
      let matched = 0
      for (const term of terms) {
        const frequency = counts.get(term)
        if (!frequency) continue
        matched++
        const documents = this.documentFrequency.get(term) ?? 0
        const idf = Math.log(1 + (total - documents + 0.5) / (documents + 0.5))
        const lengthNorm = 1 - 0.75 + (0.75 * this.lengths[index]!) / this.averageLength
        score += (idf * frequency * 2.2) / (frequency + 1.2 * lengthNorm)
      }
      if (matched) hits.push({ index, score, matched })
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit)
  }
}

// ── Fusion ────────────────────────────────────────────────────────────────────

/** The identifiers in a query: words such as `runLabel`, `PIWI_DASHBOARD_URL` or `CI`, as typed. */
export function identifiersIn(query: string): string[] {
  return query
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((word) => /_|[a-z][A-Z]|^[A-Z0-9]{3,}$/.test(word))
}

/**
 * True for a query that is a name rather than a question: a few words with an
 * identifier in them. Embeddings say nothing useful about a bare name, so such
 * a query is ranked by keywords alone and quotes the sentences that contain it.
 */
export function looksLikeIdentifier(query: string): boolean {
  return query.trim().split(/\s+/).length <= 3 && identifiersIn(query).length > 0
}

export interface WeightedRanking {
  hits: Scored[]
  weight: number
}

/** Reciprocal rank fusion: a passage scores `weight / (60 + rank)` in each list it appears in. */
export function fuseRankings(...lists: WeightedRanking[]): Scored[] {
  const fused = new Map<number, number>()
  for (const { hits, weight } of lists) {
    hits.forEach(({ index }, rank) => fused.set(index, (fused.get(index) ?? 0) + weight / (60 + rank + 1)))
  }
  return [...fused].map(([index, score]) => ({ index, score })).sort((a, b) => b.score - a.score)
}

/** The passages in the order the panel shows them: keywords alone for a bare name, both rankings fused otherwise. */
export function rankPassages(query: string, dense: Scored[], keyword: Scored[]): Scored[] {
  if (!dense.length || looksLikeIdentifier(query)) return keyword
  return fuseRankings({ hits: dense, weight: 1 }, { hits: keyword, weight: 1 })
}

// ── Confidence ────────────────────────────────────────────────────────────────

/** Cosine similarity from which the best passage answers the question. */
export const ANSWER_SIMILARITY = 0.66
/** Cosine similarity below which nothing in the docs is close enough to show. */
export const RELATED_SIMILARITY = 0.58
/** Between the two, the best passage answers only if the docs know most of the words asked. */
export const MAX_UNKNOWN_SHARE = 0.3

export type Confidence = 'answer' | 'related' | 'none'

/**
 * What the panel may claim. `answer` quotes sentences, `related` lists the
 * closest passages without claiming they answer, `none` says the docs have
 * nothing. A bare identifier is judged by its keyword match alone.
 */
export function assess(query: string, similarity: number, unknownShare: number, keywordMatched: number): Confidence {
  if (looksLikeIdentifier(query)) return keywordMatched ? 'answer' : 'none'
  if (similarity >= ANSWER_SIMILARITY) return 'answer'
  if (similarity < RELATED_SIMILARITY) return 'none'
  return unknownShare < MAX_UNKNOWN_SHARE ? 'answer' : 'related'
}

/** Without embeddings the panel lists passages but never claims an answer: `related` when half the query's terms match. */
export function assessKeywords(query: string, keywordMatched: number): Confidence {
  const terms = new Set(searchTerms(query)).size
  return terms && keywordMatched / terms >= 0.5 ? 'related' : 'none'
}

/** Keeps at most `perPage` passages of one page, so a long page cannot fill the list. */
export function limitPerPage(ranked: Scored[], passages: Passage[], perPage: number, limit: number): Scored[] {
  const taken = new Map<string, number>()
  const kept: Scored[] = []
  for (const item of ranked) {
    const page = passages[item.index]!.page
    const count = taken.get(page) ?? 0
    if (count >= perPage) continue
    taken.set(page, count + 1)
    kept.push(item)
    if (kept.length >= limit) break
  }
  return kept
}

// ── Sentences ─────────────────────────────────────────────────────────────────

const ABBREVIATION = /(?:^|\s)(?:e\.g|i\.e|etc|vs|approx|incl)\.$/i

/** Split a paragraph at sentence ends: `.`, `!` or `?`, then a space and a capital, digit, quote or bracket. */
export function splitSentences(paragraph: string): string[] {
  const sentences: string[] = []
  let start = 0
  const end = /[.!?]\s+(?=[A-Z0-9"'(\[])/g
  for (let match = end.exec(paragraph); match; match = end.exec(paragraph)) {
    const stop = match.index + 1
    if (ABBREVIATION.test(paragraph.slice(start, stop))) continue
    sentences.push(paragraph.slice(start, stop).trim())
    start = match.index + match[0].length
  }
  const rest = paragraph.slice(start).trim()
  if (rest) sentences.push(rest)
  return sentences
}

const SENTENCE_MIN = 30
const SENTENCE_MAX = 380

/**
 * The sentences of a passage a reader could quote as an answer: prose and list
 * items, not code, table rows or headings. Each bullet is one sentence.
 */
export function candidateSentences(text: string): string[] {
  const out: string[] = []
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split('\n')
    if (/^\s*(`{3}|~{3}|\||#)/.test(lines[0]!)) continue
    const bullets = lines.every((line) => /^\s*(?:-|\d+\.)\s/.test(line))
    const paragraphs = bullets ? lines.map((line) => line.replace(/^\s*(?:-|\d+\.)\s+/, '')) : [lines.join(' ')]
    for (const paragraph of paragraphs) {
      for (const sentence of splitSentences(paragraph.replace(/\s+/g, ' ').trim())) {
        if (sentence.length >= SENTENCE_MIN && sentence.length <= SENTENCE_MAX && sentence.split(' ').length >= 5) {
          out.push(sentence)
        }
      }
    }
  }
  return out
}

/** Cosine similarity a sentence needs to be quoted as part of an answer. */
export const SENTENCE_FLOOR = 0.6
/** A quoted sentence is within this similarity of the best one. */
export const SENTENCE_WINDOW = 0.06
export const MAX_ANSWER_SENTENCES = 3

export interface ScoredSentence {
  text: string
  /** Rank of the passage the sentence comes from, 0 for the best passage. */
  passage: number
  /** Position of the sentence within its passage. */
  order: number
  score: number
}

function sameWords(a: string, b: string): boolean {
  const left = new Set(searchTerms(a))
  const right = new Set(searchTerms(b))
  const shared = [...left].filter((term) => right.has(term)).length
  return shared / Math.max(1, Math.min(left.size, right.size)) > 0.8
}

/**
 * The sentences to quote: those at or above `floor` and within `window` of the
 * best score, at most three, without near repeats, in reading order (best
 * passage first, then position in the passage).
 */
export function selectAnswer(
  sentences: ScoredSentence[],
  floor = SENTENCE_FLOOR,
  window = SENTENCE_WINDOW,
): ScoredSentence[] {
  const byScore = [...sentences].sort((a, b) => b.score - a.score)
  const best = byScore[0]?.score ?? 0
  const chosen: ScoredSentence[] = []
  for (const sentence of byScore) {
    if (sentence.score < floor || sentence.score < best - window) break
    if (chosen.some((other) => sameWords(other.text, sentence.text))) continue
    chosen.push(sentence)
    if (chosen.length >= MAX_ANSWER_SENTENCES) break
  }
  return chosen.sort((a, b) => a.passage - b.passage || a.order - b.order)
}

/** 1 when the sentence contains one of the identifiers, else 0; the identifier match is case-insensitive. */
export function mentionsIdentifier(sentence: string, identifiers: string[]): number {
  const lower = sentence.toLowerCase()
  return identifiers.some((identifier) => lower.includes(identifier.toLowerCase())) ? 1 : 0
}

/** How much of the query's vocabulary a sentence uses, from 0 to 1. */
export function keywordCoverage(sentence: string, queryTerms: string[]): number {
  if (!queryTerms.length) return 0
  const own = new Set(searchTerms(sentence))
  return queryTerms.filter((term) => own.has(term)).length / queryTerms.length
}

/**
 * A short excerpt of a passage for the source list: the sentences that use the
 * most query terms, else the passage's opening. Never code or a table row.
 */
export function excerpt(text: string, query: string, max = 260): string {
  const sentences = candidateSentences(text)
  const terms = [...new Set(searchTerms(query))]
  const best = sentences
    .map((sentence, order) => ({ sentence, order, coverage: keywordCoverage(sentence, terms) }))
    .sort((a, b) => b.coverage - a.coverage || a.order - b.order)[0]
  const chosen = best && best.coverage > 0 ? best.sentence : (sentences[0] ?? text.replace(/\s+/g, ' ').trim())
  return chosen.length <= max ? chosen : `${chosen.slice(0, max).replace(/\s+\S*$/, '')}…`
}
