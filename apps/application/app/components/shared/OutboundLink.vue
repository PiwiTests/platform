<script setup lang="ts">
/**
 * A link to a page outside Piwi (an Atlassian or Slack settings page, a vendor
 * guide) inside a sentence: it keeps the sentence's color, opens in a new tab
 * with `rel` hardening, and carries the external-link icon. Documentation links
 * use `DocLink` instead.
 */
defineProps<{ href: string }>();
</script>

<template>
  <a :href="href" target="_blank" rel="noopener noreferrer" :class="SENTENCE_LINK_CLASS"
    ><slot /><UIcon name="i-lucide-external-link" class="ms-0.5 inline-block size-3 align-[-1px]"
  /></a>
</template>
