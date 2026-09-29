<script setup lang="ts">
/**
 * A tracker issue as a compact chip — the provider icon and the key — linking
 * to the issue in a new tab. Rows use it to show the issue an execution's (or a
 * cluster's) failure is tracked in; a click never triggers the row's own link.
 * The link is a flex box, so the badge centers in a row of badges rather than
 * sitting on the text baseline.
 */
import { getProviderIcon, type LinkProvider } from '#shared/link-detect';

const props = defineProps<{
  issue: { key: string | null; url: string; provider: string; status?: string | null };
}>();

const title = computed(() => {
  const label = props.issue.key ?? props.issue.url;
  return props.issue.status ? `Known issue: ${label} (${props.issue.status})` : `Known issue: ${label}`;
});
</script>

<template>
  <a
    :href="issue.url"
    target="_blank"
    rel="noopener noreferrer"
    class="inline-flex shrink-0"
    :title="title"
    data-testid="issue-key-chip"
    @click.stop
  >
    <UBadge color="neutral" variant="subtle" size="xs" class="gap-1">
      <UIcon :name="getProviderIcon(issue.provider as LinkProvider)" class="size-3" />
      {{ issue.key ?? 'Issue' }}
    </UBadge>
  </a>
</template>
