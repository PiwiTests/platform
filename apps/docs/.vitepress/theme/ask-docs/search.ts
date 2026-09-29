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
  /** The passage as Markdown, the way the docs page writes it. */
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
  /** File name of the vectors, next to index.json. */
  vectors: string
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
      const terms = [...searchTerms(heading), ...searchTerms(heading), ...searchTerms(heading), ...searchTerms(toPlain(passage.text))]
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

/**
 * The passages the panel lists, best first: at most `perPage` of one page so a
 * long page cannot fill the list, and for a bare name only the passages that
 * contain it when there are any.
 */
export function pickSources(query: string, ranked: Scored[], passages: Passage[], perPage = 2, limit = 5): Scored[] {
  const identifiers = identifiersIn(query)
  const exact = looksLikeIdentifier(query)
    ? ranked.filter(({ index }) => mentionsIdentifier(passages[index]!.text, identifiers))
    : []
  return limitPerPage(exact.length ? exact : ranked, passages, perPage, limit)
}

/** Keeps at most `perPage` passages of one page. */
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

// ── Markdown ──────────────────────────────────────────────────────────────────

const FENCE = /^\s*(`{3,}|~{3,})/
const TABLE_RULE = /^[\s|:-]+$/
const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/

const isTableRule = (line: string) => TABLE_RULE.test(line) && line.includes('--')

function plainLine(line: string): string {
  let text = line.replace(/^\s*>\s?/, '').replace(/^(\s*)#{1,6}\s+/, '$1')
  if (isTableRule(text)) return ''
  if (/^\s*\|.*\|\s*$/.test(text)) {
    text = text
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => cell.trim())
      .join(' | ')
  }
  const spans: string[] = []
  text = text
    .replace(/`([^`]*)`/g, (_match, span: string) => `\uE000${spans.push(span) - 1}\uE001`)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<\/?(?:code|span|kbd|strong|em|b|i|a)\b[^>]*>/gi, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*)[*_](?=[\s).,;:!?]|$)/g, '$1$2')
  return text.replace(/\uE000(\d+)\uE001/g, (_match, at: string) => spans[Number(at)] ?? '').replace(/\s+$/, '')
}

/**
 * Markdown reduced to the words a reader sees: links keep their text, code
 * spans their content, and emphasis, quote and heading markers go. Code fences
 * stay as written. This is the text that is embedded, keyword-indexed and split
 * into sentences.
 */
export function toPlain(markdown: string): string {
  const out: string[] = []
  let fence: string | null = null
  for (const line of markdown.split('\n')) {
    const marker = line.match(FENCE)?.[1]
    if (fence) {
      out.push(line)
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null
    } else if (marker) {
      fence = marker
      out.push(line)
    } else out.push(plainLine(line))
  }
  return out.join('\n')
}

export type BlockKind = 'paragraph' | 'list' | 'table' | 'code' | 'quote'

export interface Block {
  kind: BlockKind
  /** The block as Markdown, as the docs write it. */
  markdown: string
  /** What can be quoted from it: the sentences of a paragraph, the items of a list, the rows of a table; none for code. */
  sentences: string[]
}

function kindOf(line: string): BlockKind {
  if (FENCE.test(line)) return 'code'
  if (/^\s*\|/.test(line)) return 'table'
  if (/^\s*>/.test(line)) return 'quote'
  if (LIST_ITEM.test(line)) return 'list'
  return 'paragraph'
}

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

const PROSE_MIN = 30
const ITEM_MIN = 20
const SENTENCE_MAX = 380

const wordCount = (text: string) => text.split(' ').length

function sentencesOf(kind: BlockKind, lines: string[]): string[] {
  if (kind === 'code') return []
  if (kind === 'table') {
    const rows = lines[1] !== undefined && isTableRule(lines[1]) ? lines.slice(2) : lines
    return rows
      .map((row) => toPlain(row).replace(/\s+/g, ' ').replace(/ \| /g, ' – ').trim())
      .filter((row) => row.length >= ITEM_MIN && row.length <= SENTENCE_MAX && wordCount(row) >= 3)
  }
  if (kind === 'list') {
    const items: string[] = []
    for (const line of lines) {
      const item = line.match(LIST_ITEM)
      if (item) items.push(item[2]!)
      else if (items.length) items[items.length - 1] += ` ${line.trim()}`
    }
    return items
      .map((item) => toPlain(item).replace(/\s+/g, ' ').trim())
      .filter((item) => item.length >= ITEM_MIN && item.length <= SENTENCE_MAX && wordCount(item) >= 3)
  }
  return splitSentences(toPlain(lines.join('\n')).replace(/\s+/g, ' ').trim()).filter(
    (sentence) => sentence.length >= PROSE_MIN && sentence.length <= SENTENCE_MAX && wordCount(sentence) >= 5,
  )
}

