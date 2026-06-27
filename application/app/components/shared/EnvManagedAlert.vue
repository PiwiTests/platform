<script setup lang="ts">
/**
 * Standard banner shown at the top of a settings card (or page) when one or
 * more of its fields are pinned by `PIWI_*` environment variables. Replaces
 * the ad-hoc `UAlert`s that previously lived in the AI and wasted-time pages.
 *
 * Always links to the configuration reference so a system admin can jump to the
 * canonical env-var documentation.
 */
import type { PiwiEnvVarName } from '~~/shared/piwi-env-vars';

const props = withDefaults(
  defineProps<{
    /** Env var(s) responsible for the lock; listed in the description. */
    envVars?: PiwiEnvVarName[];
    /** Override the default title. */
    title?: string;
    /** Override the default description (otherwise derived from envVars). */
    description?: string;
  }>(),
  {},
);

const title = computed(() => props.title ?? 'Managed by environment variables');
</script>

<template>
  <UAlert icon="i-lucide-lock" color="neutral" variant="subtle" :title="title">
    <template #description>
      <span v-if="description">{{ description }}</span>
      <span v-else-if="envVars?.length">
        These settings are pinned by
        <template v-for="(v, i) in envVars" :key="v">
          <code class="font-mono text-xs">{{ v }}</code
          ><span v-if="i < envVars.length - 1">, </span>
        </template>
        and cannot be changed here. Edit the environment and restart to change them.
      </span>
      <span v-else> These settings are pinned by environment variables and cannot be changed here. </span>
    </template>
  </UAlert>
</template>
