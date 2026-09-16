<script setup lang="ts">
/**
 * The facts line under the cluster's situation block: a Details popover (owner
 * and known-issue editing), the shared "Raw error ▸" disclosure (the sample
 * error and its fingerprint signature) and Copy summary. `revealRawError()` lets
 * a citation open the raw error from elsewhere on the page.
 */
import type { FailureClusterDetail } from '~~/types/api';

defineProps<{
  cluster: FailureClusterDetail;
  canWrite: boolean;
  signatureLine: string | null;
}>();

const emit = defineEmits<{ refresh: []; copy: [] }>();

const disclosure = ref<{ reveal: () => void } | null>(null);
function revealRawError() {
  disclosure.value?.reveal();
}
defineExpose({ revealRawError });
</script>

<template>
  <div class="flex items-center gap-x-3 gap-y-1 flex-wrap text-xs text-muted">
    <UPopover>
      <UButton
        size="xs"
        variant="ghost"
        color="neutral"
        trailing-icon="i-lucide-chevron-down"
        label="Details"
        class="shrink-0"
      />
      <template #content>
        <div class="p-3 space-y-3 text-sm w-72">
          <div class="space-y-1">
            <p class="text-xs font-medium text-muted uppercase tracking-wide">Owner</p>
            <ClusterOwnerLine :owner="cluster.owner" :project-id="cluster.project?.id ?? null" />
          </div>
          <div class="space-y-1">
            <div class="flex items-center gap-1.5 text-xs">
              <UIcon name="i-lucide-link" class="size-3.5 shrink-0 text-gray-400" />
              <span class="text-muted uppercase tracking-wide font-medium">Known issue</span>
              <HelpHint topic="cluster.known-issue" />
            </div>
            <EntityLinks
              entity-type="failure_cluster"
              :entity-id="cluster.id"
              :links="cluster.links"
              :readonly="!canWrite"
              @updated="emit('refresh')"
            />
          </div>
        </div>
      </template>
    </UPopover>

    <RawErrorDisclosure ref="disclosure" :error="cluster.sampleError" :signature="signatureLine" />

    <UButton size="xs" variant="ghost" color="neutral" label="Copy summary" class="shrink-0" @click="emit('copy')" />
  </div>
</template>
