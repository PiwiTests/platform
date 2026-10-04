<script setup lang="ts">
/**
 * A failure cluster's activity: the fix attempts reported on it, with each
 * outcome the runs gave them, and the writes agents made to it over MCP. Shown
 * only once there is something to show.
 */
import type { ClusterActivityItem } from '#shared/handlers/cluster-activity';
import type { HelpTopicKey } from '~/utils/help-content';

const props = withDefaults(defineProps<{ clusterId: number; help?: HelpTopicKey }>(), {
  help: 'cluster.activity',
});

const items = ref<ClusterActivityItem[]>([]);

async function load() {
  try {
    const res = await $fetch<{ items: ClusterActivityItem[] }>(`/api/failure-clusters/${props.clusterId}/activity`);
    items.value = res.items;
  } catch {
    items.value = [];
  }
}
watch(() => props.clusterId, load, { immediate: true });
defineExpose({ refresh: load });

/** The dot of an attempt's outcome, in the test outcome colors; a call keeps the neutral dot. */
function dotClass(item: ClusterActivityItem): string {
  if (item.status === 'verified') return STATUS_PALETTE.passed.bg;
  if (item.status === 'regressed' || item.status === 'error') return STATUS_PALETTE.failed.bg;
  return 'bg-accented';
}

function who(item: ClusterActivityItem): string | null {
  const parts = [item.user, item.apiKey ? `key “${item.apiKey}”` : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}
</script>

<template>
  <SectionCard
    v-if="items.length"
    title="Activity"
    icon="i-lucide-history"
    :count="items.length"
    :help="help"
    data-shot="cluster-activity"
  >
    <ol class="space-y-2">
      <li v-for="(item, i) in items" :key="i" class="flex items-start gap-2">
        <span class="mt-1.5 size-2 shrink-0 rounded-full" :class="dotClass(item)" aria-hidden="true" />
        <div class="min-w-0">
          <p class="text-sm text-highlighted leading-relaxed break-words">{{ item.text }}</p>
          <p class="text-xs text-muted">
            <ClientOnly>
              <span :title="prettyDateFormat(item.at)">{{ formatRelativeTime(item.at) }}</span>
            </ClientOnly>
            <template v-if="who(item)"> · {{ who(item) }}</template>
            <template v-if="item.commit">
              · <span class="font-mono">{{ item.commit.slice(0, 7) }}</span></template
            >
            <template v-if="item.runId">
              ·
              <NuxtLink
                :to="`/test-runs/${item.runId}`"
                class="underline decoration-dotted underline-offset-2 hover:decoration-solid"
                >run #{{ item.runId }}</NuxtLink
              >
            </template>
          </p>
        </div>
      </li>
    </ol>
  </SectionCard>
</template>
