<script setup lang="ts">
import type { MarkerInfo } from '~~/types/api';
import { MARKER_CATEGORIES, DEFAULT_MARKER_CATEGORY } from '#shared/marker-categories';

const props = defineProps<{
  open: boolean;
  projectId: number;
  /** When set, the modal edits this marker; otherwise it creates a new one. */
  marker?: MarkerInfo | null;
  /** Environment values seen in this project's runs, offered as suggestions. */
  environments?: string[];
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  saved: [];
}>();

const toast = useToast();

const categoryItems = MARKER_CATEGORIES.map((c) => ({ label: c.label, value: c.id, icon: c.icon }));

const state = reactive({
  label: '',
  occurredAt: '',
  category: DEFAULT_MARKER_CATEGORY,
  environment: '',
  description: '',
});

const isEdit = computed(() => !!props.marker);
const saving = ref(false);

function toLocalInput(value: string | Date): string {
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Populate the form whenever the modal opens (create → now, edit → marker).
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    if (props.marker) {
      state.label = props.marker.label;
      state.occurredAt = toLocalInput(props.marker.occurredAt);
      state.category = props.marker.category || DEFAULT_MARKER_CATEGORY;
      state.environment = props.marker.environment ?? '';
      state.description = props.marker.description ?? '';
    } else {
      state.label = '';
      state.occurredAt = toLocalInput(new Date());
      state.category = DEFAULT_MARKER_CATEGORY;
      state.environment = '';
      state.description = '';
    }
  },
);

async function handleSave() {
  if (!state.label.trim()) {
    toast.add({ title: 'Label is required', color: 'error' });
    return;
  }
  if (!state.occurredAt) {
    toast.add({ title: 'Date is required', color: 'error' });
    return;
  }

  saving.value = true;
  const body = {
    label: state.label.trim(),
    occurredAt: new Date(state.occurredAt).toISOString(),
    category: state.category,
    environment: state.environment.trim() || null,
    description: state.description.trim() || null,
  };

  try {
    if (props.marker) {
      await $fetch(`/api/markers/${props.marker.id}`, { method: 'PATCH', body });
      toast.add({ title: 'Marker updated', color: 'success' });
    } else {
      await $fetch(`/api/projects/${props.projectId}/markers`, { method: 'POST', body });
      toast.add({ title: 'Marker created', color: 'success' });
    }
    emit('update:open', false);
    emit('saved');
  } catch (error: unknown) {
    toast.add({
      title: isEdit.value ? 'Failed to update marker' : 'Failed to create marker',
      description: errorMessage(error),
      color: 'error',
    });
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <ClientOnly>
    <UModal :open="open" :title="isEdit ? 'Edit marker' : 'Add marker'" @update:open="emit('update:open', $event)">
      <template #body>
        <div class="space-y-4">
          <UFormField label="Label" name="label" required>
            <UInput v-model="state.label" placeholder="e.g. Migrated CI to new runners" class="w-full" />
          </UFormField>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <UFormField label="Date &amp; time" name="occurredAt" required>
              <UInput v-model="state.occurredAt" type="datetime-local" class="w-full" />
            </UFormField>

            <UFormField label="Category" name="category">
              <USelect v-model="state.category" :items="categoryItems" class="w-full" />
            </UFormField>
          </div>

          <UFormField label="Environment" name="environment" help="Optional. Leave empty to apply to all environments.">
            <UInput
              v-model="state.environment"
              list="marker-environments"
              placeholder="e.g. production"
              class="w-full"
            />
            <datalist id="marker-environments">
              <option v-for="env in environments || []" :key="env" :value="env" />
            </datalist>
          </UFormField>

          <UFormField label="Description" name="description">
            <UTextarea v-model="state.description" :rows="3" placeholder="Optional details" class="w-full" />
          </UFormField>
        </div>
      </template>

      <template #footer>
        <UButton color="neutral" variant="ghost" label="Cancel" @click="emit('update:open', false)" />
        <UButton
          :label="isEdit ? 'Save changes' : 'Add marker'"
          :icon="isEdit ? 'i-lucide-check' : 'i-lucide-plus'"
          :loading="saving"
          @click="handleSave"
        />
      </template>
    </UModal>
  </ClientOnly>
</template>
