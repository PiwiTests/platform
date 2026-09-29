<script setup lang="ts">
/**
 * The page state captured *at the failing step*, surfaced inline on that step in
 * the failure timeline. When this run's trace carries Playwright 1.63 per-action
 * snapshots, it shows the screenshot before the failing action beside the one at
 * the failure. Otherwise — an older Playwright, or a trace without `screen`
 * snapshots — it falls back to the run's failure screenshot (the page at the
 * moment it failed, which is this step) and the recovered failure-time ARIA
 * tree, so a failing step still shows its evidence on any Playwright version.
 * Beside the screenshot sits the trace's DOM snapshot of the same moment,
 * rendered as the page: the failing action's after-phase DOM next to its
 * after-phase screenshot, the failure-time DOM next to the run's failure
 * screenshot. Every screenshot opens full-screen in the shared lightbox,
 * matching the Screen tab. With neither a screenshot nor a DOM snapshot it is
 * the ARIA tree's disclosure alone; it renders nothing when none is available.
 */
import type { AttachmentInfo } from '~~/types/api';
import { isImageFile } from '~/utils/text-format';
import { useTraceSnapshots } from '~/composables/useTraceSnapshots';
import { useDomSnapshot, type DomSnapshotMoment } from '~/composables/useDomSnapshot';
import DomSnapshotFrame from './DomSnapshotFrame.vue';

const props = defineProps<{
  testRunsCaseId: number;
  /** The execution's attachments — the failure screenshot binds to the failing step when the trace has no 1.63 `screen` snapshot. */
  attachments?: AttachmentInfo[] | null;
  /** The execution's recovered failure-time ARIA tree, shown when the trace carries no per-action aria. */
  ariaSnapshot?: string | null;
}>();

const config = useRuntimeConfig();
const {
  failingStep,
  failingAriaText,
  snapshotUrl,
  pending: traceSnapshotsPending,
} = useTraceSnapshots(() => props.testRunsCaseId);

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

// The DOM of the same moment as the screenshot at the failure: the failing
// action's after-phase (its before-phase when that is the only screenshot), or
// the failure-time DOM beside the run's own failure screenshot. Asked for once
// the trace's screenshots are known. Under a before/after pair it takes the
// whole row.
const domAt = computed<DomSnapshotMoment | null>(() => {
  const step = failingStep.value;
  if (!step || !hasTraceScreens.value) return null;
  return { callId: step.callId, phase: afterSrc.value ? 'after' : 'before' };
});
const dom = useDomSnapshot(
  () => props.testRunsCaseId,
  () => domAt.value,
  () => !traceSnapshotsPending.value,
);
const hasDom = computed(() => dom.hasDom.value);
const domCaption = computed(() =>
  domAt.value?.phase === 'before' ? 'DOM before the failing action' : 'DOM at the failure',
);

const ariaText = computed(() => failingAriaText.value ?? props.ariaSnapshot ?? null);
const hasScreenshot = computed(() => shots.value.length > 0);
const hasAria = computed(() => Boolean(ariaText.value));
const render = computed(() => hasScreenshot.value || hasDom.value || hasAria.value);
const figureCount = computed(() => shots.value.length + (hasDom.value ? 1 : 0));

const lightboxIndex = ref<number | null>(null);
const ariaOpen = ref(false);
</script>

<template>
  <div v-if="render" class="space-y-2.5 rounded-lg border border-default bg-elevated/40 p-3">
    <p v-if="figureCount > 0" class="flex items-center gap-1.5 text-xs font-medium text-muted">
      <UIcon name="i-lucide-image" class="size-3.5 shrink-0" />
      Page at the failing step
    </p>

    <div v-if="figureCount > 0" :class="figureCount > 1 ? 'grid gap-3 sm:grid-cols-2' : ''">
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
      <figure v-if="hasDom" class="min-w-0 space-y-1" :class="figureCount === 3 ? 'sm:col-span-2' : ''">
        <figcaption class="flex items-center gap-1 text-xs text-muted">
          <span
            v-if="domAt?.phase !== 'before'"
            class="inline-block size-1.5 shrink-0 rounded-full bg-red-500"
            aria-hidden="true"
          />
          {{ domCaption }}
        </figcaption>
        <DomSnapshotFrame
          :frame-src="dom.frameSrc.value"
          :src-doc="dom.srcDoc.value"
          :viewport="dom.viewport.value"
          :title="domCaption"
          stage-class="max-h-72"
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
