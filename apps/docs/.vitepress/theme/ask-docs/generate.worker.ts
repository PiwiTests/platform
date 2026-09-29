/// <reference lib="webworker" />
/**
 * The generation worker of the "Ask the docs" panel: it downloads a small
 * language model from Hugging Face, after the reader agrees, and writes an
 * answer from the passages the search found, streaming it as Markdown.
 *
 * The model runs in the browser through transformers.js, on the GPU through
 * WebGPU only. The question and the passages never leave the page; the model's
 * files are kept in a Cache Storage of their own (`GENERATION_CACHE`), so the
 * panel can remove them.
 */
import { AutoModelForCausalLM, AutoTokenizer, InterruptableStoppingCriteria, TextStreamer, env } from '@huggingface/transformers'
import { GENERATION_CACHE } from './generation-models'
import type { GenerationMessage, GenerationRequest } from './protocol'

declare const __ASK_DOCS_MODEL_HOST__: string

const scope = self as unknown as DedicatedWorkerGlobalScope
const post = (message: GenerationMessage) => scope.postMessage(message)

interface Probe {
  model: string
  dtype: 'q4f16' | 'q4'
}

let probe: Probe | null = null
let tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>> | null = null
let model: Awaited<ReturnType<typeof AutoModelForCausalLM.from_pretrained>> | null = null
let stopping = new InterruptableStoppingCriteria()
let loading = false

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The precision this GPU runs, or null without a GPU: 16-bit floats run the smallest files, otherwise the larger `q4` file. */
async function chooseDtype(): Promise<Probe['dtype'] | null> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu
    const adapter = await gpu?.requestAdapter()
    return adapter ? (adapter.features.has('shader-f16') ? 'q4f16' : 'q4') : null
  } catch {
    return null
  }
}

async function isCached(model: string, file: string): Promise<boolean> {
  try {
    const keys = await (await caches.open(GENERATION_CACHE)).keys()
    return keys.some((request) => request.url.includes(`/${model}/`) && request.url.endsWith(file))
  } catch {
    return false
  }
}

async function load(): Promise<void> {
  if (!probe || model || loading) return
  loading = true
  try {
    env.allowLocalModels = false
    env.allowRemoteModels = true
    env.remoteHost = __ASK_DOCS_MODEL_HOST__
    env.useBrowserCache = true
    env.cacheKey = GENERATION_CACHE
    const files = new Map<string, { loaded: number; total: number }>()
    const progress_callback = (event: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (event.status !== 'progress' || !event.file) return
      files.set(event.file, { loaded: event.loaded ?? 0, total: event.total ?? 0 })
      let loaded = 0
      let total = 0
      for (const file of files.values()) {
        loaded += file.loaded
        total += file.total
      }
      post({ type: 'progress', loaded, total })
    }
    tokenizer = await AutoTokenizer.from_pretrained(probe.model, { progress_callback })
    model = await AutoModelForCausalLM.from_pretrained(probe.model, {
      dtype: probe.dtype,
      device: 'webgpu',
      progress_callback,
    })
    post({ type: 'ready' })
  } catch (error) {
    tokenizer = null
    model = null
    post({ type: 'error', id: null, message: errorMessage(error) })
  } finally {
    loading = false
  }
}

async function write(id: number, request: Extract<GenerationRequest, { type: 'write' }>): Promise<void> {
  if (!model || !tokenizer) throw new Error('the model is not loaded')
  const started = performance.now()
  // `enable_thinking` is a variable of the chat template of models that can reason before they answer.
  const template = { add_generation_prompt: true, return_dict: true, enable_thinking: false }
  const inputs = tokenizer.apply_chat_template(request.messages, template) as Record<string, unknown>
  stopping = new InterruptableStoppingCriteria()
  let text = ''
  let tokens = 0
  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (chunk: string) => {
      text += chunk
      post({ type: 'text', id, text })
    },
    token_callback_function: () => {
      tokens++
    },
  })
  await model.generate({
    ...inputs,
    max_new_tokens: request.maxNewTokens,
    do_sample: false,
    repetition_penalty: 1.1,
    streamer,
    stopping_criteria: stopping,
  })
  post({ type: 'done', id, text, tokens, ms: Math.round(performance.now() - started) })
}

scope.onmessage = (event: MessageEvent<GenerationRequest>) => {
  const request = event.data
  if (request.type === 'probe') {
    void chooseDtype().then(async (dtype) => {
      if (!dtype) return post({ type: 'device', supported: false, dtype: 'q4', cached: false })
      probe = { model: request.model, dtype }
      post({ type: 'device', supported: true, dtype, cached: await isCached(request.model, request.files[dtype]) })
    })
  } else if (request.type === 'load') {
    void load()
  } else if (request.type === 'write') {
    write(request.id, request).catch((error: unknown) => post({ type: 'error', id: request.id, message: errorMessage(error) }))
  } else if (request.type === 'stop') {
    stopping.interrupt()
  }
}
