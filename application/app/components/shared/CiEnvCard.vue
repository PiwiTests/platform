<script setup lang="ts">
interface CiInfo {
  provider?: string;
  buildNumber?: string;
  buildUrl?: string;
  workflow?: string;
  jobName?: string;
}

defineProps<{
  ci?: CiInfo | null;
  environment?: string | null;
  class?: string;
}>();
</script>

<template>
  <BlockCard :class="$props.class" title="CI / Env" icon="i-lucide-cloud" help="run.ci-env">
    <div class="space-y-2 text-sm">
      <div v-if="environment" class="flex items-center gap-1.5">
        <UIcon name="i-lucide-server" class="w-3.5 h-3.5 text-gray-400 shrink-0" />
        <span class="rounded-full border px-2 py-0.5 text-xs bg-gray-50 dark:bg-gray-800">{{ environment }}</span>
      </div>
      <div v-if="ci?.provider" class="flex items-center gap-1.5">
        <UIcon name="i-lucide-cloud" class="w-3.5 h-3.5 text-gray-400 shrink-0" />
        <span>{{ ci.provider }}</span>
      </div>
      <div v-if="ci?.buildNumber" class="flex items-center gap-1.5">
        <UIcon name="i-lucide-hash" class="w-3.5 h-3.5 text-gray-400 shrink-0" />
        <span>Build #{{ ci.buildNumber }}</span>
      </div>
      <div v-if="ci?.jobName" class="flex items-center gap-1.5">
        <UIcon name="i-lucide-notebook-pen" class="w-3.5 h-3.5 text-gray-400 shrink-0" />
        <span>{{ ci.jobName }}</span>
      </div>
      <div v-if="ci?.workflow" class="flex items-center gap-1.5">
        <UIcon name="i-lucide-workflow" class="w-3.5 h-3.5 text-gray-400 shrink-0" />
        <span>{{ ci.workflow }}</span>
      </div>
      <div v-if="ci?.buildUrl" class="flex items-center gap-1.5">
        <UIcon name="i-lucide-external-link" class="w-3.5 h-3.5 text-gray-400 shrink-0" />
        <a :href="ci.buildUrl" target="_blank" class="text-primary hover:underline text-xs">View build</a>
      </div>
    </div>
  </BlockCard>
</template>
