<script setup lang="ts">
/**
 * Standardized `UFormField` for the Settings pages. Renders a label row with an
 * inline `HelpHint` (which surfaces the backing `PIWI_*` env var(s) when the
 * topic carries them) and an `EnvManagedBadge` lock when the field is
 * env-pinned. Use this for every editable settings field so the surface stays
 * homogeneous and every field documents its env var.
 *
 * The default slot receives the control; `#trailing` is forwarded into the
 * field's trailing slot (handy for the lock icon on `UInput`).
 */
import type { HelpTopicKey } from '~/utils/help-content';
import { helpEnvVars } from '~/utils/help-content';
import type { PiwiEnvVarName } from '~~/shared/piwi-env-vars';

const props = withDefaults(
  defineProps<{
    label: string;
    /** Help-registry topic key — rendered as a `HelpHint` next to the label. */
    help?: HelpTopicKey;
    /** Explicit env var(s); defaults to the topic's `envVars`. */
    envVars?: PiwiEnvVarName[];
    /** Mark the field as locked by env (renders the lock badge). */
    envManaged?: boolean;
    /** Forwarded to `UFormField`. */
    description?: string;
    /** Forwarded to `UFormField`. */
    hint?: string;
    /** Forwarded to `UFormField`. */
    required?: boolean;
    /** Forwarded to `UFormField`. */
    name?: string;
    /** Forwarded to `UFormField`. */
    disabled?: boolean;
  }>(),
  {},
);

const resolvedEnvVars = computed<PiwiEnvVarName[] | undefined>(() => {
  if (props.envVars) return props.envVars;
  if (props.help) return helpEnvVars(props.help);
  return undefined;
});
</script>

<template>
  <UFormField
    :label="label"
    :description="description"
    :hint="hint"
    :required="required"
    :name="name"
    :disabled="disabled || envManaged"
  >
    <template #label>
      <span class="inline-flex items-center gap-1">
        {{ label }}
        <HelpHint v-if="help" :topic="help" />
        <EnvManagedBadge v-if="envManaged" :env-vars="resolvedEnvVars" />
      </span>
    </template>

    <slot />

    <template v-if="$slots.trailing" #trailing>
      <slot name="trailing" />
    </template>
  </UFormField>
</template>
