<script setup lang="ts">
import type { TagInfo } from '~~/types/api';
import { randomHexColor } from '~/utils';

const props = defineProps<{
  modelValue: TagInfo[];
  allTags: TagInfo[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: TagInfo[]];
  tagCreated: [tag: TagInfo];
}>();

const toast = useToast();

async function handleCreate(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return;

  // If a tag with this text already exists, just select it
  const existing = props.allTags.find((t) => t.text.toLowerCase() === trimmed.toLowerCase());
  if (existing) {
    if (!props.modelValue.some((t) => t.id === existing.id)) {
      emit('update:modelValue', [...props.modelValue, existing]);
    }
    return;
  }

  // Create a new tag with a random color
  try {
    const result = await $fetch<{ tag: TagInfo }>('/api/tags', {
      method: 'POST',
      body: { text: trimmed, color: randomHexColor() },
    });
    emit('tagCreated', result.tag);
    emit('update:modelValue', [...props.modelValue, result.tag]);
  } catch (error: unknown) {
    const errorMessage =
      error && typeof error === 'object' && 'data' in error ? (error.data as { message?: string })?.message : undefined;
    toast.add({
      title: 'Failed to create tag',
      description: errorMessage || 'An error occurred',
      color: 'error',
    });
  }
}
</script>

<template>
  <USelectMenu
    :model-value="modelValue"
    :items="allTags"
    multiple
    create-item="always"
    label-key="text"
    by="id"
    placeholder="Select or create tags…"
    class="w-full"
    @update:model-value="emit('update:modelValue', $event as TagInfo[])"
    @create="handleCreate"
  >
    <template #default="{ modelValue: selected }">
      <div v-if="(selected as TagInfo[]).length" class="flex flex-wrap gap-1 py-0.5">
        <TagBadge v-for="tag in selected as TagInfo[]" :key="tag.id" :text="tag.text" :color="tag.color" />
      </div>
      <span v-else class="text-[var(--ui-text-muted)]">Select or create tags…</span>
    </template>

    <template #item-leading="{ item }">
      <span class="inline-block size-2 rounded-full shrink-0" :style="{ backgroundColor: (item as TagInfo).color }" />
    </template>
  </USelectMenu>
</template>
