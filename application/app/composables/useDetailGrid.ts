export function useDetailGrid(blockCount: () => number) {
  const metadataBlockCount = computed(blockCount)

  // Every block gets the same fixed span so right-side cards always have
  // consistent width regardless of how many are visible.  The summary card
  // fills the remaining columns.  8-column grid total.
  const summaryColSpanClass = computed(() => {
    const c = metadataBlockCount.value
    // Every block spans 2 cols; summary fills the rest.
    // 0 blocks → summary takes full row
    // 1 block  → summary=6, block=2
    // 2 blocks → summary=4, each block=2
    // 3 blocks → summary=2, each block=2
    // 4+       → summary full row, blocks wrap below
    if (c === 0 || c >= 4) return 'lg:col-span-8'
    if (c === 1) return 'lg:col-span-6'
    if (c === 2) return 'lg:col-span-4'
    return 'lg:col-span-2'
  })

  const blockColSpanClass = computed(() => {
    return metadataBlockCount.value === 0 ? '' : 'lg:col-span-2'
  })

  return { metadataBlockCount, summaryColSpanClass, blockColSpanClass }
}
