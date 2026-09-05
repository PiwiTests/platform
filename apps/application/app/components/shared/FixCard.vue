<script setup lang="ts">
/**
 * "What to do" about a failure, in one card: the locator fix, a pointer to the
 * fix plan, the diagnosis, how to verify, and the tests this failure blocked.
 * Each section is a named slot rendered in a fixed order; the caller lists the
 * sections that have content via `sections`, so the same card serves both the
 * execution page and the cluster page.
 */
import type { HelpTopicKey } from '~/utils/help-content';

export type FixSectionKey =
  | 'locator-fix'
  | 'fix-plan'
  | 'diagnosis'
  | 'fixed-before'
  | 'verify'
  | 'reproduce'
  | 'blocked';

const props = defineProps<{
  /** Which sections have content; the card renders them in its canonical order. */
  sections: FixSectionKey[];
  help?: HelpTopicKey;
}>();

const LABELS: Record<FixSectionKey, string> = {
  'locator-fix': 'Locator fix',
  'fix-plan': 'Fix plan',
  diagnosis: 'Diagnosis',
  'fixed-before': 'Fixed before',
  verify: 'Verify',
  reproduce: 'Reproduce',
  blocked: 'Blocked by this failure',
};

// Rendered in the caller's order — the execution and cluster pages read their
// Fix block in a different sequence.
const active = computed(() => props.sections.map((key) => ({ key, label: LABELS[key] })));
</script>

<template>
  <SectionCard icon="i-lucide-wrench" icon-class="text-primary" title="Fix" :help="help" data-shot="fix">
    <div class="divide-y divide-default">
      <section v-for="s in active" :key="s.key" class="py-3 first:pt-0 last:pb-0 space-y-2" :data-shot="`fix-${s.key}`">
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-xs font-medium uppercase tracking-wide text-muted">
            <slot :name="`${s.key}-label`">{{ s.label }}</slot>
          </h3>
          <slot :name="`${s.key}-actions`" />
        </div>
        <slot :name="s.key" />
      </section>
    </div>
  </SectionCard>
</template>
