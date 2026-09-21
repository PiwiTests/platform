<script setup lang="ts">
/**
 * "What do you want Piwi for?" — the coarse capability presets, shown on the
 * Setup page and in the Home wizard. Seeing why tests fail is always on; the
 * other three modules are opt-out checkboxes. Unchecking a module declines
 * every capability in it at instance level; re-checking clears those decisions.
 *
 * Renders nothing unless the viewer may decide (administrators, and everyone
 * when auth is disabled).
 */
import type { HelpTopicKey } from '~/utils/help-content';
import { CAPABILITY_PRESETS, capabilitiesForModule, type CapabilityModule } from '#shared/capabilities';

defineProps<{
  /** Inline-help topic rendered beside the heading. */
  help?: HelpTopicKey;
}>();

const { state, canDecide, decide } = useInstanceCapabilities();

const busy = ref(false);

/** A module is on unless every capability in it is declined. */
function isOn(module: CapabilityModule): boolean {
  const ids = capabilitiesForModule(module);
  return !ids.every((id) => state(id) === 'declined');
}

async function toggle(module: CapabilityModule, checked: boolean) {
  if (busy.value) return;
  busy.value = true;
  try {
    for (const id of capabilitiesForModule(module)) {
      await decide(id, checked ? null : 'declined');
    }
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <SectionCard v-if="canDecide" title="What do you want Piwi for?" :help="help" embedded>
    <div class="flex flex-col gap-3">
      <div v-for="preset in CAPABILITY_PRESETS" :key="preset.module" class="flex items-start gap-3">
        <UCheckbox
          :model-value="preset.module === 'core' ? true : isOn(preset.module)"
          :disabled="preset.module === 'core' || busy"
          :aria-label="preset.label"
          class="mt-0.5 shrink-0"
          @update:model-value="toggle(preset.module, $event === true)"
        />
        <div class="min-w-0">
          <p class="text-sm text-highlighted leading-relaxed">{{ preset.label }}</p>
          <p class="text-xs text-muted">{{ preset.description }}</p>
        </div>
      </div>
    </div>
  </SectionCard>
</template>
