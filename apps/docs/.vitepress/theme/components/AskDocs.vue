<script setup lang="ts">
/**
 * The "Ask the docs" button and panel, in the nav bar. A question is ranked
 * against the docs' passages in a web worker (ask-docs/worker.ts) from the
 * index scripts/generate-rag-index.mjs publishes under /rag/. The reply quotes
 * sentences from the best passages, each cited, and lists the passages as
 * links. Nothing is sent anywhere: the worker reads the site's own static files.
 */
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { withBase } from 'vitepress'
import type { AnswerLine, Source, WorkerMessage, WorkerRequest } from '../ask-docs/protocol'

declare const __ASK_DOCS_ENABLED__: boolean
const enabled = typeof __ASK_DOCS_ENABLED__ !== 'undefined' && __ASK_DOCS_ENABLED__

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

let worker: Worker | null = null
let requestId = 0

const megabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)
const downloadBytes = ref(0)
const modelStatus = computed(() => {
  const { loaded, total } = model.value
  if (!total || !loaded) return 'Loading the search model.'
  if (loaded >= total) return 'Starting the search model.'
  return `Loading the search model, ${megabytes(loaded)} of ${megabytes(total)} MB.`
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
  post({ type: 'ask', id: ++requestId, query: question })
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

const href = ({ page, anchor }: Source) =>
  withBase(`/${page === 'index' ? '' : page}${anchor ? `#${anchor}` : ''}`)

const breadcrumb = ({ title, headings }: Source) => [title, ...headings].join(' › ')

const answerLines = computed<AnswerLine[]>(() => result.value?.answer ?? [])

onBeforeUnmount(() => worker?.terminate())
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
            <button class="ask-link" type="button" @click="loadModel">Load it ({{ megabytes(downloadBytes) }} MB)</button>
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
            <section v-if="result.confidence === 'answer'" class="ask-answer" aria-live="polite">
              <h3>From the docs</h3>
              <p>
                <template v-for="line in answerLines" :key="line.text">
                  {{ line.text }}
                  <sup><a :href="href(result.sources[line.source]!)" @click="close">[{{ line.source + 1 }}]</a></sup>
                  {{ ' ' }}
                </template>
              </p>
              <p class="ask-note">Sentences copied from the pages below, picked by how close they are to your question. Open the source before relying on one.</p>
            </section>
            <p v-else-if="result.confidence === 'related'" class="ask-note" aria-live="polite">
              No direct answer found. These passages are the closest.
            </p>
            <p v-else class="ask-note" aria-live="polite">
              The docs do not seem to cover this. Try other words, or use the search box.
            </p>

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

.ask-answer p {
  margin: 0;
  line-height: 1.6;
}

.ask-answer .ask-note {
  margin-top: 8px;
}

.ask-answer sup a {
  margin: 0 2px;
  color: var(--vp-c-brand-1);
  font-weight: 600;
  text-decoration: none;
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
