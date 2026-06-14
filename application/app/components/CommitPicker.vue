<script setup lang="ts">
interface CommitItem {
  sha: string
  shortSha: string
  message: string
  author: string
  date: string
}

const props = defineProps<{
  modelValue: string
  clusterId: number
}>()

const emit = defineEmits<{
  'update:modelValue': [string]
}>()

const open = ref(false)
const search = ref('')
const commits = ref<CommitItem[]>([])
const loading = ref(false)
const fetchError = ref(false)
const searchInputRef = ref<{ $el?: HTMLElement } | null>(null)

const selected = computed((): CommitItem | null => {
  if (!props.modelValue) return null
  const sha = props.modelValue.trim()
  const found = commits.value.find(c => c.sha === sha || c.sha.startsWith(sha))
  return found ?? { sha, shortSha: sha.slice(0, 7), message: '', author: '', date: '' }
})

async function loadCommits() {
  if (commits.value.length) return
  loading.value = true
  fetchError.value = false
  try {
    const res = await $fetch<{ commits: CommitItem[] }>(`/api/failure-clusters/${props.clusterId}/commits`)
    commits.value = res.commits
  } catch {
    fetchError.value = true
  } finally {
    loading.value = false
  }
}

watch(open, async (val) => {
  if (val) {
    await loadCommits()
    await nextTick()
    const input = searchInputRef.value?.$el?.querySelector('input') ?? searchInputRef.value?.$el
    if (input instanceof HTMLElement) input.focus()
  } else {
    search.value = ''
  }
})

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return commits.value
  return commits.value.filter(c =>
    c.message.toLowerCase().includes(q) ||
    c.author.toLowerCase().includes(q) ||
    c.sha.includes(q) ||
    c.shortSha.includes(q)
  )
})

// When search looks like a SHA not already in list, offer a manual-use option
const manualSha = computed(() => {
  const q = search.value.trim()
  if (!/^[0-9a-f]{7,40}$/i.test(q)) return null
  if (filtered.value.some(c => c.sha.startsWith(q.toLowerCase()))) return null
  return q
})

function select(sha: string) {
  emit('update:modelValue', sha)
  open.value = false
}

function clear(e: Event) {
  e.stopPropagation()
  emit('update:modelValue', '')
  open.value = false
}
</script>

<template>
  <UPopover v-model:open="open">
    <UButton
      size="xs"
      color="neutral"
      variant="outline"
      :icon="modelValue ? 'i-lucide-git-branch-plus' : 'i-lucide-git-branch'"
      trailing-icon="i-lucide-chevron-down"
      class="min-w-36 max-w-48 font-mono"
    >
      <span v-if="selected?.message" class="flex items-center gap-1.5 overflow-hidden min-w-0">
        <code class="text-primary shrink-0">{{ selected.shortSha }}</code>
        <span class="text-gray-500 truncate text-xs font-sans">{{ selected.message }}</span>
      </span>
      <span v-else-if="modelValue" class="text-primary text-xs">{{ modelValue.slice(0, 7) }}…</span>
      <span v-else class="text-gray-400 font-sans text-xs">baseline commit…</span>
    </UButton>

    <template #content>
      <div class="w-96 p-2 space-y-2">
        <!-- Search bar + clear -->
        <div class="flex items-center gap-1">
          <UInput
            ref="searchInputRef"
            v-model="search"
            placeholder="Search message, author, SHA…"
            size="xs"
            icon="i-lucide-search"
            class="flex-1"
          />
          <UButton
            v-if="modelValue"
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            title="Clear baseline"
            @click="clear($event)"
          />
        </div>

        <!-- Loading -->
        <div v-if="loading" class="flex items-center justify-center gap-2 py-6 text-gray-400">
          <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
          <span class="text-sm">Loading commits…</span>
        </div>

        <!-- Error -->
        <div v-else-if="fetchError" class="py-4 text-center text-sm text-red-500">
          Failed to load commits — check SCM token in AI settings
        </div>

        <!-- List -->
        <div v-else class="max-h-80 overflow-y-auto space-y-px">
          <!-- Manual SHA option when search looks like an unlisted SHA -->
          <button
            v-if="manualSha"
            class="w-full text-left px-2 py-1.5 rounded flex items-center gap-2 hover:bg-elevated transition-colors border border-dashed border-default"
            @click="select(manualSha)"
          >
            <UIcon name="i-lucide-git-commit-horizontal" class="size-3.5 text-gray-400 shrink-0" />
            <span class="text-xs text-gray-500">Use commit</span>
            <code class="text-xs text-primary">{{ manualSha.slice(0, 7) }}</code>
          </button>

          <!-- No results -->
          <div v-if="filtered.length === 0 && !manualSha" class="py-4 text-center text-sm text-gray-400">
            {{ search ? 'No commits match' : 'No commits available' }}
          </div>

          <!-- Commit rows -->
          <button
            v-for="c in filtered"
            :key="c.sha"
            class="w-full text-left px-2 py-1.5 rounded flex items-start gap-2 hover:bg-elevated transition-colors"
            :class="modelValue === c.sha ? 'bg-primary/10 ring-1 ring-inset ring-primary/30' : ''"
            @click="select(c.sha)"
          >
            <code class="text-xs text-primary shrink-0 w-14 pt-px">{{ c.shortSha }}</code>
            <div class="flex-1 min-w-0">
              <p class="text-xs font-medium leading-snug truncate">{{ c.message }}</p>
              <p class="text-xs text-gray-400 leading-snug truncate">
                {{ c.author }}<template v-if="c.date"> · {{ formatRelativeTime(c.date) }}</template>
              </p>
            </div>
            <UIcon v-if="modelValue === c.sha" name="i-lucide-check" class="size-3.5 text-primary shrink-0 mt-0.5" />
          </button>
        </div>
      </div>
    </template>
  </UPopover>
</template>
