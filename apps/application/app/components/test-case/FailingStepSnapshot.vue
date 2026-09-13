<script setup lang="ts">
/**
 * The page state captured *at the failing step*, surfaced inline on that step in
 * the failure timeline. When this run's trace carries Playwright 1.63 per-action
 * snapshots, it shows the screenshot before the failing action beside the one at
 * the failure. Otherwise — an older Playwright, or a trace without `screen`
 * snapshots — it falls back to the run's failure screenshot (the page at the
 * moment it failed, which is this step) and the recovered failure-time ARIA
 * tree, so a failing step still shows its evidence on any Playwright version.
 * Renders nothing when neither a screenshot nor an ARIA tree is available.
 */
import type { AttachmentInfo } from '~~/types/api';
import { isImageFile } from '~/utils/text-format';
import { useTraceSnapshots } from '~/composables/useTraceSnapshots';

const props = defineProps<{
  testRunsCaseId: number;
  /** The execution's attachments — the failure screenshot binds to the failing step when the trace has no 1.63 `screen` snapshot. */
  attachments?: AttachmentInfo[] | null;
  /** The execution's recovered failure-time ARIA tree, shown when the trace carries no per-action aria. */
  ariaSnapshot?: string | null;
}>();

const config = useRuntimeConfig();
const { failingStep, failingAriaText, snapshotUrl } = useTraceSnapshots(() => props.testRunsCaseId);

const beforeSrc = computed(() =>
  failingStep.value?.screen.before ? snapshotUrl(failingStep.value.callId, 'screen', 'before') : null,
);
const afterSrc = computed(() =>
  failingStep.value?.screen.after ? snapshotUrl(failingStep.value.callId, 'screen', 'after') : null,
);
const hasTraceScreens = computed(() => Boolean(beforeSrc.value || afterSrc.value));

// Older Playwright (or a trace recorded without `screen` snapshots) has no
// per-action screenshot. The run's failure screenshot is the page at the moment
// it failed — the failing step — so bind it here when the trace carries none.
const fallbackShot = computed(() => {
  if (hasTraceScreens.value) return null;
  const image = (props.attachments ?? []).find((att) => isImageFile(att.path, att.contentType));
  return image ? fileApiUrl(image.path, image.contentType, config.app?.baseURL) : null;
});

const ariaText = computed(() => failingAriaText.value ?? props.ariaSnapshot ?? null);
const hasScreenshot = computed(() => hasTraceScreens.value || Boolean(fallbackShot.value));
const hasAria = computed(() => Boolean(ariaText.value));
const render = computed(() => hasScreenshot.value || hasAria.value);

const ariaOpen = ref(false);
</script>

<template>
  <div v-if="render" class="rounded-lg border border-default bg-elevated/40 p-2.5 space-y-2">
    <p class="text-xs font-medium text-muted">Page at the failing step</p>

    <div v-if="hasTraceScreens" class="grid gap-3" :class="beforeSrc && afterSrc ? 'sm:grid-cols-2' : ''">
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

    <figure v-else-if="fallbackShot" class="min-w-0">
      <figcaption class="mb-1 text-xs text-muted">At the failure</figcaption>
      <img
        :src="fallbackShot"
        alt="Page at the failure"
        loading="lazy"
        class="max-h-64 w-full rounded border border-default bg-default object-contain object-top"
      />
    </figure>

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
        <MarkdownPreview :text="'```yaml\n' + ariaText + '\n```'" />
      </div>
    </div>
  </div>
</template>
