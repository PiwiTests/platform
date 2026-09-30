/**
 * The models the panel can write an answer with, smallest download first. Each
 * is an ONNX export on Hugging Face that transformers.js runs in the browser.
 * `q4f16` is the file for a GPU with 16-bit floats, `q4` the larger one for
 * every other device; `bytes` is the size of that file.
 */
export interface GenerationModel {
  /** Hugging Face repository. */
  id: string
  /** The name shown to the reader. */
  label: string
  /** One sentence on what to expect of it, shown next to its size. */
  note: string
  files: { q4f16: string; q4: string }
  bytes: { q4f16: number; q4: number }
}

export const GENERATION_MODELS: GenerationModel[] = [
  {
    id: 'onnx-community/Qwen3-0.6B-ONNX',
    label: 'Qwen3 0.6B',
    note: 'Quicker to download and to answer. It sticks to the passages but often answers a question the docs do not cover.',
    files: { q4f16: 'model_q4f16.onnx', q4: 'model_q4.onnx' },
    bytes: { q4f16: 569_789_750, q4: 919_096_585 },
  },
  {
    id: 'onnx-community/Qwen3-1.7B-ONNX',
    label: 'Qwen3 1.7B',
    note: 'A larger download. Writes fuller lists and declines a question the docs do not cover.',
    files: { q4f16: 'model_q4f16.onnx', q4: 'model_q4.onnx' },
    bytes: { q4f16: 1_426_069_098, q4: 2_147_212_861 },
  },
]

/** Passages of the search results that are given to the model. */
export const CONTEXT_PASSAGES = 3
/** Longest answer the model writes, in tokens. */
export const MAX_NEW_TOKENS = 350

/** The Cache Storage that holds the model's files, so the panel can delete them. */
export const GENERATION_CACHE = 'ask-docs-generation'

/** What to tell the reader about an error that loading or running a model raised: the runtime's words for running out of memory mean little to them, so they come after an explanation. */
export function explainError(message: string): string {
  if (/bad_alloc|out of memory|memory access out of bounds|allocation failed/i.test(message)) {
    return `this browser could not give the model enough memory: ${message}`
  }
  return message
}