/**
 * The blocks of a passage's Markdown, in order: paragraphs, lists, tables,
 * quotations and code fences. A heading is not a block; it names the passage.
 */
export function splitBlocks(markdown: string): Block[] {
  const found: Array<{ kind: BlockKind; lines: string[] }> = []
  let current: { kind: BlockKind; lines: string[] } | null = null
  let fence: string | null = null
  const flush = () => {
    if (current?.lines.length) found.push(current)
    current = null
  }
  for (const line of markdown.split('\n')) {
    const marker = line.match(FENCE)?.[1]
    if (fence) {
      current!.lines.push(line)
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) {
        fence = null
        flush()
      }
      continue
    }
    if (marker) {
      flush()
      fence = marker
      current = { kind: 'code', lines: [line] }
      continue
    }
    if (!line.trim() || /^\s*#{1,6}\s/.test(line)) {
      flush()
      continue
    }
    const kind = kindOf(line)
    if (current) {
      const continues =
        current.kind === 'list' || current.kind === 'quote' ? kind === current.kind || kind === 'paragraph' : kind === current.kind
      if (continues) {
        current.lines.push(line)
        continue
      }
      flush()
    }
    current = { kind, lines: [line] }
  }
  flush()
  return found.map(({ kind, lines }) => ({ kind, markdown: lines.join('\n'), sentences: sentencesOf(kind, lines) }))
}

/**
 * The sentences of a passage a reader could quote as an answer: prose, list
 * items and, unless `rows` is false, table rows. Never code or headings.
 */
export function candidateSentences(markdown: string, { rows = true } = {}): string[] {
  return splitBlocks(markdown).flatMap((block) => (block.kind === 'table' && !rows ? [] : block.sentences))
}

/** Cut a block to about `max` characters at a line break, keeping a table's header and a code sample's closing fence. */
export function clipBlock(block: Block, max: number): { markdown: string; clipped: boolean } {
  if (block.markdown.length <= max) return { markdown: block.markdown, clipped: false }
  const lines = block.markdown.split('\n')
  if (lines.length === 1) return { markdown: `${block.markdown.slice(0, max).replace(/\s+\S*$/, '')}…`, clipped: true }
  const fence = block.kind === 'code' ? lines[0]!.match(FENCE)?.[1] : undefined
  const keep = block.kind === 'table' ? 3 : 1
  const kept: string[] = []
  let size = 0
  for (const line of lines) {
    if (kept.length >= keep && size + line.length + 1 + (fence?.length ?? 0) > max) break
    kept.push(line.slice(0, max))
    size += line.length + 1
  }
  if (fence && !(kept.length > 1 && FENCE.test(kept[kept.length - 1]!))) kept.push(fence)
  return { markdown: kept.join('\n'), clipped: kept.length < lines.length }
}

// ── Answer blocks ─────────────────────────────────────────────────────────────

/** Cosine similarity a block's best sentence needs for the block to be quoted. */
export const BLOCK_FLOOR = 0.6
/** A quoted block scores within this similarity of the best one. */
export const BLOCK_WINDOW = 0.06
export const MAX_ANSWER_BLOCKS = 3
/** Characters of Markdown quoted in all, past the best block. */
export const ANSWER_BUDGET = 1600

