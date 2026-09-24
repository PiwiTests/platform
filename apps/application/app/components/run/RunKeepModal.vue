<script setup lang="ts">
import { KEEP_REASON_MAX_LENGTH } from '#shared/run-keep';

/**
 * Asks for an optional reason, then keeps a run forever. Retention (the nightly
 * sweep and the manual cleanup) never deletes a kept run; an administrator can
 * release it later.
 */
const props = defineProps<{ runId: number | null }>();
const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{ kept: [] }>();

const { keep } = useRunKeep();
const reason = ref('');
const saving = ref(false);

watch(open, (isOpen) => {
  if (isOpen) reason.value = '';
});

async function submit() {
  if (props.runId == null || saving.value) return;
  saving.value = true;
  try {
    if (await keep(props.runId, reason.value)) {
      open.value = false;
      emit('kept');
    }
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="`Keep run #${runId} forever`">
    <template #body>
      <div class="space-y-3">
        <p class="text-sm text-highlighted leading-relaxed">
          Retention never deletes a kept run, its traces or its reports. An administrator can release it later.
        </p>
        <UFormField label="Reason" hint="Optional" name="keepReason">
          <UInput
            v-model="reason"
            :maxlength="KEEP_REASON_MAX_LENGTH"
            placeholder="e.g. v2.3.1 release"
            class="w-full"
            autofocus
            @keydown.enter="submit"
          />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <div class="flex items-center gap-3 w-full justify-end">
        <UButton color="neutral" variant="ghost" :disabled="saving" @click="open = false">Cancel</UButton>
        <UButton color="primary" icon="i-lucide-lock" :loading="saving" @click="submit">Keep forever</UButton>
      </div>
    </template>
  </UModal>
</template>
