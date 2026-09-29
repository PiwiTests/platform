<script setup lang="ts">
/**
 * The "Ask the docs" button and panel, in the nav bar. A question is ranked
 * against the docs' passages in a web worker (ask-docs/worker.ts) from the
 * index scripts/generate-rag-index.mjs publishes under /rag/. The reply quotes
 * the blocks of the docs that answer it (paragraphs, lists, tables, commands),
 * as the docs write them, each with its source, and lists the passages as
 * links. Nothing is sent anywhere: the worker reads the site's own static files.
 *
 * Optionally, and only after the reader agrees to a download, a small language
 * model running in the browser (ask-docs/generate.worker.ts) rewrites the found
 * passages as a formatted answer.
 */
import { computed, nextTick, onBeforeUnmount, ref, shallowRef } from 'vue'
import { withBase } from 'vitepress'
import type { AnswerBlock, Source, WorkerMessage, WorkerRequest } from '../ask-docs/protocol'
import type { Render } from '../ask-docs/render'
import { useGeneration } from '../ask-docs/useGeneration'

declare const __ASK_DOCS_ENABLED__: boolean
declare const __ASK_DOCS_MODEL_HOST__: string
const enabled = typeof __ASK_DOCS_ENABLED__ !== 'undefined' && __ASK_DOCS_ENABLED__
/** The host the language model is downloaded from, as the reader sees it. */
const modelHost = typeof __ASK_DOCS_MODEL_HOST__ === 'undefined' ? 'huggingface.co' : new URL(__ASK_DOCS_MODEL_HOST__).host

type Result = Extract<WorkerMessage, { type: 'result' }>
type ModelPhase = 'idle' | 'loading' | 'ready' | 'error' | 'manual'

const EXAMPLES = [
  'How do I find flaky tests?',
  'How do I send results from GitHub Actions?',
  'Can I use PostgreSQL instead of SQLite?',
]

const open = ref(false)
const query = ref('')
const asked = ref('')
const pending = ref(false)
const failure = ref('')
const result = ref<Result | null>(null)
const indexReady = ref(false)
const model = ref<{ phase: ModelPhase; loaded: number; total: number; message: string }>({
  phase: 'idle',
  loaded: 0,
  total: 0,
  message: '',
})

const trigger = ref<HTMLButtonElement | null>(null)
const dialog = ref<HTMLElement | null>(null)
const input = ref<HTMLInputElement | null>(null)

