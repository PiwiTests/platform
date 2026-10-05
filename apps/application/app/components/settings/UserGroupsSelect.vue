<script setup lang="ts">
/**
 * Picks the groups a user belongs to, shown as their names. With `deferred`,
 * the picks made while the menu is open are reported once, when it closes, so
 * a caller saving each change sends one request per edit rather than per tick.
 */
import type { GroupListItem } from '#shared/project-access';

const props = defineProps<{
  modelValue: number[];
  groups: GroupListItem[];
  deferred?: boolean;
  ariaLabel?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{ 'update:modelValue': [ids: number[]] }>();

const items = computed(() => props.groups.map((group) => ({ label: group.name, value: group.id })));

const isOpen = ref(false);
const draft = ref<number[]>([]);
const shown = computed(() => (props.deferred && isOpen.value ? draft.value : props.modelValue));
const sameIds = (a: number[], b: number[]) => a.length === b.length && a.every((id) => b.includes(id));

function onUpdate(ids: number[]) {
  if (props.deferred) draft.value = ids;
  else emit('update:modelValue', ids);
}

function onOpen(open: boolean) {
  isOpen.value = open;
  if (!props.deferred) return;
  if (open) draft.value = [...props.modelValue];
  else if (!sameIds(draft.value, props.modelValue))
    emit(
      'update:modelValue',
      [...draft.value].sort((a, b) => a - b),
    );
}
</script>

<template>
  <USelectMenu
    :model-value="shown"
    :items="items"
    value-key="value"
    multiple
    :placeholder="groups.length === 0 ? 'No groups yet' : 'No groups'"
    :disabled="disabled || groups.length === 0"
    :aria-label="ariaLabel"
    :search-input="{ placeholder: 'Filter groups…' }"
    class="w-full"
    @update:model-value="onUpdate($event as number[])"
    @update:open="onOpen"
  />
</template>
