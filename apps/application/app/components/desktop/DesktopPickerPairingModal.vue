<script setup lang="ts">
/**
 * Desktop shell only: Piwi Picker asks to pair with this app. The dialog says
 * which extension asks, from which browser, with the code the extension shows;
 * only **Allow** hands it the app's access token, which lets it send bug
 * reports here to run with Playwright (each run still waits for a click).
 */
import { STORE_EXTENSION_ID } from '#shared/desktop-pairing';

const { current, remove } = useDesktopPickerPairings();
const toast = useToast();
const answering = ref(false);

const open = computed({
  get: () => !!current.value,
  set: (value) => {
    if (!value && current.value) void answer(false);
  },
});

/** Where the request comes from, as its extension origin tells. */
const source = computed(() => {
  const pairing = current.value;
  if (!pairing) return '';
  if (pairing.source.kind === 'store') return 'Piwi Picker from the Chrome Web Store';
  if (pairing.source.kind === 'firefox') return 'a Firefox extension';
  return `an extension loaded by hand (${pairing.source.id}), not the Chrome Web Store's Piwi Picker (${STORE_EXTENSION_ID})`;
});
const expires = computed(() => (current.value ? new Date(current.value.expiresAt) : null));

async function answer(allow: boolean) {
  const pairing = current.value;
  if (!pairing || answering.value) return;
  answering.value = true;
  remove(pairing.id);
  try {
    await $fetch(`/api/desktop/picker-pairings/${pairing.id}`, { method: 'PATCH', body: { allow } });
    if (allow) toast.add({ title: 'Piwi Picker is paired with this app', color: 'success' });
  } catch (error) {
    if (allow) toast.add({ title: 'Could not pair Piwi Picker', description: errorMessage(error), color: 'error' });
  } finally {
    answering.value = false;
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Pair Piwi Picker with this app?" :ui="{ content: 'max-w-lg' }">
    <template #body>
      <div v-if="current" class="space-y-4 text-sm" data-shot="desktop-picker-pairing">
        <p class="text-muted">
          Piwi Picker in <span class="font-medium text-highlighted">{{ current.client }}</span> asks to pair. Paired, it
          can send a bug report here to run with Playwright in a linked project; each run still waits for your click.
        </p>
        <div class="rounded-md border border-default p-4 text-center">
          <div class="text-xs text-muted mb-1">Check that Piwi Picker shows the same code</div>
          <code class="text-2xl font-semibold tracking-[0.2em]">{{ current.code }}</code>
        </div>
        <p class="text-xs text-muted">
          From {{ source }}. If you did not just click Pair in Piwi Picker's settings, deny. The request expires at
          {{ expires?.toLocaleTimeString() }}.
        </p>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton color="neutral" variant="ghost" :disabled="answering" @click="answer(false)">Deny</UButton>
        <UButton icon="i-lucide-plug-zap" :loading="answering" @click="answer(true)">Allow</UButton>
      </div>
    </template>
  </UModal>
</template>