const href = ({ page, anchor }: Source) => withBase(`/${page === 'index' ? '' : page}${anchor ? `#${anchor}` : ''}`)
const breadcrumb = ({ title, headings }: Source) => [title, ...headings].join(' › ')

const generation = useGeneration(href)

let worker: Worker | null = null
let requestId = 0

/** Markdown to HTML; loaded when the panel first opens so the nav bar button stays light. */
const render = shallowRef<Render | null>(null)
const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const html = (markdown: string) => render.value?.(markdown) ?? `<p>${escapeHtml(markdown)}</p>`
async function loadRenderer() {
  if (render.value) return
  const { createRenderer } = await import('../ask-docs/render')
  render.value = createRenderer(withBase('/'))
}

const formatBytes = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${Math.round(bytes / 1e6)} MB`)
const downloadBytes = ref(0)
const modelStatus = computed(() => {
  const { loaded, total } = model.value
  if (!total || !loaded) return 'Loading the search model.'
  if (loaded >= total) return 'Starting the search model.'
  return `Loading the search model, ${formatBytes(loaded)} of ${formatBytes(total)}.`
})

function post(message: WorkerRequest) {
  worker?.postMessage(message)
}

function onMessage({ data }: MessageEvent<WorkerMessage>) {
  if (data.type === 'index-ready') {
    indexReady.value = true
    downloadBytes.value = data.downloadBytes
    if (model.value.phase === 'idle') model.value = { ...model.value, phase: 'loading' }
  } else if (data.type === 'index-error') {
    failure.value = `The docs index could not be loaded (${data.message}).`
  } else if (data.type === 'model-progress') {
    model.value = { ...model.value, phase: 'loading', loaded: data.loaded, total: data.total }
  } else if (data.type === 'model-ready') {
    model.value = { ...model.value, phase: 'ready' }
    if (result.value?.mode === 'keyword' && asked.value) ask(asked.value)
  } else if (data.type === 'model-error') {
    model.value = { ...model.value, phase: 'error', message: data.message }
  } else if (data.type === 'result' && data.id === requestId) {
    result.value = data
    pending.value = false
  } else if (data.type === 'error' && data.id === requestId) {
    failure.value = `The question could not be answered (${data.message}).`
    pending.value = false
  }
}

function start() {
  if (worker) return
  worker = new Worker(new URL('../ask-docs/worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = onMessage
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true
  if (saveData) model.value = { ...model.value, phase: 'manual' }
  post({ type: 'init', base: withBase('/'), loadModel: !saveData })
}

function loadModel() {
  model.value = { ...model.value, phase: 'loading' }
  post({ type: 'load-model' })
}

async function show() {
  open.value = true
  start()
  void loadRenderer()
  await nextTick()
  input.value?.focus()
}

function close() {
  open.value = false
  void nextTick(() => trigger.value?.focus())
}

function ask(text = query.value) {
  const question = text.trim()
  if (!question || !worker) return
  query.value = question
  asked.value = question
  pending.value = true
  failure.value = ''
  generation.reset()
  post({ type: 'ask', id: ++requestId, query: question })
}

/** A link to a page of the site, in a quoted block, closes the panel; an outside link opens in a new tab and leaves it open. */
function onContentClick(event: MouseEvent) {
  const link = (event.target as HTMLElement).closest('a')
  if (link && link.getAttribute('target') !== '_blank') close()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    close()
    return
  }
  if (event.key !== 'Tab' || !dialog.value) return
  const focusable = [...dialog.value.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input')]
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    last?.focus()
    event.preventDefault()
  } else if (!event.shiftKey && document.activeElement === last) {
    first?.focus()
    event.preventDefault()
  }
}


/** The quoted blocks, those of one source together, so each source is named once. */
const answerGroups = computed(() => {
  const groups: { source: number; blocks: AnswerBlock[] }[] = []
  for (const block of result.value?.answer ?? []) {
    const last = groups.at(-1)
    if (last?.source === block.source) last.blocks.push(block)
    else groups.push({ source: block.source, blocks: [block] })
  }
  return groups
})

/** The model runs on the GPU only, so a browser without WebGPU is not offered it. */
const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator

/** A written answer needs passages to write from: the search found some that are not off topic. */
const canWrite = computed(
  () => hasWebGpu && !!result.value && result.value.confidence !== 'none' && result.value.sources.length > 0,
)

function writeAnswer() {
  if (result.value) generation.write(asked.value, result.value.sources)
}

/** The offer to write an answer is shown until one is being written or has been written. */
const writeOffered = computed(
  () => generation.phase.value === 'off' || (generation.phase.value === 'ready' && !generation.written.value),
)

/** The answer's own grounding notice: names the docs do not contain, or words they do not use. */
const grounding = computed(() => generation.written.value?.grounding ?? null)
const GROUNDING_MIN_SUPPORT = 0.5

onBeforeUnmount(() => {
  worker?.terminate()
  generation.dispose()
})
</script>

<template>
  <button v-if="enabled" ref="trigger" class="ask-trigger" type="button" aria-haspopup="dialog" @click="show">
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
    </svg>
    <span>Ask</span>
  </button>

  <Teleport to="body">
    <div v-if="open" class="ask-backdrop" @mousedown.self="close">
      <div ref="dialog" class="ask-panel" role="dialog" aria-modal="true" aria-labelledby="ask-title" @keydown="onKeydown">
        <h2 id="ask-title" class="ask-visually-hidden">Ask the docs</h2>

        <form class="ask-form" @submit.prevent="ask()">
          <input
            ref="input"
            v-model="query"
            class="ask-input"
            type="text"
            enterkeyhint="search"
            autocomplete="off"
            placeholder="Ask a question about Piwi"
            aria-label="Your question"
          />
          <button class="ask-submit" type="submit" :disabled="!indexReady || !query.trim()">Ask</button>
          <button class="ask-close" type="button" aria-label="Close" @click="close">Esc</button>
        </form>

        <p class="ask-status" role="status">
          <template v-if="failure">{{ failure }}</template>
          <template v-else-if="!indexReady">Loading the docs index.</template>
          <template v-else-if="model.phase === 'loading'">{{ modelStatus }} Keyword results work meanwhile.</template>
          <template v-else-if="model.phase === 'manual'">
            Data saver is on, so the search model is not loaded.
            <button class="ask-link" type="button" @click="loadModel">Load it ({{ formatBytes(downloadBytes) }})</button>
          </template>
          <template v-else-if="model.phase === 'error'">
            The search model could not load ({{ model.message }}). Keyword search still works.
          </template>
          <template v-else>Runs in your browser. Your question is never sent anywhere.</template>
        </p>

        <div class="ask-body" :aria-busy="pending" :data-asked="asked">
          <div v-if="!result && !pending" class="ask-examples">
            <p>Try one of these:</p>
            <button v-for="example in EXAMPLES" :key="example" type="button" class="ask-example" :disabled="!indexReady" @click="ask(example)">
              {{ example }}
            </button>
          </div>

          <p v-if="pending && !result" class="ask-note">Searching.</p>

          <template v-if="result">
            <section v-if="result.confidence === 'answer'" class="ask-answer" aria-live="polite" @click="onContentClick">
              <h3>From the docs</h3>
              <div v-for="group in answerGroups" :key="group.source" class="ask-group">
                <div v-for="(block, at) in group.blocks" :key="at" class="ask-md" v-html="html(block.markdown)" />
                <p class="ask-from">
                  {{ group.blocks.some((block) => block.clipped) ? 'Shortened. ' : '' }}Source:
                  <a :href="href(result.sources[group.source]!)" @click="close">
                    [{{ group.source + 1 }}] {{ breadcrumb(result.sources[group.source]!) }}
                  </a>
                </p>
              </div>
              <p class="ask-note">Copied from the pages below, not rewritten. Open the source before relying on it.</p>
            </section>
            <p v-else-if="result.confidence === 'related'" class="ask-note" aria-live="polite">
              No direct answer found. These passages are the closest.
            </p>
            <p v-else class="ask-note" aria-live="polite">
              The docs do not seem to cover this. Try other words, or use the search box.
            </p>

            <section v-if="canWrite" class="ask-write" aria-live="polite" @click="onContentClick">
              <div v-if="writeOffered" class="ask-write-offer">
                <button class="ask-write-button" type="button" @click="writeAnswer">Write a formatted answer</button>
                <span class="ask-note">With an AI model that runs in this browser. It is an optional download.</span>
              </div>

              <p v-else-if="generation.phase.value === 'probing'" class="ask-note">Checking this browser.</p>

              <p v-else-if="generation.phase.value === 'unsupported'" class="ask-warn">
                No usable GPU was found. The model runs on the GPU through WebGPU, which Chrome, Edge and Safari 26 offer.
              </p>

              <div v-else-if="generation.phase.value === 'asking'" class="ask-consent">
                <p>
                  To write the answer, this browser downloads a language model from <code>{{ modelHost }}</code>, and the
                  runtime that runs it (about 27 MB) from <code>cdn.jsdelivr.net</code>. Both are kept in this browser, so they
                  download once. Your question and the docs stay on this device.
                </p>
                <fieldset class="ask-models">
                  <legend class="ask-visually-hidden">Model</legend>
                  <label v-for="candidate in generation.models" :key="candidate.id" class="ask-model">
                    <input
                      type="radio"
                      name="ask-model"
                      :value="candidate.id"
                      :checked="candidate.id === generation.model.value.id"
                      @change="generation.choose(candidate.id)"
                    />
                    <span>
                      <strong>{{ candidate.label }}</strong> ({{ formatBytes(candidate.bytes[generation.device.value?.dtype ?? 'q4f16']) }})
                      <span class="ask-note">{{ candidate.note }}</span>
                    </span>
                  </label>
                </fieldset>
                <p class="ask-consent-actions">
                  <button class="ask-write-button" type="button" @click="generation.accept()">Download and write</button>
                  <button class="ask-link" type="button" @click="generation.cancel()">Not now</button>
                </p>
              </div>

              <div v-else-if="generation.phase.value === 'downloading'" class="ask-download">
                <p class="ask-note">
                  Downloading {{ generation.model.value.label }}<template v-if="generation.progress.value.total">,
                    {{ formatBytes(generation.progress.value.loaded) }} of {{ formatBytes(generation.progress.value.total) }}</template>.
                </p>
                <progress :value="generation.progress.value.loaded" :max="generation.progress.value.total || undefined" />
              </div>

              <p v-else-if="generation.phase.value === 'error'" class="ask-warn">
                The answer could not be written ({{ generation.message.value }}).
                <button class="ask-link" type="button" @click="writeAnswer">Try again</button>
              </p>

              <div v-else class="ask-written">
                <h3>Written answer</h3>
                <p v-if="generation.phase.value === 'writing' && !generation.markdown.value" class="ask-note">Writing.</p>
                <div
                  v-if="generation.markdown.value"
                  class="ask-md"
                  :class="{ 'ask-writing': generation.phase.value === 'writing' }"
                  v-html="html(generation.markdown.value)"
                />
                <p v-if="generation.written.value && !generation.written.value.covered" class="ask-note">
                  The model found nothing in these passages that answers the question.
                </p>
                <p v-if="generation.phase.value === 'writing'">
                  <button class="ask-link" type="button" @click="generation.stop()">Stop</button>
                </p>
                <template v-else-if="generation.written.value?.covered">
                  <p v-if="grounding?.invented.length" class="ask-warn">
                    Not found in the passages:
                    <code v-for="name in grounding.invented" :key="name">{{ name }}</code>. Check them before you use them.
                  </p>
                  <p v-else-if="grounding && grounding.support < GROUNDING_MIN_SUPPORT" class="ask-warn">
                    Part of this answer goes beyond the passages.
                  </p>
                  <p class="ask-note">
                    Written by {{ generation.model.value.label }} on this device, from the passages below. It can be wrong: check the
                    sources.
                    <button class="ask-link" type="button" @click="generation.remove()">Remove the model</button>
                  </p>
                </template>
              </div>
            </section>

            <ol v-if="result.sources.length" class="ask-sources">
              <li v-for="(source, position) in result.sources" :key="`${source.page}#${source.anchor}`">
                <a :href="href(source)" @click="close">
                  <span class="ask-source-number">{{ position + 1 }}</span>
                  <span class="ask-source-title">{{ breadcrumb(source) }}</span>
                </a>
                <p>{{ source.excerpt }}</p>
              </li>
            </ol>

            <p v-if="result.mode === 'keyword' && result.confidence !== 'none'" class="ask-note">
              Ranked by keywords only. Results improve when the search model finishes loading.
            </p>
            <p v-else class="ask-note ask-timing">{{ result.ms }} ms, in your browser</p>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ask-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  margin-right: 8px;
  padding: 0 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-alt);
  color: var(--vp-c-text-2);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition:
    border-color 0.25s,
    color 0.25s;
}

