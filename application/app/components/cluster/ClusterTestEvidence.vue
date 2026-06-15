<script setup lang="ts">
import type { TraceInfo, AttachmentInfo } from '~~/types/api';

interface AffectedCase {
  testCaseId: number;
  title: string;
  filePath: string;
  runCount: number;
  recentTestRunsCaseId: number;
}

interface TestCaseDetail {
  id: number;
  error?: string | null;
  steps?: unknown;
  consoleLogs?: unknown;
  networkRequests?: unknown;
  ariaSnapshot?: string | null;
  testSource?: string | null;
  attachments: AttachmentInfo[];
}

const props = defineProps<{
  affectedTestCases: AffectedCase[];
}>();

const selectedId = ref(props.affectedTestCases[0]?.recentTestRunsCaseId ?? null);
const selectedCase = computed(() => props.affectedTestCases.find((c) => c.recentTestRunsCaseId === selectedId.value));

const caseDetail = ref<TestCaseDetail | null>(null);
const traces = ref<TraceInfo[]>([]);
const loading = ref(false);
const tracesLoading = ref(false);

async function loadCase(id: number) {
  loading.value = true;
  tracesLoading.value = true;
  caseDetail.value = null;
  traces.value = [];

  const [detail, traceList] = await Promise.allSettled([
    $fetch<TestCaseDetail>(`/api/test-cases/${id}`),
    $fetch<TraceInfo[]>(`/api/test-cases/${id}/traces`),
  ]);

  if (detail.status === 'fulfilled') caseDetail.value = detail.value;
  loading.value = false;

  if (traceList.status === 'fulfilled') traces.value = traceList.value;
  tracesLoading.value = false;
}

watch(selectedId, (id) => {
  if (id) loadCase(id);
});

onMounted(() => {
  if (selectedId.value) loadCase(selectedId.value);
});

// Failing steps — keep only steps that have errors
const failingSteps = computed(() => {
  const steps = caseDetail.value?.steps;
  if (!Array.isArray(steps)) return [];
  return steps.filter((s: { error?: unknown }) => s.error) as Array<{ title?: string; error?: { message?: string } }>;
});

const showSteps = ref(false);
const showAriaSnapshot = ref(false);
</script>

<template>
  <div class="space-y-3">
    <!-- Test case selector -->
    <div v-if="affectedTestCases.length > 1" class="flex items-start gap-2 flex-wrap">
      <span class="text-xs text-gray-500 font-medium shrink-0 mt-1">Case</span>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="tc in affectedTestCases"
          :key="tc.recentTestRunsCaseId"
          class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors"
          :class="
            selectedId === tc.recentTestRunsCaseId
              ? 'bg-primary text-white border-primary'
              : 'text-gray-600 dark:text-gray-400 border-default hover:border-primary/50 bg-elevated'
          "
          @click="selectedId = tc.recentTestRunsCaseId"
        >
          <span class="truncate max-w-[18ch]">{{ tc.title.split(' › ').pop() }}</span>
          <span class="opacity-60">{{ tc.runCount }}×</span>
        </button>
      </div>
    </div>

    <!-- Test file location -->
    <p v-if="selectedCase" class="text-xs font-mono text-gray-400 truncate">{{ selectedCase.filePath }}</p>

    <div v-if="loading" class="flex items-center justify-center py-10">
      <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin text-gray-400" />
    </div>

    <template v-else-if="caseDetail">
      <!-- Test source code -->
      <TestEvidenceSection v-if="caseDetail.testSource" icon="i-lucide-code" label="Test source" :collapsible="false">
        <div class="overflow-x-auto max-h-64">
          <MarkdownPreview :text="'```typescript\n' + caseDetail.testSource + '\n```'" />
        </div>
      </TestEvidenceSection>

      <!-- Screenshots -->
      <TestEvidenceScreenshots :attachments="caseDetail.attachments" />

      <!-- Traces -->
      <TestEvidenceTraces :traces="traces" :loading="tracesLoading" />

      <!-- Failing steps (collapsible) -->
      <TestEvidenceSection
        v-if="failingSteps.length > 0"
        icon="i-lucide-list-checks"
        label="Failing steps"
        :count="failingSteps.length"
        v-model:open="showSteps"
      >
        <div class="divide-y divide-default">
          <div v-for="(step, idx) in failingSteps" :key="idx" class="px-3 py-2 space-y-0.5">
            <p class="text-xs font-medium text-gray-700 dark:text-gray-300">{{ step.title }}</p>
            <p v-if="step.error?.message" class="text-xs font-mono text-red-500 whitespace-pre-wrap break-all">
              {{ step.error.message }}
            </p>
          </div>
        </div>
      </TestEvidenceSection>

      <!-- ARIA snapshot (collapsible) -->
      <TestEvidenceSection
        v-if="caseDetail.ariaSnapshot"
        icon="i-lucide-accessibility"
        label="ARIA snapshot"
        v-model:open="showAriaSnapshot"
      >
        <div class="max-h-64 overflow-auto">
          <MarkdownPreview :text="'```yaml\n' + caseDetail.ariaSnapshot + '\n```'" />
        </div>
      </TestEvidenceSection>

      <!-- Console + network signals (collapsible) -->
      <TestEvidenceSignals :console-logs="caseDetail.consoleLogs" :network-requests="caseDetail.networkRequests" />
    </template>
  </div>
</template>
