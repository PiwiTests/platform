<script setup lang="ts">
/**
 * Performance evidence for one execution: the performance hints, what the test
 * cost its worker and browser processes when the reporter measured it, then the
 * captured Web Vitals (navigation timing, paint, Core Web Vitals). A Web Vital
 * is rated on its standard bands: a poor value in the error color, one that
 * needs improvement in the warning tone, a good one uncolored. Shows the
 * three-state empty message when no Web Vitals were recorded.
 */
import type { WebVitals } from '~~/types/api';
import type { WireExecutionResources } from '#shared/types';
import type { getPerformanceHints } from '~/utils/performance-hints';
import type { EvidenceState } from '#shared/evidence-state';

defineProps<{
  performanceHints: ReturnType<typeof getPerformanceHints>;
  webVitals: WebVitals | null;
  /** What the test cost, when the reporter measured it. */
  resources?: WireExecutionResources | null;
  state: EvidenceState;
  /** Drop the card frame and padding — render a plain heading row over the body. */
  embedded?: boolean;
}>();

/** A Web Vital's tone on its bands: above `poor` is poor, above `fair` needs improvement; none is muted. */
function ratingClass(value: number | null | undefined, fair: number, poor: number): string {
  if (value == null) return 'text-muted';
  if (value > poor) return 'text-error';
  if (value > fair) return 'text-warning-700 dark:text-warning-400';
  return '';
}
</script>

<template>
  <div class="space-y-4">
    <div v-if="performanceHints.length > 0" class="space-y-2">
      <div
        v-for="(hint, index) in performanceHints"
        :key="index"
        :class="[
          'p-3 rounded-lg border',
          hint.type === 'warning'
            ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
            : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
        ]"
      >
        <div class="flex items-start gap-2">
          <UIcon
            :name="hint.type === 'warning' ? 'i-lucide-alert-triangle' : 'i-lucide-lightbulb'"
            :class="hint.type === 'warning' ? 'text-amber-600' : 'text-blue-600'"
            class="size-4 mt-0.5 shrink-0"
          />
          <div>
            <p
              :class="
                hint.type === 'warning'
                  ? 'text-amber-800 dark:text-amber-200 font-medium'
                  : 'text-blue-800 dark:text-blue-200 font-medium'
              "
            >
              {{ hint.message }}
            </p>
            <p
              :class="
                hint.type === 'warning' ? 'text-amber-700 dark:text-amber-300' : 'text-blue-700 dark:text-blue-300'
              "
              class="mt-1"
            >
              {{ hint.details }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <ExecutionResourcesCard v-if="resources" :resources="resources" :embedded="embedded" help="case.resources" />

    <SectionCard
      v-if="webVitals"
      id="webvitals-card"
      :embedded="embedded"
      :icon="embedded ? undefined : 'i-lucide-gauge'"
      :title="embedded ? (resources ? 'Web Vitals' : '') : 'Browser performance (Web Vitals)'"
      :help="embedded ? undefined : 'case.web-vitals'"
    >
      <div class="space-y-4">
        <StatTileGrid v-if="webVitals.navigation" min-tile-width="10rem">
          <StatTile
            label="TTFB"
            hint="Time to first byte"
            :value-class="ratingClass(webVitals.navigation.ttfb, 200, 600)"
          >
            <DurationValue :ms="webVitals.navigation.ttfb" />
          </StatTile>
          <StatTile
            label="DOM Interactive"
            hint="DOM interactive"
            :value-class="ratingClass(webVitals.navigation.domInteractive, 1500, 3000)"
          >
            <DurationValue :ms="webVitals.navigation.domInteractive" />
          </StatTile>
          <StatTile
            label="DOMContentLoaded"
            hint="DOMContentLoaded"
            :value-class="ratingClass(webVitals.navigation.domContentLoaded, 1500, 3000)"
          >
            <DurationValue :ms="webVitals.navigation.domContentLoaded" />
          </StatTile>
          <StatTile
            label="Load Complete"
            hint="Page fully loaded"
            :value-class="ratingClass(webVitals.navigation.loadComplete, 3000, 5000)"
          >
            <DurationValue :ms="webVitals.navigation.loadComplete" />
          </StatTile>
        </StatTileGrid>

        <StatTileGrid
          v-if="webVitals.paint && (webVitals.paint.firstPaint || webVitals.paint.firstContentfulPaint)"
          min-tile-width="10rem"
          class="pt-2 border-t"
        >
          <StatTile v-if="webVitals.paint.firstPaint !== undefined" label="First Paint (FP)">
            <DurationValue :ms="webVitals.paint.firstPaint" />
          </StatTile>
          <StatTile
            v-if="webVitals.paint.firstContentfulPaint !== undefined"
            label="First Contentful Paint (FCP)"
            :value-class="ratingClass(webVitals.paint.firstContentfulPaint, 1800, 3000)"
          >
            <DurationValue :ms="webVitals.paint.firstContentfulPaint" />
          </StatTile>
        </StatTileGrid>

        <!-- Core Web Vitals — Google rating bands; missing values render "n/a"
             without alarm colors (INP is often absent in short tests). -->
        <StatTileGrid v-if="webVitals.vitals" min-tile-width="10rem" class="pt-2 border-t">
          <StatTile label="Largest Contentful Paint (LCP)" :value-class="ratingClass(webVitals.vitals.lcp, 2500, 4000)">
            <DurationValue :ms="webVitals.vitals.lcp" fallback="n/a" />
          </StatTile>
          <StatTile
            label="Cumulative Layout Shift (CLS)"
            :value="webVitals.vitals.cls != null ? String(webVitals.vitals.cls) : 'n/a'"
            :value-class="ratingClass(webVitals.vitals.cls, 0.1, 0.25)"
          />
          <StatTile label="Interaction to Next Paint (INP)" :value-class="ratingClass(webVitals.vitals.inp, 200, 500)">
            <DurationValue :ms="webVitals.vitals.inp" fallback="n/a" />
          </StatTile>
        </StatTileGrid>

        <div v-if="webVitals.navigation?.url" class="text-xs text-gray-400 pt-1">
          Page: <code class="bg-gray-100 dark:bg-gray-800 px-1 rounded">{{ webVitals.navigation.url }}</code>
        </div>
      </div>
    </SectionCard>
    <SectionCard
      v-else
      :embedded="embedded"
      :icon="embedded ? undefined : 'i-lucide-gauge'"
      :title="embedded ? (resources ? 'Web Vitals' : '') : 'Browser performance (Web Vitals)'"
      :help="embedded ? undefined : 'case.web-vitals'"
    >
      <EvidenceEmptyState :state="state" doc="/capture-fixtures" compact />
    </SectionCard>
  </div>
</template>
