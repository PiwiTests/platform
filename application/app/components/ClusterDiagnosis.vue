<script setup lang="ts">
import type { FailureDiagnosis } from '~~/server/database/schema'
import { formatRelativeTime } from '~/utils'

const props = defineProps<{
  clusterId: number
  showContextPreview?: boolean
}>()

const { aiStatus } = useAiStatus()

const diagnosis = ref<FailureDiagnosis | null>(null)
const posting = ref(false)
const pollTimer = ref<ReturnType<typeof setInterval> | null>(null)
const toast = useToast()

const additionalContext = ref('')
const contextOpen = ref(false)
const contextText = ref<string | null>(null)
const loadingContext = ref(false)

async function fetchDiagnosis() {
  try {
    diagnosis.value = await $fetch<FailureDiagnosis | null>(`/api/failure-clusters/${props.clusterId}/diagnosis`)
  } catch {
    // ignore
  }
}

async function fetchContext() {
  if (contextText.value !== null) return
  loadingContext.value = true
  try {
    const res = await $fetch<{ context: string }>(`/api/failure-clusters/${props.clusterId}/context`)
    contextText.value = res.context
  } catch {
    contextText.value = '(failed to load context)'
  } finally {
    loadingContext.value = false
  }
}

watch(contextOpen, (open) => {
  if (open) fetchContext()
})

function startPoll() {
  if (pollTimer.value) return
  let elapsed = 0
  pollTimer.value = setInterval(async () => {
    elapsed += 3000
    await fetchDiagnosis()
    if (!diagnosis.value || diagnosis.value.status !== 'running' || elapsed >= 120_000) {
      stopPoll()
    }
  }, 3000)
}

function stopPoll() {
  if (pollTimer.value) {
    clearInterval(pollTimer.value)
    pollTimer.value = null
  }
}

async function diagnose(force = false) {
  posting.value = true
  try {
    const url = force
      ? `/api/failure-clusters/${props.clusterId}/diagnose?force=true`
      : `/api/failure-clusters/${props.clusterId}/diagnose`
    diagnosis.value = await $fetch<FailureDiagnosis>(url, {
      method: 'POST',
      body: additionalContext.value.trim()
        ? { additionalContext: additionalContext.value.trim() }
        : undefined
    })
    if (diagnosis.value?.status === 'running') startPoll()
  } catch (err: unknown) {
    const status = (err as { statusCode?: number })?.statusCode
    if (status === 409) {
      startPoll()
    } else {
      toast.add({ title: 'Diagnosis failed', description: String((err as Error)?.message ?? err), color: 'error' })
    }
  } finally {
    posting.value = false
  }
}

onMounted(fetchDiagnosis)
onUnmounted(stopPoll)

watch(diagnosis, (val) => {
  if (val?.status === 'running') startPoll()
  else stopPoll()
})

const categoryColors: Record<string, 'error' | 'warning' | 'info' | 'secondary' | 'neutral'> = {
  'app-bug': 'error',
  'test-bug': 'warning',
  'flaky-test': 'warning',
  'infrastructure': 'info',
  'environment': 'secondary',
  'unknown': 'neutral'
}

