<script setup lang="ts">
/**
 * Wraps a settings page whose capability can be declined. The page keeps
 * answering its URL: when the capability is declined at instance level it shows
 * one line instead of the settings, with a *Reconsider* link to Setup for an
 * administrator and a plain naming line for anyone else. Otherwise the page
 * renders as usual.
 */
import type { CapabilityId } from '#shared/capabilities';

const props = defineProps<{
  capability: CapabilityId;
  /** What the capability is called, for the non-administrator naming line. */
  label: string;
}>();

const { state, canDecide } = useInstanceCapabilities();
const declined = computed(() => state(props.capability) === 'declined');
</script>

<template>
  <div v-if="declined" class="py-6 text-sm text-muted">
    <p v-if="canDecide">
      Declined on Setup ·
      <NuxtLink to="/setup" :class="SENTENCE_LINK_CLASS">Reconsider</NuxtLink>
    </p>
    <p v-else>{{ label }} is turned off for this instance.</p>
  </div>
  <slot v-else />
</template>
