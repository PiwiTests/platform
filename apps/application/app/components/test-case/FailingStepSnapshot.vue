<script setup lang="ts">
/**
 * The page state captured *at the failing step*, surfaced inline on that step in
 * the failure timeline. When this run's trace carries Playwright 1.63 per-action
 * snapshots, it shows the screenshot before the failing action beside the one at
 * the failure. Otherwise — an older Playwright, or a trace without `screen`
 * snapshots — it falls back to the run's failure screenshot (the page at the
 * moment it failed, which is this step) and the recovered failure-time ARIA
 * tree, so a failing step still shows its evidence on any Playwright version.
 * Every screenshot opens full-screen in the shared lightbox, matching the Screen
 * tab. Renders nothing when neither a screenshot nor an ARIA tree is available.
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

// The screenshots on show, in reading order — the same list feeds the frames and
// the lightbox, so a frame's index addresses it in the enlarged view.
const shots = computed<Array<{ src: string; name: string; failed: boolean }>>(() => {
  if (hasTraceScreens.value) {
    const list: Array<{ src: string; name: string; failed: boolean }> = [];
    if (beforeSrc.value) list.push({ src: beforeSrc.value, name: 'Before the failing action', failed: false });
    if (afterSrc.value) list.push({ src: afterSrc.value, name: 'At the failure', failed: true });
    return list;
  }
  return fallbackShot.value ? [{ src: fallbackShot.value, name: 'At the failure', failed: true }] : [];
});

const ariaText = computed(() => failingAriaText.value ?? props.ariaSnapshot ?? null);
const hasScreenshot = computed(() => shots.value.length > 0);
const hasAria = computed(() => Boolean(ariaText.value));
const render = computed(() => hasScreenshot.value || hasAria.value);

const lightboxIndex = ref<number | null>(null);
const ariaOpen = ref(false);
</script>

<template>
  <div v-if="render" class="space-y-2.5 rounded-lg border border-default bg-elevated/40 p-3">
    <p class="flex items-center gap-1.5 text-xs font-medium text-muted">
      <UIcon name="i-lucide-image" class="size-3.5 shrink-0" />
      Page at the failing step
    </p>

    <div v-if="hasScreenshot" :class="shots.length > 1 ? 'grid gap-3 sm:grid-cols-2' : ''">
      <figure v-for="(shot, idx) in shots" :key="shot.src" class="min-w-0 space-y-1">
        <figcaption class="flex items-center gap-1 text-xs text-muted">
          <span v-if="shot.failed" class="inline-block size-1.5 shrink-0 rounded-full bg-red-500" aria-hidden="true" />
          {{ shot.name }}
        </figcaption>
        <ZoomableImage
          inline
          :src="shot.src"
          :alt="shot.name"
          :failed="shot.failed"
          frame-class="rounded-lg bg-default"
          img-class="max-h-72 w-auto max-w-full object-contain"
          @open="lightboxIndex = idx"
        />
      </figure>
    </div>

    <div v-if="hasAria">
      <button
        type="button"
        class="inline-flex items-center gap-1 rounded text-xs text-muted outline-none hover:text-default focus-visible:outline-2 focus-visible:outline-primary"
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

    <ScreenshotLightbox v-model="lightboxIndex" :images="shots" />
  </div>
</template>