const confidenceColors: Record<string, 'success' | 'warning' | 'neutral'> = {
  high: 'success',
  medium: 'warning',
  low: 'neutral'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const details = computed(() => diagnosis.value?.details as any)

function formatTokens(i: number | null, o: number | null) {
  if (i == null && o == null) return ''
  return `${i ?? 0} in / ${o ?? 0} out tokens`
}

function isStale(d: FailureDiagnosis) {
  if (d.status !== 'running') return false
  return Date.now() - new Date(d.updatedAt).getTime() > 5 * 60 * 1000
}

function copyToClipboard(text: string | null) {
  if (text) window.navigator.clipboard?.writeText(text)
}
</script>

<template>
  <div class="space-y-4">
    <!-- Context preview + additional context (detail page only) -->
    <template v-if="showContextPreview && aiStatus?.configured">
      <!-- Context preview collapsible -->
      <div class="rounded-lg border border-default overflow-hidden">
        <button
          class="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium bg-elevated hover:bg-accented transition-colors"
          @click="contextOpen = !contextOpen"
        >
          <span class="flex items-center gap-2">
            <UIcon name="i-lucide-file-text" class="size-4 text-gray-500" />
            Preview what will be sent to AI
          </span>
          <UIcon :name="contextOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-4 text-gray-400" />
        </button>
        <div v-if="contextOpen" class="p-4 border-t border-default">
          <div v-if="loadingContext" class="flex items-center gap-2 text-sm text-gray-500">
            <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
            <span>Loading context…</span>
          </div>
          <pre v-else class="text-xs font-mono bg-muted rounded p-3 overflow-x-auto max-h-96 whitespace-pre-wrap">{{ contextText }}</pre>
        </div>
      </div>

      <!-- Additional context textarea (always visible) -->
      <UFormField
        label="Additional context"
        description="Appended to the AI prompt — paste relevant code changes, recent deployments, or any observations that might help"
      >
        <UTextarea
          v-model="additionalContext"
          placeholder="e.g. We recently updated the auth middleware, this may be related to the login redirect…"
          :rows="3"
          class="w-full text-sm"
        />
      </UFormField>
    </template>

    <!-- Not configured + no diagnosis: render nothing -->
    <template v-if="!aiStatus?.configured && !diagnosis" />

    <!-- Configured but no diagnosis yet -->
    <div v-else-if="!diagnosis && aiStatus?.configured">
      <UButton
        icon="i-lucide-sparkles"
        size="sm"
        color="primary"
        variant="soft"
        :loading="posting"
        @click="diagnose()"
      >
        Diagnose with AI
      </UButton>
    </div>

    <!-- Running -->
    <div
      v-else-if="diagnosis && diagnosis.status === 'running' && !isStale(diagnosis)"
      class="flex items-center gap-2 text-sm text-gray-500"
    >
      <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
      <span>Analyzing failure cluster… this can take a minute</span>
    </div>

    <!-- Completed -->
    <div
      v-else-if="diagnosis && diagnosis.status === 'completed'"
      class="space-y-3 rounded-lg border border-default p-4 bg-elevated/30"
    >
      <div class="flex flex-wrap items-center gap-1.5">
        <UIcon name="i-lucide-sparkles" class="size-4 text-primary shrink-0" />
        <span class="text-sm font-medium text-gray-700 dark:text-gray-300">AI Diagnosis</span>
        <UBadge
          v-if="diagnosis.category"
          :color="categoryColors[diagnosis.category] || 'neutral'"
          variant="subtle"
          size="sm"
        >
          {{ diagnosis.category }}
        </UBadge>
        <UBadge
          v-if="diagnosis.confidence"
          :color="confidenceColors[diagnosis.confidence] || 'neutral'"
          variant="outline"
          size="sm"
        >
          {{ diagnosis.confidence }} confidence
        </UBadge>
      </div>

      <p v-if="diagnosis.summary" class="text-sm font-medium">
        {{ diagnosis.summary }}
      </p>

      <p v-if="diagnosis.rootCause" class="text-sm text-gray-600 dark:text-gray-400">
        {{ diagnosis.rootCause }}
      </p>

      <ul v-if="details?.evidence?.length" class="list-disc list-inside space-y-1">
        <li
          v-for="(e, i) in details.evidence"
          :key="i"
          class="text-sm text-gray-600 dark:text-gray-400"
        >
          {{ e }}
        </li>
      </ul>

      <div v-if="details?.suggestedFix">
        <p class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Suggested fix
        </p>
        <p class="text-sm text-gray-600 dark:text-gray-400">
          {{ details.suggestedFix.description }}
        </p>
        <code v-if="details.suggestedFix.file" class="block text-xs font-mono mt-1 text-primary">{{ details.suggestedFix.file }}</code>
        <div v-if="details.suggestedFix.code" class="relative mt-2">
          <pre class="text-xs font-mono bg-muted rounded p-3 overflow-x-auto">{{ details.suggestedFix.code }}</pre>
          <UButton
            icon="i-lucide-copy"
            size="xs"
            color="neutral"
            variant="ghost"
            class="absolute top-1 right-1"
            title="Copy code"
            @click="copyToClipboard(details.suggestedFix.code)"
          />
        </div>
      </div>

      <ul v-if="details?.preventionTips?.length" class="space-y-1">
        <li class="text-xs font-medium text-gray-500 uppercase tracking-wide">
          Prevention tips
        </li>
        <li
          v-for="(t, i) in details.preventionTips"
          :key="i"
          class="text-sm text-gray-600 dark:text-gray-400 flex gap-1.5"
        >
          <UIcon name="i-lucide-lightbulb" class="size-3.5 shrink-0 mt-0.5 text-yellow-500" />
          {{ t }}
        </li>
      </ul>

      <div class="flex items-center justify-between text-xs text-gray-400 pt-1 border-t border-default">
        <span>{{ diagnosis.model }} · {{ formatTokens(diagnosis.inputTokens, diagnosis.outputTokens) }} · {{ formatRelativeTime(diagnosis.updatedAt) }}</span>
        <UButton
          icon="i-lucide-refresh-cw"
          size="xs"
          color="neutral"
          variant="ghost"
          :loading="posting"
          @click="diagnose(true)"
        >
          Re-diagnose
        </UButton>
      </div>
    </div>

    <!-- Failed / stale -->
    <div v-else-if="diagnosis && (diagnosis.status === 'failed' || isStale(diagnosis))" class="space-y-2">
      <UAlert color="error" title="Diagnosis failed" :description="diagnosis.error || 'Unknown error'" />
      <UButton
        icon="i-lucide-refresh-cw"
        size="sm"
        color="neutral"
        variant="soft"
        :loading="posting"
        @click="diagnose(true)"
      >
        Retry
      </UButton>
    </div>
  </div>
</template>
