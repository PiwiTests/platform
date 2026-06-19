<script setup lang="ts">
export interface ErrorCardCluster {
  id: number;
  sameRunCaseCount: number;
  isNew: boolean;
  firstSeenRunId: number;
  firstSeenAt: string | Date | null;
  status?: string | null;
  triageNote?: string | null;
}

const props = defineProps<{
  cluster?: ErrorCardCluster | null;
}>();

const showCluster = computed(() => !!props.cluster && (props.cluster.sameRunCaseCount > 1 || !props.cluster.isNew));
</script>

<template>
  <UCard>
    <div
      v-if="cluster"
      class="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 dark:text-gray-400"
    >
      <UIcon name="i-lucide-layers" class="size-3.5 shrink-0" />
      <template v-if="showCluster">
        <span v-if="cluster.sameRunCaseCount > 1">
          Matches {{ cluster.sameRunCaseCount - 1 }} other failing
          {{ cluster.sameRunCaseCount - 1 === 1 ? 'test' : 'tests' }} in this run
        </span>
        <UBadge v-if="cluster.isNew" color="warning" variant="subtle" size="sm"> New failure </UBadge>
        <span v-else>
          <template v-if="cluster.sameRunCaseCount > 1">· </template>Known failure — first seen in
          <NuxtLink :to="`/test-runs/${cluster.firstSeenRunId}`" class="text-primary hover:underline">
            run #{{ cluster.firstSeenRunId }}
          </NuxtLink>
          <template v-if="cluster.firstSeenAt"> ({{ formatRelativeTime(cluster.firstSeenAt) }}) </template>
        </span>
        <UBadge
          v-if="cluster.status && cluster.status !== 'open'"
          :color="cluster.status === 'resolved' ? 'success' : 'neutral'"
          variant="subtle"
          size="sm"
        >
          {{ cluster.status }}
        </UBadge>
        <span v-if="cluster.triageNote" class="italic" :title="cluster.triageNote"> — {{ cluster.triageNote }} </span>
      </template>
      <template v-else>
        <UBadge v-if="cluster.isNew" color="warning" variant="subtle" size="sm">New failure</UBadge>
      </template>
      <UButton
        size="xs"
        variant="ghost"
        color="primary"
        trailing-icon="i-lucide-arrow-right"
        class="ml-auto -mr-1"
        :to="`/failure-clusters/${cluster.id}`"
      >
        View cluster
      </UButton>
    </div>

    <ClusterDiagnosis v-if="cluster" :cluster-id="cluster.id" />
  </UCard>
</template>
