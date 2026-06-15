<script setup lang="ts">
const props = defineProps<{
  consoleLogs: unknown;
  networkRequests: unknown;
}>();

interface ConsoleEntry {
  type: string;
  text: string;
}

interface NetworkRequest {
  status: number;
  url: string;
  method?: string;
}

const consoleErrors = computed((): ConsoleEntry[] => {
  if (!Array.isArray(props.consoleLogs)) return [];
  return props.consoleLogs.filter((l: ConsoleEntry) => l.type === 'error' || l.type === 'warning');
});

const failedRequests = computed((): NetworkRequest[] => {
  if (!Array.isArray(props.networkRequests)) return [];
  return props.networkRequests.filter((r: NetworkRequest) => r.status && r.status >= 400);
});

const hasSignals = computed(() => consoleErrors.value.length > 0 || failedRequests.value.length > 0);

const label = computed(() => {
  const parts = [];
  if (consoleErrors.value.length) parts.push(`${consoleErrors.value.length} console`);
  if (failedRequests.value.length) parts.push(`${failedRequests.value.length} network`);
  return parts.join(', ');
});

const open = ref(false);
</script>

<template>
  <TestEvidenceSection
    v-if="hasSignals"
    icon="i-lucide-triangle-alert"
    :label="`Signals (${label})`"
    v-model:open="open"
  >
    <div class="divide-y divide-default">
      <template v-if="consoleErrors.length > 0">
        <div class="px-3 py-1 bg-gray-50 dark:bg-gray-800/40">
          <p class="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Console</p>
        </div>
        <div v-for="(log, idx) in consoleErrors" :key="'log-' + idx" class="px-3 py-1.5 flex items-start gap-2">
          <UIcon
            :name="log.type === 'error' ? 'i-lucide-x-circle' : 'i-lucide-alert-triangle'"
            class="size-3.5 mt-0.5 shrink-0"
            :class="log.type === 'error' ? 'text-red-500' : 'text-yellow-500'"
          />
          <p class="text-xs font-mono text-gray-700 dark:text-gray-300 break-all whitespace-pre-wrap">{{ log.text }}</p>
        </div>
      </template>
      <template v-if="failedRequests.length > 0">
        <div class="px-3 py-1 bg-gray-50 dark:bg-gray-800/40">
          <p class="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Network</p>
        </div>
        <div v-for="(req, idx) in failedRequests" :key="'req-' + idx" class="px-3 py-1.5 flex items-center gap-2">
          <UBadge
            :color="req.status >= 500 ? 'error' : 'warning'"
            variant="subtle"
            size="sm"
            class="shrink-0 font-mono"
          >
            {{ req.status }}
          </UBadge>
          <p class="text-xs font-mono text-gray-600 dark:text-gray-400 truncate">{{ req.url }}</p>
        </div>
      </template>
    </div>
  </TestEvidenceSection>
</template>
