<script setup lang="ts">
const props = defineProps<{
  text: string | null
  loading?: boolean
}>()

type PreviewLine
  = | { kind: 'h2', text: string }
    | { kind: 'h3', text: string }
    | { kind: 'note', text: string }
    | { kind: 'bullet', text: string }
    | { kind: 'text', text: string }
    | { kind: 'blank' }
    | { kind: 'code-start', lang: string }
    | { kind: 'code-diff-added', text: string }
    | { kind: 'code-diff-removed', text: string }
    | { kind: 'code-diff-meta', text: string }
    | { kind: 'code-line', text: string }
    | { kind: 'code-end' }

function parse(text: string): PreviewLine[] {
  const result: PreviewLine[] = []
  let inCode = false
  let codeLang = ''

  for (const line of text.split('\n')) {
    if (!inCode) {
      if (line.startsWith('```')) {
        inCode = true
        codeLang = line.slice(3).trim()
        result.push({ kind: 'code-start', lang: codeLang })
      } else if (line.startsWith('## ')) {
        result.push({ kind: 'h2', text: line.slice(3) })
      } else if (line.startsWith('### ')) {
        result.push({ kind: 'h3', text: line.slice(4) })
      } else if (line.startsWith('> ')) {
        result.push({ kind: 'note', text: line.slice(2) })
      } else if (line.startsWith('- ')) {
        result.push({ kind: 'bullet', text: line.slice(2) })
      } else if (line.trim() === '') {
        result.push({ kind: 'blank' })
      } else {
        result.push({ kind: 'text', text: line })
      }
    } else {
      if (line === '```') {
        inCode = false
        result.push({ kind: 'code-end' })
      } else if (codeLang === 'diff') {
        if (line.startsWith('+')) result.push({ kind: 'code-diff-added', text: line })
        else if (line.startsWith('-') && !line.startsWith('---')) result.push({ kind: 'code-diff-removed', text: line })
        else if (line.startsWith('@@') || line.startsWith('diff ') || line.startsWith('---') || line.startsWith('+++')) result.push({ kind: 'code-diff-meta', text: line })
        else result.push({ kind: 'code-line', text: line })
      } else {
        result.push({ kind: 'code-line', text: line })
      }
    }
  }
  return result
}

const lines = computed<PreviewLine[]>(() => props.text ? parse(props.text) : [])
</script>

<template>
  <div class="rounded-lg border border-default overflow-hidden bg-muted min-h-16">
    <div v-if="loading" class="flex items-center gap-2 p-4 text-sm text-gray-500">
      <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
      <span>Fetching context… (includes SCM diff lookup)</span>
    </div>
    <div
      v-else-if="lines.length"
      class="overflow-auto max-h-[45vh] p-3 text-xs font-mono leading-relaxed"
    >
      <template v-for="(line, i) in lines" :key="i">
        <div v-if="line.kind === 'h2'" class="text-sm font-bold text-gray-900 dark:text-white mt-4 mb-0.5 first:mt-0">
          {{ line.text }}
        </div>
        <div v-else-if="line.kind === 'h3'" class="font-semibold text-gray-700 dark:text-gray-200 mt-2 mb-0.5">
          {{ line.text }}
        </div>
        <div v-else-if="line.kind === 'note'" class="my-1 px-2 py-0.5 rounded bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-300 italic">
          {{ line.text }}
        </div>
        <div v-else-if="line.kind === 'bullet'" class="text-gray-600 dark:text-gray-400 flex gap-1.5">
          <span class="text-gray-400 shrink-0">·</span>
          <span>{{ line.text }}</span>
        </div>
        <div v-else-if="line.kind === 'text'" class="text-gray-600 dark:text-gray-400">
          {{ line.text }}
        </div>
        <div v-else-if="line.kind === 'blank'" class="h-2" />
        <div v-else-if="line.kind === 'code-start'" class="mt-2 px-2 py-0.5 bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-t text-[10px] uppercase tracking-wide">
          {{ line.lang || 'code' }}
        </div>
        <div v-else-if="line.kind === 'code-end'" class="h-1 bg-gray-100 dark:bg-gray-800/50 rounded-b mb-2" />
        <div v-else-if="line.kind === 'code-diff-added'" class="bg-green-50 dark:bg-green-950/40 text-green-800 dark:text-green-300 px-2 whitespace-pre">
          {{ line.text }}
        </div>
        <div v-else-if="line.kind === 'code-diff-removed'" class="bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300 px-2 whitespace-pre">
          {{ line.text }}
        </div>
        <div v-else-if="line.kind === 'code-diff-meta'" class="bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 px-2 whitespace-pre">
          {{ line.text }}
        </div>
        <div v-else-if="line.kind === 'code-line'" class="bg-gray-50 dark:bg-gray-900/40 text-gray-700 dark:text-gray-300 px-2 whitespace-pre">
          {{ line.text }}
        </div>
      </template>
    </div>
    <div v-else class="p-3 text-xs text-gray-400 italic">
      No context loaded
    </div>
  </div>
</template>
