<script setup lang="ts">
/**
 * Shared field set for the project create form and the General section of the
 * project settings, so the two never drift. Render inside a `<UForm>` (the
 * parent owns the schema, submit and footer). `create` adds the immutable
 * `name`; both show label, description and tags.
 */
import type { TagInfo } from '~~/types/api';

defineProps<{
  mode: 'create' | 'edit';
  allTags: TagInfo[];
}>();

const emit = defineEmits<{ 'tag-created': [] }>();

const name = defineModel<string>('name', { default: '' });
const label = defineModel<string>('label', { default: '' });
const description = defineModel<string>('description', { default: '' });
const tags = defineModel<TagInfo[]>('tags', { default: () => [] });
</script>

<template>
  <div class="space-y-5">
    <UFormField
      v-if="mode === 'create'"
      label="Project name"
      name="name"
      required
      description="A unique identifier used to match test results from the reporter."
    >
      <UInput v-model="name" placeholder="e.g. my-app" class="w-full" />
    </UFormField>

    <UFormField
      label="Display label"
      name="label"
      description="A friendly name shown in the UI (defaults to project name if not set)."
    >
      <UInput v-model="label" placeholder="e.g. My Application" class="w-full" />
    </UFormField>

    <UFormField label="Description" name="description" description="Optional description of this project.">
      <UTextarea v-model="description" placeholder="Enter project description" :rows="3" class="w-full" />
    </UFormField>

    <UFormField
      label="Tags"
      name="tags"
      description="Select existing tags or type a new name and press Enter to create one."
    >
      <TagsSelect v-model="tags" :all-tags="allTags" class="w-full" @tag-created="emit('tag-created')" />
    </UFormField>
  </div>
</template>
