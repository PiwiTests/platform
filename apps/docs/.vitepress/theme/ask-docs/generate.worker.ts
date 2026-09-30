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
import { downloadInParts } from './download'
import { GENERATION_CACHE, explainError } from './generation-models'
import { dataFileName, splitWeights } from './split-weights'
import type { GenerationMessage, GenerationRequest } from './protocol'

declare const __ASK_DOCS_MODEL_HOST__: string

const scope = self as unknown as DedicatedWorkerGlobalScope
const post = (message: GenerationMessage) => scope.postMessage(message)

interface Probe {
  model: string
  dtype: 'q4f16' | 'q4'
  /** Name of the model file for that precision. */
  file: string
}

let probe: Probe | null = null
let tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>> | null = null
let model: Awaited<ReturnType<typeof AutoModelForCausalLM.from_pretrained>> | null = null
let stopping = new InterruptableStoppingCriteria()
let loading = false

const errorMessage = (error: unknown) => explainError(error instanceof Error ? error.message : String(error))

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

/**
 * Files the browser would not store: a private window, or a full disk, refuses
 * large ones. They are served from memory for as long as this worker lives, so
 * the model still loads, as prepared below, without a second download.
 */
const unstored = new Map<string, Blob>()

/**
 * The cache transformers.js reads the model's files from: the Cache Storage of
 * the panel (`GENERATION_CACHE`), and `unstored` for what it refused.
 */
const modelCache = {
  async match(request: string): Promise<Response | undefined> {
    const kept = unstored.get(request)
    if (kept) return new Response(kept, { headers: { 'Content-Length': String(kept.size) } })
    try {
      return await (await caches.open(GENERATION_CACHE)).match(request)
    } catch {
      return undefined
    }
  },
  async put(request: string, response: Response): Promise<void> {
    const blob = await response.blob()
    try {
      const headers = { 'Content-Length': String(blob.size), 'Content-Type': 'application/octet-stream' }
      await (await caches.open(GENERATION_CACHE)).put(request, new Response(blob, { headers }))
      unstored.delete(request)
    } catch {
      unstored.set(request, blob)
    }
  },
}

const keep = (request: string, content: Blob | Uint8Array) => modelCache.put(request, new Response(content as BodyInit))

/**
 * Put the model in the cache under the addresses transformers.js reads it from,
 * with its weights moved to data files of their own (see split-weights.ts), so
 * that loading it does not copy the whole file into the memory of
 * onnxruntime-web. The file is downloaded on several connections: one carries a
 * fraction of what the host can send. A whole file already in the cache, kept
 * by an earlier version of the panel or by transformers.js, is split in place.
 *
 * Returns how many data files hold the weights (0 when the model stays as the
 * host serves it), or null when the host cannot serve ranges or a part keeps
 * failing: transformers.js then downloads the file itself.
 */
async function prefetch(url: string): Promise<number | null> {
  try {
    const folder = url.slice(0, url.lastIndexOf('/') + 1)
    const first = url.slice(folder.length) + '_data'
    const dataUrl = (index: number) => folder + dataFileName(first, index)

    const stored = await modelCache.match(url)
    if (stored) {
      let files = 0
      while (await modelCache.match(dataUrl(files))) files++
      if (files) return files
    }
    const blob = stored
      ? await stored.blob()
      : await downloadInParts(url, { onProgress: (loaded, total) => post({ type: 'progress', loaded, total }) })
    if (!blob) return null

    const split = await splitWeights(blob, first).catch(() => null)
    if (!split) {
      if (!stored) await keep(url, blob)
      return 0
    }
    for (const [index, file] of split.files.entries()) await keep(dataUrl(index), file)
    // The graph goes last, over the whole file when there was one: its presence says the model is complete.
    await keep(url, split.graph)
    return split.files.length
  } catch {
    return null
  }
}

async function load(): Promise<void> {
  if (!probe || model || loading) return
  loading = true
  try {
    env.allowLocalModels = false
    env.allowRemoteModels = true
    env.remoteHost = __ASK_DOCS_MODEL_HOST__
    env.useCustomCache = true
    env.customCache = modelCache
    const dataFiles = await prefetch(`${__ASK_DOCS_MODEL_HOST__}${probe.model}/resolve/main/onnx/${probe.file}`)

    const files = new Map<string, { loaded: number; total: number }>()
    const progress_callback = (event: { status: string; file?: string; loaded?: number; total?: number }) => {
      // The file is already counted when it was downloaded above.
      if (dataFiles !== null || event.status !== 'progress' || !event.file) return
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
      // The data files next to the graph, which `prefetch` wrote: how many there are.
      use_external_data_format: dataFiles ?? false,
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
      probe = { model: request.model, dtype, file: request.files[dtype] }
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
