<script setup lang="ts">
/**
 * The badge cluster that sits on a test row — and, with only `mode` and
 * `annotations` set, on a suite row.
 *
 * It exists so the run's flat list and its tree render the same badges. They
 * used to disagree: the list showed the new-regression and new-flaky flags the
 * tree never had, and the tree showed the Playwright marks (`fixme`, `slow`, …)
 * the list dropped. Owning the mapping here means neither view can drift again.
 *
 * Renders nothing when a test declared none of it — the row must not reserve
 * space it isn't using.
 */
import { isPiwiAnnotation, type TestMetadata } from '@piwitests/core/test-meta';

type Annotation = { type: string; description?: string };

const props = withDefaults(
  defineProps<{
    /** Suite execution mode — suite rows only. */
    mode?: 'parallel' | 'serial' | 'default' | null;
    /** This is the first run in which the test failed. */
    isNewRegression?: boolean | null;
    /** This is the first run in which the test turned flaky. */
    isNewFlaky?: boolean | null;
    /** Playwright annotations; `piwi:` ones are ownership metadata (see `meta`). */
    annotations?: Annotation[] | null;
    tags?: string[] | null;
    /** Lock names this test held — a shared resource the runner serializes holders of. */
    locks?: string[] | null;
    meta?: TestMetadata | null;
    /** Cap the tags shown; the rest collapse into a `+N` badge. 0 = no cap. */
    maxTags?: number;
  }>(),
  {
    mode: null,
    isNewRegression: false,
    isNewFlaky: false,
    annotations: null,
    tags: null,
    locks: null,
    meta: null,
    maxTags: 0,
  },
);

function annotationColor(type: string): 'warning' | 'error' | 'neutral' | 'info' | 'primary' {
  if (type === 'fixme' || type === 'slow') return 'warning';
  if (type === 'fail') return 'error';
  if (type === 'skip') return 'neutral';
  if (type === 'tag') return 'primary';
  return 'info';
}

function annotationIcon(type: string): string | null {
  switch (type) {
    case 'fixme':
      return 'i-lucide-wrench';
    case 'skip':
      return 'i-lucide-skip-forward';
    case 'slow':
      return 'i-lucide-timer';
    case 'fail':
      return 'i-lucide-x-circle';
    case 'tag':
      return 'i-lucide-tag';
    default:
      return null;
  }
}

function annotationLabel(ann: Annotation): string {
  return ann.type === 'tag' ? (ann.description ?? ann.type) : ann.type;
}

/**
 * Playwright marks only. `piwi:` annotations carry ownership metadata and are
 * rendered by `TestMetaBadges`, so showing them here too would duplicate every
 * owner and priority on the row.
 */
const marks = computed(() => (props.annotations ?? []).filter((ann) => !isPiwiAnnotation(ann.type)));

const hasMeta = computed(() =>
  Boolean(
    (props.tags?.length ?? 0) > 0 ||
    (props.locks?.length ?? 0) > 0 ||
    props.meta?.owner ||
    props.meta?.priority ||
    props.meta?.feature ||
    props.meta?.link,
  ),
);

const hasAnything = computed(
  () =>
    props.mode === 'parallel' ||
    props.mode === 'serial' ||
    Boolean(props.isNewRegression) ||
    Boolean(props.isNewFlaky) ||
    marks.value.length > 0 ||
    hasMeta.value,
);
</script>

<template>
  <div v-if="hasAnything" class="inline-flex items-center gap-1 flex-wrap">
    <UBadge v-if="mode === 'parallel'" color="success" variant="soft" size="xs" class="shrink-0">parallel</UBadge>
    <UBadge v-if="mode === 'serial'" color="warning" variant="soft" size="xs" class="shrink-0">serial</UBadge>

    <UBadge
      v-if="isNewRegression"
      color="error"
      variant="solid"
      size="xs"
      class="uppercase tracking-wider shrink-0"
      title="First run in which this test failed"
    >
      NEW
    </UBadge>
    <UBadge
      v-if="isNewFlaky"
      color="info"
      variant="solid"
      size="xs"
      class="uppercase tracking-wider shrink-0"
      title="First run in which this test was flaky"
    >
      FLAKY
    </UBadge>

    <UBadge
      v-for="ann in marks"
      :key="`${ann.type}:${ann.description ?? ''}`"
      :color="annotationColor(ann.type)"
      variant="soft"
      size="xs"
      :title="ann.type !== 'tag' ? (ann.description ?? undefined) : undefined"
      class="shrink-0 gap-1"
    >
      <UIcon v-if="annotationIcon(ann.type)" :name="annotationIcon(ann.type)!" class="size-2.5 shrink-0" />
      {{ annotationLabel(ann) }}
    </UBadge>

    <TestMetaBadges :tags="tags" :locks="locks" :meta="meta" :max-tags="maxTags" />
  </div>
</template>
