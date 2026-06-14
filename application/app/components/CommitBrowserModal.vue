<script setup lang="ts">
import { formatRelativeTime } from '~/utils'

interface CommitItem {
  sha: string
  shortSha: string
  message: string
  author: string
  date: string
}

interface DiffFile {
  filename: string
  status: string
  additions: number
  deletions: number
  patch?: string
}

interface PatchLine {
  type: 'add' | 'remove' | 'hunk' | 'context'
  text: string
}

const props = defineProps<{
  open: boolean
  clusterId: number
  initialSelected?: string[]
}>()

const emit = defineEmits<{
  'update:open': [boolean]
  'confirm': [string[]]
}>()

const COMMIT_PAGE_SIZE = 50

const search = ref('')
const commits = ref<CommitItem[]>([])
const commitLimit = ref(COMMIT_PAGE_SIZE)
const hasMore = ref(false)
const loadingCommits = ref(false)
const loadingMore = ref(false)
const commitsError = ref<string | null>(null)
const loadMoreError = ref<string | null>(null)
const selectedShas = ref<Set<string>>(new Set())
const focusedSha = ref<string | null>(null)

// Accumulate diffs as they are loaded — used for aggregate stats
const diffCache = reactive<Record<string, { files: DiffFile[] } | null>>({})
const diff = ref<{ files: DiffFile[] } | null>(null)
const loadingDiff = ref(false)
const diffError = ref<string | null>(null)

const focusedCommit = computed(() => commits.value.find(c => c.sha === focusedSha.value) ?? null)

const filteredCommits = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return commits.value
  return commits.value.filter(c =>
    c.message.toLowerCase().includes(q)
    || c.author.toLowerCase().includes(q)
    || c.sha.includes(q)
    || c.shortSha.includes(q)
  )
})

// Aggregate stats for selected commits — uses cached diffs where available
const selectedStats = computed(() => {
  let files = 0, linesAdded = 0, linesRemoved = 0, unreviewed = 0
  for (const sha of selectedShas.value) {
    if (!(sha in diffCache)) {
      unreviewed++
      continue
    }
    const d = diffCache[sha]
    if (d) {
      files += d.files.length
      linesAdded += d.files.reduce((s, f) => s + f.additions, 0)
      linesRemoved += d.files.reduce((s, f) => s + f.deletions, 0)
    }
  }
  return { files, linesAdded, linesRemoved, unreviewed }
})

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { data?: { message?: string }, message?: string }
    return e.data?.message ?? e.message ?? 'Unknown error'
  }
  return 'Unknown error'
}

// Load (or reload at new limit)
async function loadCommits(initial: boolean) {
  if (initial) {
    loadingCommits.value = true
    commitsError.value = null
  } else {
    loadingMore.value = true
    loadMoreError.value = null
  }
  try {
    const res = await $fetch<{ commits: CommitItem[], hasMore?: boolean, error?: string | null }>(
      `/api/failure-clusters/${props.clusterId}/commits`,
      { query: { limit: commitLimit.value } }
    )
    commits.value = res.commits
    hasMore.value = res.hasMore ?? false
    if (res.error && !res.commits.length) {
      if (initial) commitsError.value = res.error
      else loadMoreError.value = res.error
    }
    if (initial && res.commits[0]) focusCommit(res.commits[0].sha)
  } catch (err) {
    if (initial) commitsError.value = errorMessage(err)
    else loadMoreError.value = errorMessage(err)
  } finally {
    loadingCommits.value = false
    loadingMore.value = false
  }
}

async function loadMore() {
  commitLimit.value += COMMIT_PAGE_SIZE
  await loadCommits(false)
}

watch(() => props.open, async (val) => {
  if (!val) return
  selectedShas.value = new Set(props.initialSelected ?? [])
  if (commits.value.length) {
    if (!focusedSha.value && commits.value[0]) focusCommit(commits.value[0].sha)
    return
  }
  commitLimit.value = COMMIT_PAGE_SIZE
  await loadCommits(true)
})

async function focusCommit(sha: string) {
  if (focusedSha.value === sha) return
  focusedSha.value = sha
  diffError.value = null

  // Serve from cache immediately
  if (sha in diffCache) {
    diff.value = diffCache[sha]
    loadingDiff.value = false
    return
  }

  diff.value = null
  loadingDiff.value = true
  try {
    const result = await $fetch<{ files: DiffFile[] } | null>(
      `/api/failure-clusters/${props.clusterId}/commit-diff`,
      { query: { sha } }
    )
    diffCache[sha] = result
    if (focusedSha.value === sha) diff.value = result
  } catch (err) {
    if (focusedSha.value === sha) diffError.value = errorMessage(err)
    // Don't cache errors so the user can retry by clicking the commit again
  } finally {
    if (focusedSha.value === sha) loadingDiff.value = false
  }
}

function toggleSha(sha: string) {
  const s = new Set(selectedShas.value)
  if (s.has(sha)) s.delete(sha)
  else s.add(sha)
  selectedShas.value = s
}

