/**
 * The panel's side of the generation worker: asks the reader's agreement before
 * anything is downloaded, follows the download, sends the passages and the
 * question, and keeps the answer as it is written. The state is plain Vue refs
 * for the component to show.
 */
import { computed, ref, shallowRef } from 'vue'
import { CONTEXT_PASSAGES, GENERATION_CACHE, GENERATION_MODELS, MAX_NEW_TOKENS, type GenerationModel } from './generation-models'
import type { GenerationMessage, GenerationRequest, Source } from './protocol'
import { buildMessages, checkGrounding, linkCitations, normalizeCitations, readAnswer, type Grounding } from './prompt'

const CONSENT_KEY = 'ask-docs:generation'

export type GenerationPhase = 'off' | 'probing' | 'unsupported' | 'asking' | 'downloading' | 'ready' | 'writing' | 'error'

export interface WrittenAnswer {
  markdown: string
  /** False when the model said the passages do not answer the question. */
  covered: boolean
  grounding: Grounding | null
  ms: number
  tokens: number
}

const remembered = () => {
  try {
    return localStorage.getItem(CONSENT_KEY)
  } catch {
    return null
  }
}
const remember = (id: string | null) => {
  try {
    if (id) localStorage.setItem(CONSENT_KEY, id)
    else localStorage.removeItem(CONSENT_KEY)
  } catch {
    // Without storage the reader is asked again next time.
  }
}

export function useGeneration(hrefOf: (source: Source) => string) {
  const phase = ref<GenerationPhase>('off')
  // A catalog entry is sent to the worker: it must not become a reactive proxy, which cannot be cloned.
  // The model the reader agreed to last time, so the choice is not asked again after a reload.
  const model = shallowRef<GenerationModel>(GENERATION_MODELS.find((candidate) => candidate.id === remembered()) ?? GENERATION_MODELS[0]!)
  const device = ref<{ dtype: 'q4f16' | 'q4'; cached: boolean } | null>(null)
  const progress = ref({ loaded: 0, total: 0 })
  const message = ref('')
  /** What the model has written so far, as it wrote it. */
  const text = ref('')
  const written = ref<WrittenAnswer | null>(null)

  let worker: Worker | null = null
  let requestId = 0
  /** The write the worker is running, 0 when none. */
  let active = 0
  /** The running write belongs to a question that is gone: its text is ignored and the worker is stopped. */
  let abandoned = false
  let wanted: { question: string; sources: Source[] } | null = null

  /** Bytes to download for the chosen model on this device. */
  const size = computed(() => (device.value ? model.value.bytes[device.value.dtype] : model.value.bytes.q4f16))
  const context = () => (wanted?.sources ?? []).slice(0, CONTEXT_PASSAGES)

  /** The answer as Markdown to show: citations link to their passage; a refusal shows nothing. */
  const markdown = computed(() => {
    const reply = readAnswer(text.value)
    const hrefs = context().map(hrefOf)
    return reply.covered ? linkCitations(normalizeCitations(reply.markdown), hrefs) : ''
  })

  function post(request: GenerationRequest) {
    worker?.postMessage(request)
  }

  function send() {
    if (!wanted) return
    const messages = buildMessages(
      wanted.question,
      context().map(({ title, headings, markdown: passage }) => ({ title, headings, markdown: passage })),
    )
    phase.value = 'writing'
    text.value = ''
    written.value = null
    abandoned = false
    active = ++requestId
    post({ type: 'write', id: active, messages, maxNewTokens: MAX_NEW_TOKENS })
  }

  function accept() {
    remember(model.value.id)
    phase.value = 'downloading'
    progress.value = { loaded: 0, total: 0 }
    post({ type: 'load' })
  }

  function onMessage({ data }: MessageEvent<GenerationMessage>) {
    if (data.type === 'device') {
      device.value = { dtype: data.dtype, cached: data.cached }
      if (!data.supported) phase.value = 'unsupported'
      else if (data.cached || remembered() === model.value.id) accept()
      else phase.value = 'asking'
    } else if (data.type === 'progress') {
      progress.value = { loaded: data.loaded, total: data.total }
    } else if (data.type === 'ready') {
      phase.value = 'ready'
      send()
    } else if (data.type === 'text' && data.id === active) {
      if (!abandoned) text.value = data.text
    } else if (data.type === 'done' && data.id === active) {
      active = 0
      phase.value = 'ready'
      if (abandoned) {
        // The question changed while this answer was written: write the one that was asked since, if any.
        abandoned = false
        if (wanted) send()
        return
      }
      const reply = readAnswer(data.text)
      written.value = {
        markdown: reply.markdown,
        covered: reply.covered,
        grounding: reply.covered
          ? checkGrounding(
              reply.markdown,
              context().map((source) => source.markdown),
            )
          : null,
        ms: data.ms,
        tokens: data.tokens,
      }
    } else if (data.type === 'error') {
      active = 0
      abandoned = false
      message.value = data.message
      phase.value = 'error'
    }
  }

  function probe(silent = false) {
    if (!silent) phase.value = 'probing'
    post({ type: 'probe', model: model.value.id, files: model.value.files })
  }

  /** Write an answer to `question` from the passages the search found; asks the reader first when a download is needed. */
  function write(question: string, sources: Source[]) {
    wanted = { question, sources }
    text.value = ''
    written.value = null
    if (phase.value === 'ready') return send()
    if (phase.value === 'writing') {
      // An earlier answer is still being written: it is stopped, and this one starts when it has.
      abandoned = true
      return stop()
    }
    if (phase.value === 'downloading') return
    if (!worker) {
      worker = new Worker(new URL('./generate.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = onMessage
    }
    probe()
  }

  /** Pick another model while the reader is deciding; whether its files are already here is asked again. */
  function choose(id: string) {
    model.value = GENERATION_MODELS.find((candidate) => candidate.id === id) ?? model.value
    if (phase.value === 'asking') probe(true)
  }

  function stop() {
    post({ type: 'stop' })
  }

  /** Forget the current answer, and stop writing it: the question has changed. */
  function reset() {
    if (phase.value === 'writing') {
      abandoned = true
      stop()
    }
    wanted = null
    text.value = ''
    written.value = null
    if (phase.value === 'asking' || phase.value === 'error' || phase.value === 'unsupported') phase.value = 'off'
  }

  function cancel() {
    wanted = null
    phase.value = 'off'
  }

  /** Delete the model's files from this browser and free what is loaded. */
  async function remove() {
    worker?.terminate()
    worker = null
    wanted = null
    text.value = ''
    written.value = null
    phase.value = 'off'
    device.value = null
    remember(null)
    try {
      await caches.delete(GENERATION_CACHE)
    } catch {
      // Nothing to delete without Cache Storage.
    }
  }

  function dispose() {
    worker?.terminate()
    worker = null
  }

  return { phase, model, models: GENERATION_MODELS, device, progress, message, text, written, size, markdown, write, choose, accept, stop, reset, cancel, remove, dispose }
}