.ask-trigger:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.ask-backdrop {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 10vh 12px 0;
  background: rgba(0, 0, 0, 0.45);
}

.ask-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 720px;
  max-height: 80vh;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg);
  box-shadow: var(--vp-shadow-5);
}

.ask-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.ask-form {
  display: flex;
  gap: 8px;
  padding: 14px 14px 0;
}

.ask-input {
  flex: 1;
  min-width: 0;
  height: 42px;
  padding: 0 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  font-size: 16px;
}

.ask-input:focus {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: -1px;
}

.ask-submit {
  padding: 0 16px;
  border-radius: 8px;
  background: var(--vp-c-brand-3);
  color: var(--vp-c-white);
  font-weight: 600;
  cursor: pointer;
}

.ask-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ask-close {
  padding: 0 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  color: var(--vp-c-text-2);
  font-size: 12px;
  cursor: pointer;
}

.ask-status {
  margin: 8px 16px 0;
  min-height: 1.4em;
  color: var(--vp-c-text-2);
  font-size: 13px;
}

.ask-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px 16px 16px;
  transition: opacity 0.15s;
}

.ask-body[aria-busy='true'] {
  opacity: 0.5;
}

.ask-examples p,
.ask-note {
  margin: 12px 0 4px;
  color: var(--vp-c-text-2);
  font-size: 13px;
}

