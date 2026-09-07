<script setup lang="ts">
/**
 * "More ways to fix" — every other way to fix, verify or reproduce a failure,
 * placed after the Evidence card. Each section is folded to one line (a
 * sentence-case label plus a one-line summary the page supplies) except the one
 * the next step points at, which opens with the page. A folded section's body is
 * not rendered, so its code blocks never count against the first screen. The
 * canonical `FixSectionKey` union and the per-section slot contract are the same
 * the two pages fill; the card renders the sections it is given in one fixed
 * order.
 */
import type { HelpTopicKey } from '~/utils/help-content';
import type { NextStepKind } from '#shared/next-step';

export type FixSectionKey =
  | 'locator-fix'
  | 'fix-plan'
  | 'diagnosis'
  | 'fixed-before'
  | 'verify'
  | 'reproduce'
  | 'blocked';

const props = defineProps<{
  /** Which sections have content; the toolbox renders them in its canonical order. */
  sections: FixSectionKey[];
  /** The next step's kind — decides which section opens with the page. */
  nextStepKind?: NextStepKind | null;
  help?: HelpTopicKey;
}>();

const LABELS: Record<FixSectionKey, string> = {
  diagnosis: 'Diagnosis',
  'locator-fix': 'Locator fix',
  verify: 'Verify',
  reproduce: 'Reproduce and bisect',
  'fixed-before': 'Fixed before',
  blocked: 'Blocked by this failure',
  'fix-plan': 'Fix plan',
};

// One fixed order, regardless of the order the page lists its sections in.
const ORDER: FixSectionKey[] = [
  'diagnosis',
  'locator-fix',
  'verify',
  'reproduce',
  'fixed-before',
  'blocked',
  'fix-plan',
];

// The next step decides which section opens; a cookie never does.
const NEXT_STEP_SECTION: Partial<Record<NextStepKind, FixSectionKey>> = {
  'apply-patch': 'diagnosis',
  'follow-diagnosis': 'diagnosis',
  diagnose: 'diagnosis',
  'replace-locator': 'locator-fix',
  'rerun-in-ci': 'verify',
  reproduce: 'reproduce',
  'open-blocker': 'blocked',
};

const active = computed(() =>
  ORDER.filter((key) => props.sections.includes(key)).map((key) => ({ key, label: LABELS[key] })),
);

const defaultOpen = computed<FixSectionKey | null>(() => {
  const target = props.nextStepKind ? NEXT_STEP_SECTION[props.nextStepKind] : undefined;
  return target && props.sections.includes(target) ? target : null;
});

// The open section is the next step's, until the user toggles one open — a
// component-only state, never persisted.
const openKey = ref<FixSectionKey | null>(defaultOpen.value);
watch(defaultOpen, (key) => {
  openKey.value = key;
});

function toggle(key: FixSectionKey) {
  openKey.value = openKey.value === key ? null : key;
}

/** Open a section (a next-step action reveals then scrolls to it). */
function openSection(key: FixSectionKey) {
  openKey.value = key;
}

defineExpose({ openSection });
</script>

<template>
  <SectionCard icon="i-lucide-wrench" icon-class="text-primary" title="More ways to fix" :help="help" data-shot="fix">
    <div class="divide-y divide-default">
      <section v-for="s in active" :key="s.key" class="first:pt-0 last:pb-0" :data-shot="`fix-${s.key}`">
        <div class="flex items-center justify-between gap-2 py-3">
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:outline-2 focus-visible:outline-primary"
            :aria-expanded="openKey === s.key"
            @click="toggle(s.key)"
          >
            <UIcon
              :name="openKey === s.key ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
              class="size-4 shrink-0 text-gray-400"
            />
            <span class="text-sm font-medium shrink-0">{{ s.label }}</span>
            <span v-if="openKey !== s.key" class="min-w-0 flex-1 truncate text-sm text-muted">
              <slot :name="`${s.key}-summary`" />
            </span>
          </button>
          <div v-if="openKey === s.key" class="flex items-center gap-1 shrink-0">
            <slot :name="`${s.key}-actions`" />
          </div>
        </div>
        <div v-if="openKey === s.key" class="pb-3 space-y-2">
          <slot :name="s.key" />
        </div>
      </section>
    </div>
  </SectionCard>
</template>
