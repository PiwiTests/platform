<script setup lang="ts">
/**
 * Desktop shell only: offer to import the runs already in a just-linked folder.
 *
 * The scan and the one-shot proposal live in `useDesktopImportPrevRuns`; this
 * dialog drives the import through the same path-based local-import flow the
 * drag & drop dialog uses (`addLocalPaths` → `/api/desktop/import-local`). The
 * project is fixed — it is the one the folder was just linked to — so there is
 * nothing to choose but whether to import.
 */
const { proposal, open } = useDesktopImportPrevRuns();

const projectName = computed(() => proposal.value?.projectName);

const { entries, importing, readyCount, importedCount, startImport, addLocalPaths, remove } =
  useBlobReportImport(projectName);

// Each time the dialog opens for a freshly linked folder, replace the list with
// that folder's finds. `immediate` covers the dialog opening (from the create
// flow) before this modal — mounted in the layout — has run its setup.
watch(
  open,
  (value) => {
    if (value && proposal.value) {
      entries.value = [];
      addLocalPaths(proposal.value.archives);
    }
  },
  { immediate: true },
);

const blobCount = computed(() => proposal.value?.archives.filter((a) => a.kind === 'blob').length ?? 0);
const traceCount = computed(() => proposal.value?.archives.filter((a) => a.kind === 'trace').length ?? 0);

/** "3 blob reports and 2 traces", dropping whichever side is empty. */
const summary = computed(() => {
  const parts: string[] = [];
  if (blobCount.value) parts.push(`${blobCount.value} blob report${blobCount.value === 1 ? '' : 's'}`);
  if (traceCount.value) parts.push(`${traceCount.value} trace${traceCount.value === 1 ? '' : 's'}`);
  return parts.join(' and ');
});

const finishedCount = computed(() => entries.value.filter((e) => ['imported', 'duplicate'].includes(e.state)).length);
const allDone = computed(() => entries.value.length > 0 && finishedCount.value === entries.value.length);
</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'max-w-xl' }">
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-history" class="size-5 text-primary" />
        <h2 class="text-base font-semibold">Import previous runs</h2>
      </div>
    </template>

    <template #body>
      <div class="space-y-4">
        <p class="text-sm text-muted">
          This folder already has {{ summary }} from earlier Playwright runs. Import them into
          <span class="font-medium text-default">{{ projectName }}</span> to backfill its history? Re-importing later
          does nothing, and imports never trigger notifications or regression signals.
        </p>

        <div class="divide-y divide-default border rounded-lg border-default max-h-72 overflow-y-auto">
          <ImportFileRow
            v-for="entry in entries"
            :key="entry.id"
            :entry="entry"
            :removable="!importing && entry.state !== 'uploading'"
            @remove="remove"
          />
          <EmptyState v-if="entries.length === 0" icon="i-lucide-inbox" text="Nothing to import." />
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex items-center justify-end w-full gap-2">
        <UButton color="neutral" variant="ghost" @click="open = false">
          {{ allDone ? 'Close' : 'Not now' }}
        </UButton>
        <UButton
          icon="i-lucide-import"
          :loading="importing"
          :disabled="readyCount === 0 || allDone"
          @click="startImport()"
        >
          {{ importedCount > 0 && !importing ? 'Import the rest' : `Import ${readyCount || ''}`.trim() }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
