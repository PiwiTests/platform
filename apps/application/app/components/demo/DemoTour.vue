<script setup lang="ts">
/**
 * The demo's guided tour (`app.vue` mounts it when `runtimeConfig.public.demoTour`
 * is on): renders the prompt and opens it by itself 1.5 s after the demo is
 * ready — at once outside demo mode — unless this browser already decided
 * (`shouldAutoPrompt`) or a tour is running. A running tour ends with it.
 */
import { shouldAutoPrompt } from '~/utils/demo-tour/prompt-state';

const AUTO_PROMPT_DELAY_MS = 1500;

const config = useRuntimeConfig();
const demoReady = useState('demoReady', () => false);
const { promptOpen, isRunning, restoreLanguage, storedState, openPrompt, stop } = useDemoTour();

let timer: ReturnType<typeof setTimeout> | undefined;

function promptIfDue(): void {
  if (promptOpen.value || isRunning.value) return;
  if (shouldAutoPrompt(storedState(), Date.now())) openPrompt();
}

onMounted(() => {
  restoreLanguage();
  watch(
    () => !config.public.demoMode || demoReady.value,
    (ready) => {
      if (ready && timer === undefined) timer = setTimeout(promptIfDue, AUTO_PROMPT_DELAY_MS);
    },
    { immediate: true },
  );
});

onBeforeUnmount(() => {
  clearTimeout(timer);
  stop();
});
</script>

<template>
  <DemoTourPrompt />
</template>
