import type { ChatMessage } from './prompt'
import type { Confidence } from './search'

/** Messages the "Ask the docs" panel sends to its search worker. */
export type WorkerRequest =
  | { type: 'init'; base: string; loadModel: boolean }
  | { type: 'load-model' }
  | { type: 'ask'; id: number; query: string }

/** A passage cited under an answer, and the context a model can write an answer from. */
export interface Source {
  page: string
  anchor: string
  title: string
  headings: string[]
  excerpt: string
  /** The passage as Markdown. */
  markdown: string
}

/** A block of the docs quoted as the answer, as Markdown, and the position, in `sources`, of the passage it comes from. */
export interface AnswerBlock {
  markdown: string
  source: number
  /** True when the block was cut to fit; the source has the rest. */
  clipped: boolean
}

/** Messages the search worker sends back. */
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
      answer: AnswerBlock[]
      sources: Source[]
      ms: number
    }
  | { type: 'error'; id: number; message: string }

/** Messages the panel sends to the generation worker, which writes an answer with a local model. */
export type GenerationRequest =
  | { type: 'probe'; model: string; files: { q4f16: string; q4: string } }
  | { type: 'load' }
  | { type: 'write'; id: number; messages: ChatMessage[]; maxNewTokens: number }
  | { type: 'stop' }

/** Messages the generation worker sends back. */
export type GenerationMessage =
  | {
      type: 'device'
      /** False when the browser has no usable GPU: the model runs on the GPU only, the CPU is far too slow. */
      supported: boolean
      /** `q4f16` needs a GPU with 16-bit floats; `q4` runs on any GPU but is larger. */
      dtype: 'q4f16' | 'q4'
      /** True when the model's files are already in this browser. */
      cached: boolean
    }
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready' }
  | { type: 'text'; id: number; text: string }
  | { type: 'done'; id: number; text: string; tokens: number; ms: number }
  | { type: 'error'; id: number | null; message: string }
