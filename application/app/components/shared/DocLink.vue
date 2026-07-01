<script setup lang="ts">
/**
 * Standardized "Learn more →" external documentation link. Takes a docs path
 * (page + optional `#anchor`), runs it through `docsUrl()`, and opens it in a
 * new tab with `rel` hardening and the external-link icon. Used inside
 * `HelpHint` and anywhere a standalone doc link is wanted, so the whole app
 * links to docs one way.
 */
import { docsUrl } from '#shared/docs';

const props = defineProps<{
  /** Docs page + optional `#anchor`, passed through `docsUrl()`. */
  to: string;
  /** Hide the trailing external-link icon (for tight inline usage). */
  noIcon?: boolean;
}>();

const href = computed(() => docsUrl(props.to));
</script>

<template>
  <ULink
    :to="href"
    target="_blank"
    rel="noopener noreferrer"
    class="inline-flex items-center gap-1 text-primary hover:underline"
  >
    <slot>Learn more</slot>
    <UIcon v-if="!noIcon" name="i-lucide-external-link" class="w-3.5 h-3.5 shrink-0" />
  </ULink>
</template>
