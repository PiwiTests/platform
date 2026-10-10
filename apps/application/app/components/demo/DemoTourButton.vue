<script setup lang="ts">
/** The demo banner's **Guided tour** button, in the tour language: it opens the tour's prompt. */
const { t, openPrompt } = useDemoTour();
</script>

<template>
  <UButton
    color="warning"
    variant="soft"
    size="xs"
    icon="i-lucide-compass"
    :label="t('launch')"
    :title="t('launchTitle')"
    data-testid="tour-launch"
    @click="openPrompt"
  />
</template>