export interface ScoredBlock {
  block: Block
  /** Rank of the passage the block comes from, 0 for the best passage. */
  passage: number
  /** Position of the block within its passage. */
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
 * The blocks to quote: those at or above `floor` and within `window` of the
 * best score, without near repeats, at most three and about `budget`
 * characters (the best block always stays), in reading order: best passage
 * first, then position in the passage.
 */
export function selectBlocks(
  blocks: ScoredBlock[],
  floor = BLOCK_FLOOR,
  window = BLOCK_WINDOW,
  budget = ANSWER_BUDGET,
): ScoredBlock[] {
  const byScore = [...blocks].sort((a, b) => b.score - a.score)
  const best = byScore[0]?.score ?? 0
  const chosen: ScoredBlock[] = []
  let size = 0
  for (const item of byScore) {
    if (item.score < floor || item.score < best - window) break
    const plain = toPlain(item.block.markdown)
    if (chosen.some((other) => sameWords(toPlain(other.block.markdown), plain))) continue
    if (chosen.length && size + item.block.markdown.length > budget) continue
    chosen.push(item)
    size += item.block.markdown.length
    if (chosen.length >= MAX_ANSWER_BLOCKS) break
  }
  return chosen.sort((a, b) => a.passage - b.passage || a.order - b.order)
}

/** A chosen paragraph that ends with a colon introduces the block after it (a list, a table, a command); that block joins the answer. */
export function addIntroduced(chosen: ScoredBlock[], passages: Block[][]): ScoredBlock[] {
  const out = [...chosen]
  for (const item of chosen) {
    if (item.block.kind !== 'paragraph' || !/:\s*$/.test(item.block.markdown)) continue
    const next = passages[item.passage]?.[item.order + 1]
    const taken = out.some((other) => other.passage === item.passage && other.order === item.order + 1)
    if (next && next.kind !== 'paragraph' && !taken) {
      out.push({ block: next, passage: item.passage, order: item.order + 1, score: item.score })
    }
  }
  return out.sort((a, b) => a.passage - b.passage || a.order - b.order)
}

/** Embeds texts and returns their unit-length vectors one after another (`texts.length * dim` numbers). */
export type EmbedTexts = (texts: string[]) => Promise<ArrayLike<number>>

export interface QuotedBlock {
  markdown: string
  /** Position, among the passages given, of the passage the block comes from. */
  source: number
  /** True when the block was cut to fit. */
  clipped: boolean
}

/** Sentences of one block that are scored; a long table is judged by its first rows. */
const SCORED_PER_BLOCK = 40
/** Characters of one quoted block before it is cut. */
export const BLOCK_MAX_CHARS = 1200

/**
 * The blocks of the best passages that answer the question, as the docs write
 * them. A block scores as its best sentence does, by embedding similarity; for
 * a bare name a block scores by containing it.
 */
export async function quoteBlocks(
  query: string,
  queryVector: ArrayLike<number>,
  passages: string[],
  embedTexts: EmbedTexts,
  dim: number,
): Promise<QuotedBlock[]> {
  const blocks = passages.map((markdown) => splitBlocks(markdown))
  const items = blocks.flatMap((list, passage) => list.map((block, order) => ({ block, passage, order })))
  if (!items.length) return []

  let chosen: ScoredBlock[]
  if (looksLikeIdentifier(query)) {
    const identifiers = identifiersIn(query)
    chosen = selectBlocks(
      items.map((item) => ({ ...item, score: mentionsIdentifier(item.block.markdown, identifiers) })),
      0.9,
      0.1,
    )
  } else {
    const sentences = items.flatMap((item, at) => item.block.sentences.slice(0, SCORED_PER_BLOCK).map((text) => ({ at, text })))
    if (!sentences.length) return []
    const vectors = await embedTexts(sentences.map((sentence) => sentence.text))
    const best = new Map<number, number>()
    sentences.forEach(({ at }, k) => {
      let score = 0
      for (let j = 0; j < dim; j++) score += queryVector[j]! * vectors[k * dim + j]!
      best.set(at, Math.max(best.get(at) ?? -1, score))
    })
    chosen = selectBlocks(items.map((item, at) => ({ ...item, score: best.get(at) ?? -1 })))
  }
  return addIntroduced(chosen, blocks).map(({ block, passage }) => ({
    ...clipBlock(block, BLOCK_MAX_CHARS),
    source: passage,
  }))
}

/** 1 when the text contains one of the identifiers, else 0; the identifier match is case-insensitive. */
export function mentionsIdentifier(text: string, identifiers: string[]): number {
  const lower = text.toLowerCase()
  return identifiers.some((identifier) => lower.includes(identifier.toLowerCase())) ? 1 : 0
}

/** How much of the query's vocabulary a sentence uses, from 0 to 1. */
export function keywordCoverage(sentence: string, queryTerms: string[]): number {
  if (!queryTerms.length) return 0
  const own = new Set(searchTerms(sentence))
  return queryTerms.filter((term) => own.has(term)).length / queryTerms.length
}

/**
 * A short excerpt of a passage for the source list: the sentence that uses the
 * most query terms, else the passage's opening. Never code or a table row.
 */
export function excerpt(markdown: string, query: string, max = 260): string {
  const sentences = candidateSentences(markdown, { rows: false })
  const terms = [...new Set(searchTerms(query))]
  const best = sentences
    .map((sentence, order) => ({ sentence, order, coverage: keywordCoverage(sentence, terms) }))
    .sort((a, b) => b.coverage - a.coverage || a.order - b.order)[0]
  const chosen = best && best.coverage > 0 ? best.sentence : (sentences[0] ?? toPlain(markdown).replace(/\s+/g, ' ').trim())
  return chosen.length <= max ? chosen : `${chosen.slice(0, max).replace(/\s+\S*$/, '')}…`
}
