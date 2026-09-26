<script setup lang="ts">
/**
 * The failure-time page structure, folded behind one disclosure at the bottom of
 * the Screen tab: the ARIA tree and the failure-time DOM. The DOM is rendered
 * through the picker's own renderer — the styled page in a hardened,
 * opaque-origin iframe — never as escaped XML, with "Open in picker" (the full
 * locator picker) and "Copy HTML". Folded by default so its markup never counts
 * against the first screen.
 */
import { buildReadonlyDocument } from '~/utils/snapshot-picker-script';
import type { EvidenceState } from '#shared/evidence-state';

const props = defineProps<{
  runId: number;
  testRunsCaseId: number;
  /** The captured ARIA tree, when present. (Not `aria-*` — that is a DOM namespace.) */
  tree?: string | null;
  /** Three-state message for an absent ARIA tree. */
  treeState: EvidenceState;
  /** The ARIA tree was recovered from the trace rather than the fixtures. */
  treeDerived?: boolean;
}>();

interface DomSnapshotResponse {
  status: 'ok' | 'no-trace' | 'no-snapshot';
  html?: string;
  snapshotName?: string;
  viewport?: { width: number; height: number };
}

// Whether a snapshot exists, its viewport, and the HTML behind Copy HTML (and
// the demo's srcdoc). The served frame comes from `dom-snapshot-frame`, which
// embeds the trace's stylesheets and images itself, so this stays the lean HTML.
const { data: snapshot, pending } = useFetch<DomSnapshotResponse>(
  () => `/api/test-run-cases/${props.testRunsCaseId}/dom-snapshot`,
  { lazy: true },
);
const html = computed(() => snapshot.value?.html ?? null);
const hasDom = computed(() => snapshot.value?.status === 'ok' && !!html.value);

// ── Iframe: same hardened rendering as the picker, without the picking overlay ─
const iframeRef = ref<HTMLIFrameElement | null>(null);
const contentHeight = ref(0);
const stageRef = ref<HTMLElement | null>(null);
const stageWidth = ref(0);

// The served app (web + desktop) loads the render from the `dom-snapshot-frame`
// endpoint via `src`, so it carries its own `sandbox allow-scripts` CSP; a
// `srcdoc` frame would inherit the desktop page's `strict-dynamic` policy, which
// blocks the inline measure script. The demo has no server/CSP, so it keeps the
// inline `srcdoc`. Either way `sandbox="allow-scripts"` gives an opaque origin.
const config = useRuntimeConfig();
const isDemo = !!config.public.demoMode;
const apiBase = (config.app.baseURL || '/').replace(/\/$/, '');
const frameSrc = computed(() =>
  isDemo || !hasDom.value
    ? undefined
    : `${apiBase}/api/test-run-cases/${props.testRunsCaseId}/dom-snapshot-frame?mode=readonly`,
);
const srcDoc = computed(() =>
  isDemo && import.meta.client && html.value ? buildReadonlyDocument(html.value) : undefined,
);

const viewport = computed(() => snapshot.value?.viewport ?? null);
const fitZoom = computed(() => {
  const vp = viewport.value;
  if (!vp?.width || !stageWidth.value) return 1;
  return Math.min(stageWidth.value / vp.width, 1);
});
const canvasStyle = computed(() => {
  const vp = viewport.value;
  if (!vp) return { width: '100%', height: contentHeight.value ? `${contentHeight.value}px` : '100%' };
  const h = contentHeight.value || vp.height;
  return { width: `${Math.round(vp.width * fitZoom.value)}px`, height: `${Math.round(h * fitZoom.value)}px` };
});
const iframeStyle = computed(() => {
  const vp = viewport.value;
  if (!vp) return { width: '100%', height: contentHeight.value ? `${contentHeight.value}px` : '100%', border: '0' };
  const h = contentHeight.value || vp.height;
  return {
    width: `${vp.width}px`,
    height: `${h}px`,
    transform: `scale(${fitZoom.value})`,
    transformOrigin: 'top left',
    border: '0',
  };
});

