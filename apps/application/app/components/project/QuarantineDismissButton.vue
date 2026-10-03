<script setup lang="ts">
/**
 * Dismisses what Piwi proposed for a test, quarantining it or releasing it from
 * quarantine, with an optional reason. Nothing else changes: the test stays out
 * of, or in, quarantine, and the proposal stays listed, marked dismissed.
 */
import { DISMISS_REASON_MAX_LENGTH, type QuarantineProposal } from '#shared/quarantine-proposals';

const props = defineProps<{
  projectId: string | number;
  testCaseId: number;
  proposal: QuarantineProposal;
}>();

const emit = defineEmits<{ dismissed: [] }>();

const toast = useToast();
const open = ref(false);
const reason = ref('');
const saving = ref(false);

const sentence = computed(() =>
  props.proposal === 'release'
    ? 'Keep this test quarantined. Its streak still counts; release it whenever you choose.'
    : 'Leave this test out of quarantine. It stays on the flaky list.',
);

watch(open, (isOpen) => {
  if (isOpen) reason.value = '';
});

async function submit() {
  if (saving.value) return;
  saving.value = true;
  try {
    await $fetch(`/api/projects/${props.projectId}/quarantine/${props.testCaseId}/dismiss`, {
      method: 'POST',
      body: { proposal: props.proposal, reason: reason.value },
    });
    open.value = false;
    toast.add({
      title: props.proposal === 'release' ? 'Proposed release dismissed' : 'Quarantine proposal dismissed',
      color: 'success',
    });
    emit('dismissed');
  } catch (error) {
    toast.add({ title: 'Could not dismiss the proposal', description: errorMessage(error), color: 'error' });
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <UPopover v-model:open="open">
    <UButton
      size="xs"
      color="neutral"
      variant="ghost"
      :title="proposal === 'release' ? 'Dismiss the proposed release' : 'Dismiss the quarantine proposal'"
      data-testid="quarantine-dismiss"
    >
      Dismiss
    </UButton>
    <template #content>
      <div class="p-3 space-y-3 w-72">
        <p class="text-sm text-highlighted leading-relaxed">{{ sentence }}</p>
        <UFormField label="Reason" hint="Optional" name="dismissReason">
          <UInput
            v-model="reason"
            :maxlength="DISMISS_REASON_MAX_LENGTH"
            :placeholder="proposal === 'release' ? 'e.g. still fails on staging' : 'e.g. the fix is in review'"
            class="w-full"
            autofocus
            @keydown.enter="submit"
          />
        </UFormField>
        <div class="flex justify-end gap-2">
          <UButton size="xs" color="neutral" variant="ghost" :disabled="saving" @click="open = false">Cancel</UButton>
          <UButton size="xs" color="neutral" variant="outline" :loading="saving" @click="submit">Dismiss</UButton>
        </div>
      </div>
    </template>
  </UPopover>
</template>
