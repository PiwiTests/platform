import type { Confidence } from './search'

/** Messages the "Ask the docs" panel sends to its worker. */
export type WorkerRequest =
  | { type: 'init'; base: string; loadModel: boolean }
  | { type: 'load-model' }
  | { type: 'ask'; id: number; query: string }

/** A passage cited under an answer. */
export interface Source {
  page: string
  anchor: string
  title: string
  headings: string[]
  excerpt: string
}

/** One quoted sentence and the position, in `sources`, of the passage it comes from. */
export interface AnswerLine {
  text: string
  source: number
}

/** Messages the worker sends back. */
export type WorkerMessage =
  | { type: 'index-ready'; passages: number; downloadBytes: number }
  | { type: 'index-error'; message: string }
  | { type: 'model-progress'; loaded: number; total: number }
  | { type: 'model-ready' }
  | { type: 'model-error'; message: string }
  | {
      type: 'result'
      id: number
      /** `keyword` while the embedding model is not loaded, `hybrid` once it ranks too. */
      mode: 'keyword' | 'hybrid'
      confidence: Confidence
      answer: AnswerLine[]
      sources: Source[]
      ms: number
    }
  | { type: 'error'; id: number; message: string }
