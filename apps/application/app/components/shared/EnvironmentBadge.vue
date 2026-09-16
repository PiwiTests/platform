<script setup lang="ts">
/**
 * A deployment environment label (`production`, `staging`, …). By default the
 * outlined pill the run header uses; with `inline`, a subtle icon + name that
 * flows inside a sentence without the border breaking the line. Both keep the
 * server icon the filter bar pairs with environments, so an environment reads
 * the same everywhere. Renders "no environment" (muted) when the run has none.
 */
defineProps<{
  name: string | null | undefined;
  /** Borderless form for use inside flowing text. */
  inline?: boolean;
}>();
</script>

<template>
  <span
    class="inline-flex items-center gap-1 align-middle whitespace-nowrap"
    :class="[
      !name && 'text-muted',
      !inline && 'rounded-full border border-default px-2 py-0.5 leading-none bg-elevated/60',
    ]"
  >
    <UIcon name="i-lucide-server" class="size-3 shrink-0 text-muted" />
    {{ name ?? 'no environment' }}
  </span>
</template>
