<script setup lang="ts">
/**
 * The page state captured *at the failing step*, surfaced inline on that step in
 * the failure timeline: the screenshot before the failing action beside the
 * screenshot at the failure, and the accessibility (ARIA) tree at the failure
 * folded away below them. Reads this run's own trace 1.63 per-action snapshots
 * through `useTraceSnapshots` (the same request the filmstrip already made, so
 * no extra fetch). Renders nothing when the trace carries no snapshot for the
 * failing step.
 */
import { useTraceSnapshots } from '~/composables/useTraceSnapshots';

const props = defineProps<{ testRunsCaseId: number }>();

const { failingStep, failingAriaText, snapshotUrl } = useTraceSnapshots(() => props.testRunsCaseId);

const beforeSrc = computed(() =>
  failingStep.value?.screen.before ? snapshotUrl(failingStep.value.callId, 'screen', 'before') : null,
);
const afterSrc = computed(() =>
  failingStep.value?.screen.after ? snapshotUrl(failingStep.value.callId, 'screen', 'after') : null,
);

const hasScreenshot = computed(() => Boolean(beforeSrc.value || afterSrc.value));
const hasAria = computed(() => Boolean(failingAriaText.value));
const render = computed(() => hasScreenshot.value || hasAria.value);

const ariaOpen = ref(false);
</script>

<template>
  <div v-if="render" class="rounded-lg border border-default bg-elevated/40 p-2.5 space-y-2">
    <p class="text-xs font-medium text-muted">Page at the failing step</p>

    <div v-if="hasScreenshot" class="grid gap-3" :class="beforeSrc && afterSrc ? 'sm:grid-cols-2' : ''">
      <figure v-if="beforeSrc" class="min-w-0">
        <figcaption class="mb-1 text-xs text-muted">Before the failing action</figcaption>
        <img
          :src="beforeSrc"
          alt="Page before the failing action"
          loading="lazy"
          class="max-h-64 w-full rounded border border-default bg-default object-contain object-top"
        />
      </figure>
      <figure v-if="afterSrc" class="min-w-0">
        <figcaption class="mb-1 text-xs text-muted">At the failure</figcaption>
        <img
          :src="afterSrc"
          alt="Page at the failure"
          loading="lazy"
          class="max-h-64 w-full rounded border border-default bg-default object-contain object-top"
        />
      </figure>
    </div>

    <div v-if="hasAria">
      <button
        type="button"
        class="inline-flex items-center gap-1 text-xs text-muted hover:text-default outline-none focus-visible:outline-2 focus-visible:outline-primary rounded"
        :aria-expanded="ariaOpen ? 'true' : 'false'"
        @click="ariaOpen = !ariaOpen"
      >
        <UIcon :name="ariaOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-3.5" />
        Accessibility tree at the failure
      </button>
      <div v-show="ariaOpen" class="mt-1.5 max-h-80 overflow-y-auto">
        <MarkdownPreview :text="'```yaml\n' + failingAriaText + '\n```'" />
      </div>
    </div>
  </div>
</template>