.ask-example {
  display: block;
  margin: 6px 0;
  padding: 8px 12px;
  width: 100%;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  color: var(--vp-c-text-1);
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}

.ask-example:hover:not(:disabled) {
  border-color: var(--vp-c-brand-1);
}

.ask-answer {
  margin-top: 12px;
  padding: 12px 14px;
  border-radius: 8px;
  background: var(--vp-c-brand-soft);
}

.ask-answer h3 {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--vp-c-text-2);
}

.ask-answer .ask-note {
  margin-top: 8px;
}

.ask-write {
  margin-top: 12px;
  padding: 10px 14px;
  border: 1px dashed var(--vp-c-divider);
  border-radius: 8px;
}

.ask-write p {
  margin: 6px 0;
  font-size: 13px;
  line-height: 1.5;
}

.ask-write-offer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
}

.ask-write-offer .ask-note {
  margin: 0;
}

.ask-write-button {
  padding: 5px 12px;
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 6px;
  color: var(--vp-c-brand-1);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.ask-write-button:hover {
  background: var(--vp-c-brand-soft);
}

.ask-models {
  margin: 8px 0;
  padding: 0;
  border: 0;
}

.ask-model {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  margin: 6px 0;
  font-size: 13px;
  line-height: 1.5;
  cursor: pointer;
}

.ask-model input {
  margin-top: 4px;
}

.ask-model .ask-note {
  display: block;
  margin: 0;
}

.ask-consent-actions {
  display: flex;
  align-items: center;
  gap: 14px;
}

.ask-warn {
  color: var(--vp-c-warning-1);
}

.ask-warn code {
  margin: 0 3px;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--vp-c-warning-soft);
  font-family: var(--vp-font-family-mono);
  font-size: 0.9em;
}

