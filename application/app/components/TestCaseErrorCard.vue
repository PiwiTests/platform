<script setup lang="ts">
export interface ErrorCardCluster {
  id: number
  sameRunCaseCount: number
  isNew: boolean
  firstSeenRunId: number
  firstSeenAt: string | Date | null
  status?: string | null
  triageNote?: string | null
}

const props = defineProps<{
  error: string
  cluster?: ErrorCardCluster | null
}>()

// Only show the cluster line when it carries a signal: other tests failed the
// same way in this run, or the failure is already known from previous runs
const showCluster = computed(() =>
  !!props.cluster && (props.cluster.sameRunCaseCount > 1 || !props.cluster.isNew)
)

const expanded = ref(false)
const copySuccess = ref(false)

async function copyError() {
  try {
    await navigator.clipboard.writeText(props.error)
    copySuccess.value = true
    setTimeout(() => {
      copySuccess.value = false
    }, 2000)
  } catch {
    // Clipboard not available
  }
}

const lines = computed(() => {
  return props.error.split('\n')
})

const isLong = computed(() => props.error.length > 500)

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const filePathPattern = /((?:[\w./-]+\.(?:ts|js|tsx|jsx|vue|mjs|cjs|spec\.ts|test\.ts))):(\d+):(\d+)/g

function renderLine(line: string, _index: number): string {
  return line
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function isErrorHeader(index: number): boolean {
  return index === 0 && lines.value.length > 0 && lines.value[0]!.length > 0
}

function isStackFrame(line: string): boolean {
  return /^\s+at\s/.test(line) || /^\s+at\s/.test(line) || line.includes('node_modules')
}

function isDivider(line: string): boolean {
  return /^=+$/.test(line) || /^-+$/.test(line)
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function isLogSection(line: string): boolean {
  return line.startsWith('========================') || line.includes('logs =====')
}

function highlightPath(text: string): string {
  return text.replace(
    /((?:[\w./\\-]+\.(?:ts|js|tsx|jsx|vue|mjs|cjs|spec\.ts|test\.ts))):(\d+):(\d+)/g,
    '<span class="text-primary font-mono">$1:$2:$3</span>'
  )
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-circle-x" class="w-5 h-5 text-red-500" />
          <h3 class="text-lg font-medium text-red-600">
            Error details
          </h3>
        </div>
        <div class="flex items-center gap-1">
          <UButton
            icon="i-lucide-copy"
            size="xs"
            color="neutral"
            variant="ghost"
            label="Copy"
            @click="copyError()"
          />
          <span v-if="copySuccess" class="text-xs text-green-600 mr-1">Copied!</span>
        </div>
      </div>
    </template>

    <div
      v-if="showCluster && cluster"
      class="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 dark:text-gray-400"
    >
      <UIcon name="i-lucide-layers" class="size-3.5 shrink-0" />
      <span v-if="cluster.sameRunCaseCount > 1">
        Matches {{ cluster.sameRunCaseCount - 1 }} other failing {{ cluster.sameRunCaseCount - 1 === 1 ? 'test' : 'tests' }} in this run
      </span>
      <UBadge
        v-if="cluster.isNew"
        color="warning"
        variant="subtle"
        size="sm"
      >
        New failure
      </UBadge>
      <span v-else>
        <template v-if="cluster.sameRunCaseCount > 1">· </template>Known failure — first seen in
        <NuxtLink :to="`/test-runs/${cluster.firstSeenRunId}`" class="text-primary hover:underline">
          run #{{ cluster.firstSeenRunId }}
        </NuxtLink>
        <template v-if="cluster.firstSeenAt">
          ({{ formatRelativeTime(cluster.firstSeenAt) }})
        </template>
      </span>
      <UBadge
        v-if="cluster.status && cluster.status !== 'open'"
        :color="cluster.status === 'resolved' ? 'success' : 'neutral'"
        variant="subtle"
        size="sm"
      >
        {{ cluster.status }}
      </UBadge>
      <span v-if="cluster.triageNote" class="italic" :title="cluster.triageNote">
        — {{ cluster.triageNote }}
      </span>
    </div>

    <ClusterDiagnosis v-if="cluster" :cluster-id="cluster.id" />

    <div class="bg-red-50 dark:bg-red-900/20 rounded overflow-hidden">
      <div
        class="overflow-x-auto p-0"
        :class="!expanded && isLong ? 'max-h-32 overflow-y-hidden' : ''"
      >
        <div class="font-mono text-xs leading-relaxed p-4">
          <div
            v-for="(line, index) in lines"
            v-show="!isLong || expanded || index < 10"
            :key="index"
          >
            <div
              v-if="isErrorHeader(index)"
              class="text-red-700 dark:text-red-300 font-bold text-sm mb-2"
            >
              {{ renderLine(line, index) }}
            </div>
            <div
              v-else-if="isDivider(line)"
              class="text-gray-400 dark:text-gray-500 my-1 select-none"
            >
              {{ renderLine(line, index) }}
            </div>
            <!-- eslint-disable vue/no-v-html -->
            <div
              v-else-if="isStackFrame(line)"
              class="text-gray-500 dark:text-gray-400 pl-4 border-l-2 border-gray-300 dark:border-gray-600 mb-0.5"
            >
              <span v-html="highlightPath(renderLine(line, index))" />
            </div>
            <div
              v-else
              class="text-red-600 dark:text-red-400"
              v-html="highlightPath(renderLine(line, index))"
            />
            <!-- eslint-enable vue/no-v-html -->
          </div>
        </div>
      </div>

      <div v-if="isLong" class="border-t border-red-200 dark:border-red-800">
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          class="w-full justify-center rounded-none"
          @click="expanded = !expanded"
        >
          <UIcon
            :name="expanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
            class="size-3.5"
          />
          {{ expanded ? 'Show less' : `Show full error (${lines.length} lines)` }}
        </UButton>
      </div>
    </div>
  </UCard>
</template>
