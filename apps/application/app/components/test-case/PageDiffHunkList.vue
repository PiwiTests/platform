<script setup lang="ts">
/**
 * The scrollable list of ARIA page-diff hunks — added, removed, renamed,
 * changed and moved nodes, with a path breadcrumb, attribute changes and the
 * failing-locator highlight. Presentational: the diff is computed by whoever
 * hosts it (the vs-green page diff or the in-execution before→failure diff).
 */
import type { PageDiffHunk, PageDiffHunkType } from '#shared/page-diff';

defineProps<{ hunks: PageDiffHunk[] }>();

// Per-hunk-type glyph, tone and accessible label.
const HUNK_META: Record<PageDiffHunkType, { symbol: string; classes: string; label: string }> = {
  added: { symbol: '+', classes: 'text-green-700 dark:text-green-400', label: 'Added' },
  removed: { symbol: '−', classes: 'text-red-700 dark:text-red-400', label: 'Removed' },
  renamed: { symbol: '~', classes: 'text-amber-700 dark:text-amber-400', label: 'Renamed' },
  changed: { symbol: '~', classes: 'text-amber-700 dark:text-amber-400', label: 'Changed' },
  moved: { symbol: '~', classes: 'text-sky-700 dark:text-sky-400', label: 'Moved' },
};

function nodeLabel(role: string, name: string | null): string {
  return name ? `${role} "${name}"` : role;
}
</script>

<template>
  <div class="max-h-96 overflow-y-auto rounded border border-default divide-y divide-default">
    <div
      v-for="(hunk, i) in hunks"
      :key="i"
      class="flex items-start gap-2 px-3 py-2 text-sm"
      :class="hunk.matchesLocator ? 'bg-primary/5' : ''"
    >
      <span
        class="font-mono font-semibold shrink-0 select-none"
        :class="HUNK_META[hunk.type].classes"
        :aria-label="HUNK_META[hunk.type].label"
        >{{ HUNK_META[hunk.type].symbol }}</span
      >
      <div class="min-w-0 flex-1">
        <!-- Path breadcrumb to the node -->
        <p v-if="hunk.path.length" class="text-[11px] text-muted truncate">
          {{ hunk.path.join(' › ') }}
        </p>
        <p class="font-mono break-words">
          <template v-if="hunk.type === 'renamed'">
            {{ hunk.role }} <span class="text-red-700 dark:text-red-400">"{{ hunk.oldName }}"</span>
            <span aria-hidden="true"> → </span>
            <span class="text-green-700 dark:text-green-400">"{{ hunk.name }}"</span>
          </template>
          <template v-else>{{ nodeLabel(hunk.role, hunk.name) }}</template>
          <span v-if="hunk.subtreeSize" class="text-[11px] text-muted"> (+{{ hunk.subtreeSize }} nested)</span>
        </p>
        <!-- Attribute changes for changed / renamed nodes -->
        <p v-if="hunk.attributeChanges?.length" class="mt-0.5 flex flex-wrap gap-1 text-[11px] font-mono">
          <span
            v-for="attr in hunk.attributeChanges"
            :key="attr.key"
            class="rounded bg-elevated px-1.5 py-0.5 text-muted"
          >
            {{ attr.key }}: {{ attr.before === null ? '—' : attr.before === true ? 'on' : attr.before }} →
            {{ attr.after === null ? '—' : attr.after === true ? 'on' : attr.after }}
          </span>
        </p>
        <p v-if="hunk.matchesLocator" class="mt-0.5 text-[11px] font-medium text-primary">
          The failing locator points here
        </p>
      </div>
    </div>
  </div>
</template>
