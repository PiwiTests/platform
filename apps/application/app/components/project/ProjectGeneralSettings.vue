<script setup lang="ts">
/**
 * Project settings → General: the read-only project key, then the label,
 * description and tags shared with the create form.
 */
import type { ProjectWithTestRuns, TagsResponse } from '~~/types/api';

const props = defineProps<{ project: ProjectWithTestRuns }>();
const emit = defineEmits<{ saved: [] }>();

const { data: tagsData, refresh: refreshTags } = await useFetch<TagsResponse>('/api/tags');
const allTags = computed(() => tagsData.value?.items || []);

const { state, dirty } = useStoredForm(() => ({
  label: props.project.label || '',
  description: props.project.description || '',
  tags: props.project.tags || [],
}));

const { saving, save } = useProjectPatch(() => props.project.id);

async function submit() {
  const stored = await save(
    {
      label: state.value.label || null,
      description: state.value.description || null,
      tagIds: state.value.tags.map((t) => t.id),
    },
    'Project updated',
  );
  if (stored) emit('saved');
}
</script>

<template>
  <UForm :state="state" @submit="submit">
    <SectionCard icon="i-lucide-settings" title="General" subtitle="How this project is named and grouped">
      <div class="space-y-5">
        <UFormField label="Project key" description="Matches the results the reporter sends; it cannot be changed.">
          <p class="font-mono text-sm text-highlighted break-all">{{ project.name }}</p>
        </UFormField>
        <ProjectFormFields
          v-model:label="state.label"
          v-model:description="state.description"
          v-model:tags="state.tags"
          mode="edit"
          :all-tags="allTags"
          @tag-created="refreshTags()"
        />
      </div>

      <template #footer>
        <div class="flex justify-end">
          <UButton type="submit" icon="i-lucide-check" :loading="saving" :disabled="!dirty">Save changes</UButton>
        </div>
      </template>
    </SectionCard>
  </UForm>
</template>
