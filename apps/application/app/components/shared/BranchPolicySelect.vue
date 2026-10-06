<script setup lang="ts">
/**
 * What a branch filter with nothing picked reads: the default branch, or every
 * branch. Picking branches by hand overrides it, so callers show it beside the
 * branch select only while none is picked. Attributes land on the select.
 */
import type { HelpTopicKey } from '~/utils/help-content';

defineOptions({ inheritAttrs: false });

const allBranches = defineModel<boolean>({ required: true });

const props = defineProps<{
  /** Names the default branch in its option, where one project's is known. */
  defaultBranch?: string | null;
  help?: HelpTopicKey;
}>();

const items = computed(() => [
  { label: props.defaultBranch ? `Default branch (${props.defaultBranch})` : 'Default branch', value: 'default' },
  { label: 'All branches', value: 'all' },
]);

const policy = computed({
  get: () => (allBranches.value ? 'all' : 'default'),
  set: (value: string) => {
    allBranches.value = value === 'all';
  },
});
</script>

<template>
  <div class="flex items-center gap-1">
    <USelect
      v-model="policy"
      :items="items"
      size="sm"
      icon="i-lucide-git-branch"
      class="min-w-[150px]"
      aria-label="Branch policy"
      v-bind="$attrs"
    />
    <HelpHint v-if="help" :topic="help" />
  </div>
</template>
