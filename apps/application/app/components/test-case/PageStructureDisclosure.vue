<script setup lang="ts">
/**
 * The failure-time page structure, folded behind one disclosure at the bottom of
 * the Screen tab: the ARIA tree and the failure-time DOM. The DOM is rendered
 * through the picker's own renderer — the styled page in a hardened,
 * opaque-origin iframe — never as escaped XML, with "Open in picker" (the full
 * locator picker) and "Copy HTML". Folded by default so its markup never counts
 * against the first screen.
 */
import DomSnapshotFrame from './DomSnapshotFrame.vue';
import { useDomSnapshot } from '~/composables/useDomSnapshot';
import type { EvidenceState } from '#shared/evidence-state';
import type { LocatorHealingResult } from '#shared/locator-healing.types';

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

// Whether a snapshot exists, its viewport, the frame it renders in and the HTML
// behind Copy HTML. The served frame embeds the trace's stylesheets and images
// itself, so the fetched HTML stays the lean one.
const { html, hasDom, pending, viewport, frameSrc, srcDoc } = useDomSnapshot(() => props.testRunsCaseId);

const { copy: copyHtml, copied: htmlCopied } = useCopy();

// The full locator picker over the same snapshot. It opens on the failing
// locator the healing data names — the same request the Locator fix section
// makes, shared by key — or as an inspector when the failure named none.
const pickerOpen = ref(false);
const { data: healing, execute: loadHealing } = useFetch<LocatorHealingResult>(
  () => `/api/test-run-cases/${props.testRunsCaseId}/locator-healing`,
  { key: `locator-healing-${props.testRunsCaseId}`, immediate: false, lazy: true },
);
async function openPicker() {
  if (!healing.value) await loadHealing().catch(() => {});
  pickerOpen.value = true;
}

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
          <h4 class="text-xs font-medium text-muted">Failure-time page</h4>
          <div v-if="hasDom" class="flex items-center gap-1">
            <UButton
              size="xs"
              variant="ghost"
              color="neutral"
              icon="i-lucide-scan-search"
              title="Click an element of this page to get the locators that target it"
              @click="openPicker"
            >
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
        <DomSnapshotFrame
          v-if="hasDom"
          :frame-src="frameSrc"
          :src-doc="srcDoc"
          :viewport="viewport"
          title="Failure-time page"
        />
        <p v-else-if="pending" class="flex items-center gap-2 text-xs text-muted">
          <UIcon name="i-lucide-loader" class="size-4 animate-spin" /> Rendering the page…
        </p>
        <p v-else class="text-xs text-muted">
          No page snapshot for this execution. It comes from the Playwright trace — keep traces for failures with
          <code class="font-mono">trace: 'retain-on-failure'</code>.
        </p>
      </div>

      <!-- The accessibility tree. -->
      <div class="space-y-1.5">
        <div class="flex items-center justify-between gap-2">
          <h4 class="text-xs font-medium text-muted">Accessibility tree</h4>
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
      :failing-locator="healing?.failingLocator ?? null"
      :healing="healing"
    />
  </CollapsibleSectionCard>
</template>
