<script setup lang="ts">
const props = defineProps<{
  clusterId: number;
  initialStatus: string;
  initialNote: string;
}>();

const emit = defineEmits<{ saved: [] }>();

const triageStatus = ref(props.initialStatus);
const triageNote = ref(props.initialNote);
const saving = ref(false);

watch(
  () => props.initialStatus,
  (v) => {
    triageStatus.value = v;
  },
);
watch(
  () => props.initialNote,
  (v) => {
    triageNote.value = v;
  },
);

const triageOptions = [
  { label: 'Open', value: 'open' },
  { label: 'Resolved', value: 'resolved' },
  { label: 'Ignored', value: 'ignored' },
];

const changed = computed(
  () => triageStatus.value !== props.initialStatus || triageNote.value.trim() !== props.initialNote,
);

async function save() {
  saving.value = true;
  try {
    await $fetch(`/api/failure-clusters/${props.clusterId}/status`, {
      method: 'PATCH',
      body: { status: triageStatus.value, triageNote: triageNote.value.trim() || null },
    });
    emit('saved');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="pt-4 max-w-lg">
    <UCard>
      <div class="space-y-4">
        <URadioGroup v-model="triageStatus" :items="triageOptions" />
        <UFormField label="Note" description="Optional context about this cluster's resolution or workaround">
          <UTextarea
            v-model="triageNote"
            placeholder="e.g. Known issue tracked in JIRA-1234, fixed in next release…"
            :rows="4"
            class="w-full"
          />
        </UFormField>
      </div>
      <template #footer>
        <UButton :loading="saving" :disabled="!changed" icon="i-lucide-check" @click="save"> Save triage </UButton>
      </template>
    </UCard>
  </div>
</template>