function selectAll() {
  selectedShas.value = new Set(filteredCommits.value.map(c => c.sha))
}

function clearAll() {
  selectedShas.value = new Set()
}

function confirm() {
  emit('confirm', [...selectedShas.value])
  emit('update:open', false)
}

function parsePatchLines(patch: string): PatchLine[] {
  return patch.split('\n').map((line) => {
    if (line.startsWith('+') && !line.startsWith('+++')) return { type: 'add', text: line }
    if (line.startsWith('-') && !line.startsWith('---')) return { type: 'remove', text: line }
    if (line.startsWith('@@')) return { type: 'hunk', text: line }
    return { type: 'context', text: line }
  })
}

const lineClass: Record<PatchLine['type'], string> = {
  add: 'bg-green-50 dark:bg-green-950/30 text-green-800 dark:text-green-300',
  remove: 'bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300',
  hunk: 'bg-blue-50 dark:bg-blue-950/20 text-blue-500 dark:text-blue-400',
  context: 'text-gray-600 dark:text-gray-400'
}
</script>

<template>
  <UModal
    :open="open"
    title="Browse commits"
    :ui="{ content: 'max-w-6xl', body: 'p-0 overflow-hidden' }"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="flex h-[72vh] overflow-hidden">
        <!-- ── Left: commit list ─────────────────────────────────────── -->
        <div class="w-72 shrink-0 border-r border-default flex flex-col">
          <!-- Search + bulk actions -->
          <div class="p-2 border-b border-default space-y-2 shrink-0">
            <UInput
              v-model="search"
              placeholder="Search commits…"
              size="xs"
              icon="i-lucide-search"
            />
            <div class="flex items-center gap-2 text-xs text-gray-500">
              <button class="hover:text-primary transition-colors" @click="selectAll">
                All
              </button>
              <span>·</span>
              <button class="hover:text-primary transition-colors" @click="clearAll">
                None
              </button>
              <span class="ml-auto">
                {{ selectedShas.size > 0 ? `${selectedShas.size} selected` : 'none selected' }}
              </span>
            </div>
          </div>

          <!-- Loading initial -->
          <div v-if="loadingCommits" class="flex-1 flex items-center justify-center gap-2 text-gray-400">
            <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
            <span class="text-sm">Loading…</span>
          </div>

          <!-- Error -->
          <div v-else-if="commitsError" class="flex-1 flex flex-col items-center justify-center gap-2 p-4 text-center">
            <UIcon name="i-lucide-circle-alert" class="size-5 text-red-400" />
            <p class="text-sm text-red-500">
              {{ commitsError }}
            </p>
            <UButton
              size="xs"
              color="neutral"
              variant="outline"
              @click="loadCommits(true)"
            >
              Retry
            </UButton>
          </div>

          <!-- Commit list -->
          <div v-else class="flex-1 overflow-y-auto flex flex-col">
            <div v-if="filteredCommits.length === 0" class="py-6 text-center text-sm text-gray-400 flex-1">
              {{ search ? 'No commits match' : 'No commits' }}
            </div>

            <button
              v-for="c in filteredCommits"
              :key="c.sha"
              class="w-full text-left px-2.5 py-2 flex items-start gap-2.5 hover:bg-elevated transition-colors border-b border-default/50 last:border-0 shrink-0"
              :class="focusedSha === c.sha ? 'bg-elevated' : ''"
              @click="focusCommit(c.sha)"
            >
              <input
                type="checkbox"
                :checked="selectedShas.has(c.sha)"
                class="mt-0.5 shrink-0 cursor-pointer accent-primary"
                @click.stop
                @change="toggleSha(c.sha)"
              >
              <div class="flex-1 min-w-0">
                <p class="text-xs font-medium leading-snug truncate">
                  {{ c.message || '(no message)' }}
                </p>
                <p class="text-[10px] text-gray-400 leading-snug mt-0.5 flex items-center gap-1 min-w-0">
                  <code class="text-primary shrink-0">{{ c.shortSha }}</code>
                  <span class="truncate">{{ c.author }}</span>
                  <template v-if="c.date">
                    <span class="shrink-0">· {{ formatRelativeTime(c.date) }}</span>
                  </template>
                </p>
              </div>
            </button>

            <!-- Load more -->
            <div v-if="hasMore && !search" class="p-2 shrink-0 space-y-1.5">
              <p v-if="loadMoreError" class="flex items-center gap-1.5 text-xs text-red-500 px-1">
                <UIcon name="i-lucide-circle-alert" class="size-3.5 shrink-0" />
                {{ loadMoreError }}
              </p>
              <UButton
                size="xs"
                color="neutral"
                variant="outline"
                block
                :loading="loadingMore"
                @click="loadMore"
              >
                Load more
              </UButton>
            </div>
          </div>
        </div>

        <!-- ── Right: diff viewer ────────────────────────────────────── -->
        <div class="flex-1 overflow-y-auto flex flex-col min-w-0">
          <!-- No selection -->
          <div v-if="!focusedSha" class="flex-1 flex items-center justify-center text-gray-400 text-sm">
            Select a commit to view its diff
          </div>

          <!-- Loading diff -->
          <div v-else-if="loadingDiff" class="flex-1 flex items-center justify-center gap-2 text-gray-400">
            <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
            <span class="text-sm">Loading diff…</span>
          </div>

          <!-- Diff content -->
          <div v-else-if="diff" class="flex-1 p-4 space-y-3">
            <!-- Commit header -->
            <div v-if="focusedCommit" class="space-y-0.5 pb-3 border-b border-default">
              <div class="flex items-center gap-2">
                <code class="text-xs font-mono text-primary">{{ focusedCommit.shortSha }}</code>
                <span class="text-xs text-gray-400">
                  {{ focusedCommit.author }}<template v-if="focusedCommit.date"> · {{ formatRelativeTime(focusedCommit.date) }}</template>
                </span>
              </div>
              <p class="text-sm font-semibold">
                {{ focusedCommit.message }}
              </p>
            </div>

            <!-- Empty diff -->
            <div v-if="diff.files.length === 0" class="text-sm text-gray-400 pt-2">
              No file changes in this commit
            </div>

            <!-- Files -->
            <div
              v-for="file in diff.files"
              :key="file.filename"
              class="border border-default rounded-lg overflow-clip text-xs font-mono"
            >
              <!-- Sticky file header -->
              <div class="sticky top-0 z-10 flex items-center justify-between px-3 py-1.5 bg-elevated border-b border-default text-gray-600 dark:text-gray-300">
                <span class="font-medium truncate">{{ file.filename }}</span>
                <span class="shrink-0 flex items-center gap-1.5 ml-2 text-[11px]">
                  <span v-if="file.additions" class="text-green-600 dark:text-green-400">+{{ file.additions }}</span>
                  <span v-if="file.deletions" class="text-red-600 dark:text-red-400">-{{ file.deletions }}</span>
                  <UBadge
                    :label="file.status"
                    size="xs"
                    variant="subtle"
                    :color="file.status === 'added' ? 'success' : file.status === 'removed' ? 'error' : 'neutral'"
                  />
                </span>
              </div>
              <!-- Patch lines -->
              <div v-if="file.patch" class="overflow-x-auto">
                <div
                  v-for="(line, i) in parsePatchLines(file.patch)"
                  :key="i"
                  class="px-3 py-px whitespace-pre leading-5 min-w-0"
                  :class="lineClass[line.type]"
                >
                  {{ line.text || ' ' }}
                </div>
              </div>
              <div v-else class="px-3 py-2 text-gray-400 text-[11px]">
                No patch available
              </div>
            </div>
          </div>

          <!-- Diff fetch error -->
          <div v-else-if="diffError" class="flex-1 flex flex-col items-center justify-center gap-2 p-6 text-center">
            <UIcon name="i-lucide-circle-alert" class="size-5 text-red-400" />
            <p class="text-sm text-red-500">
              {{ diffError }}
            </p>
            <p class="text-xs text-gray-400">
              Click the commit again to retry
            </p>
          </div>

          <!-- Diff unavailable (intentional null from API) -->
          <div v-else class="flex-1 flex items-center justify-center text-sm text-gray-400">
            Diff not available for this commit
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex items-center gap-3 w-full">
        <!-- Stats summary -->
        <div class="flex-1 flex items-center gap-2 text-sm text-gray-500 min-w-0">
          <template v-if="selectedShas.size > 0">
            <span class="font-medium text-gray-700 dark:text-gray-200 shrink-0">
              {{ selectedShas.size }} commit{{ selectedShas.size === 1 ? '' : 's' }}
            </span>
            <template v-if="selectedStats.files > 0 || selectedStats.linesAdded > 0 || selectedStats.linesRemoved > 0">
              <span class="text-gray-300 dark:text-gray-600">·</span>
              <span class="shrink-0">{{ selectedStats.files }} file{{ selectedStats.files === 1 ? '' : 's' }}</span>
              <span class="text-green-600 dark:text-green-400 shrink-0 font-medium">+{{ selectedStats.linesAdded }}</span>
              <span class="text-red-600 dark:text-red-400 shrink-0 font-medium">-{{ selectedStats.linesRemoved }}</span>
            </template>
            <span v-if="selectedStats.unreviewed > 0" class="text-gray-400 text-xs shrink-0">
              ({{ selectedStats.unreviewed }} unreviewed)
            </span>
          </template>
          <span v-else>No commits selected</span>
        </div>

        <UButton color="neutral" variant="ghost" @click="emit('update:open', false)">
          Cancel
        </UButton>
        <UButton color="primary" :disabled="selectedShas.size === 0" @click="confirm">
          Add to context
        </UButton>
      </div>
    </template>
  </UModal>
</template>