function handleMessage(event: MessageEvent) {
  if (!iframeRef.value || event.source !== iframeRef.value.contentWindow) return;
  if (event.data?.type === 'piwiContentHeight' && typeof event.data.height === 'number') {
    contentHeight.value = Math.max(event.data.height, viewport.value?.height ?? 0);
  }
}

let stageObserver: ResizeObserver | null = null;
watch(stageRef, (el) => {
  stageObserver?.disconnect();
  if (!el) return;
  stageWidth.value = el.clientWidth;
  stageObserver = new ResizeObserver((entries) => {
    for (const e of entries) stageWidth.value = e.contentRect.width;
  });
  stageObserver.observe(el);
});
onMounted(() => window.addEventListener('message', handleMessage));
onBeforeUnmount(() => {
  window.removeEventListener('message', handleMessage);
  stageObserver?.disconnect();
});

const { copy: copyHtml, copied: htmlCopied } = useCopy();

// The full locator picker over the same snapshot.
const pickerOpen = ref(false);

// Forward reveal so a diagnosis / clue citation can unfold + scroll to this card.
const card = ref<{ reveal?: () => void } | null>(null);
defineExpose({ reveal: () => card.value?.reveal?.() });
</script>

<template>
  <CollapsibleSectionCard
    ref="card"
    icon="i-lucide-layout-template"
    title="Page structure"
    :storage-key="`piwi-page-structure-${testRunsCaseId}`"
  >
    <template #folded>
      <span>The failure-time page and its accessibility tree</span>
    </template>

    <div class="space-y-4">
      <!-- The failure-time DOM, rendered as the page — never as escaped XML. -->
      <div class="space-y-1.5">
        <div class="flex items-center justify-between gap-2">
          <h4 class="text-xs font-medium uppercase tracking-wide text-muted">Failure-time page</h4>
          <div v-if="hasDom" class="flex items-center gap-1">
            <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-scan-search" @click="pickerOpen = true">
              Open in picker
            </UButton>
            <UButton
              size="xs"
              variant="ghost"
              color="neutral"
              :icon="htmlCopied ? 'i-lucide-check' : 'i-lucide-clipboard'"
              @click="copyHtml(html!)"
            >
              Copy HTML
            </UButton>
          </div>
        </div>
        <div
          v-if="hasDom"
          ref="stageRef"
          class="relative h-96 overflow-auto rounded-lg border border-default bg-gray-100 dark:bg-gray-800"
        >
          <div :style="canvasStyle">
            <iframe
              ref="iframeRef"
              :src="frameSrc"
              :srcdoc="srcDoc"
              :style="iframeStyle"
              class="bg-white"
              sandbox="allow-scripts"
              title="Failure-time page"
            />
          </div>
        </div>
        <p v-else-if="pending" class="flex items-center gap-2 text-xs text-muted">
          <UIcon name="i-lucide-loader" class="size-4 animate-spin" /> Rendering the page…
        </p>
        <p v-else class="text-xs text-dimmed">No page snapshot was captured for this execution.</p>
      </div>

      <!-- The accessibility tree. -->
      <div class="space-y-1.5">
        <div class="flex items-center justify-between gap-2">
          <h4 class="text-xs font-medium uppercase tracking-wide text-muted">Accessibility tree</h4>
          <TraceDerivedChip v-if="treeDerived" />
        </div>
        <div v-if="tree" class="max-h-96 overflow-y-auto">
          <MarkdownPreview :text="'```yaml\n' + tree + '\n```'" />
        </div>
        <EvidenceEmptyState v-else :state="treeState" doc="/capture-fixtures" compact />
      </div>
    </div>

    <SnapshotLocatorPicker
      v-if="pickerOpen && hasDom"
      v-model:open="pickerOpen"
      :run-id="runId"
      :test-runs-case-id="testRunsCaseId"
      :failing-locator="{ method: 'locator', args: {} }"
    />
  </CollapsibleSectionCard>
</template>