.ask-download progress {
  width: 100%;
  height: 8px;
  accent-color: var(--vp-c-brand-1);
}

.ask-written h3 {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--vp-c-text-2);
}

.ask-writing > :last-child::after {
  content: '▍';
  margin-left: 2px;
  color: var(--vp-c-brand-1);
}

@media (prefers-reduced-motion: no-preference) {
  .ask-writing > :last-child::after {
    animation: ask-caret 1s steps(2, start) infinite;
  }
}

@keyframes ask-caret {
  to {
    visibility: hidden;
  }
}

.ask-group + .ask-group {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--vp-c-divider);
}

.ask-from {
  margin: 6px 0 0;
  color: var(--vp-c-text-2);
  font-size: 12px;
}

.ask-from a {
  color: var(--vp-c-brand-1);
  font-weight: 600;
  text-decoration: none;
}

.ask-from a:hover {
  text-decoration: underline;
}

/* Markdown, from the docs or from a model: the panel styles it, the page's own styles do not reach it. */
.ask-md {
  font-size: 14px;
  line-height: 1.6;
}

.ask-md :deep(> :first-child) {
  margin-top: 0;
}

.ask-md :deep(> :last-child) {
  margin-bottom: 0;
}

.ask-md :deep(p),
.ask-md :deep(ul),
.ask-md :deep(ol),
.ask-md :deep(pre),
.ask-md :deep(blockquote),
.ask-md :deep(.ask-table) {
  margin: 8px 0;
}

.ask-md :deep(ul),
.ask-md :deep(ol) {
  padding-left: 22px;
}

.ask-md :deep(li + li) {
  margin-top: 2px;
}

.ask-md :deep(a) {
  color: var(--vp-c-brand-1);
  font-weight: 500;
  text-decoration: none;
}

.ask-md :deep(a:hover) {
  text-decoration: underline;
}

.ask-md :deep(code) {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--vp-c-default-soft);
  font-family: var(--vp-font-family-mono);
  font-size: 0.9em;
}

.ask-md :deep(pre) {
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--vp-code-block-bg);
  overflow-x: auto;
}

.ask-md :deep(pre code) {
  padding: 0;
  background: none;
  font-size: 12.5px;
  line-height: 1.5;
}

.ask-md :deep(blockquote) {
  padding-left: 12px;
  border-left: 3px solid var(--vp-c-divider);
  color: var(--vp-c-text-2);
}

.ask-md :deep(h3),
.ask-md :deep(h4),
.ask-md :deep(h5),
.ask-md :deep(h6) {
  margin: 12px 0 4px;
  font-size: 14px;
  font-weight: 600;
}

.ask-md :deep(.ask-table) {
  overflow-x: auto;
}

.ask-md :deep(table) {
  display: table;
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.ask-md :deep(th),
.ask-md :deep(td) {
  padding: 5px 9px;
  border: 1px solid var(--vp-c-divider);
  text-align: left;
  vertical-align: top;
}

.ask-md :deep(th) {
  background: var(--vp-c-bg-soft);
  font-weight: 600;
}

.ask-sources {
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}

.ask-sources li {
  padding: 10px 0;
  border-top: 1px solid var(--vp-c-divider);
}

.ask-sources a {
  display: flex;
  gap: 8px;
  align-items: baseline;
  color: var(--vp-c-brand-1);
  font-weight: 600;
  text-decoration: none;
}

.ask-sources a:hover .ask-source-title {
  text-decoration: underline;
}

.ask-source-number {
  flex: none;
  min-width: 1.4em;
  color: var(--vp-c-text-3);
  font-size: 12px;
}

.ask-sources p {
  margin: 4px 0 0 calc(1.4em + 8px);
  color: var(--vp-c-text-2);
  font-size: 14px;
  line-height: 1.5;
}

.ask-link {
  color: var(--vp-c-brand-1);
  text-decoration: underline;
  cursor: pointer;
}

.ask-timing {
  text-align: right;
}
</style>
