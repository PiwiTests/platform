export function useDetailGrid(blockCount: () => number) {
  const metadataBlockCount = computed(blockCount);

  // Uses a 12-column grid. Blocks get a fixed span; the summary fills what's left.
  // 0 or 4+ blocks → summary full row (12), blocks wrap below (span-3 each)
  // 1 block        → summary=9 (75%), block=3
  // 2 blocks       → summary=6 (50%), each block=3
  // 3 blocks       → summary=6 (50%), each block=2 → 6+2+2+2 = 12
  const summaryColSpanClass = computed(() => {
    const c = metadataBlockCount.value;
    if (c === 0 || c >= 4) return 'lg:col-span-12';
    if (c === 1) return 'lg:col-span-9';
    if (c === 2) return 'lg:col-span-6';
    return 'lg:col-span-6';
  });

  const blockColSpanClass = computed(() => {
    const c = metadataBlockCount.value;
    if (c === 0) return '';
    if (c === 3) return 'lg:col-span-2';
    return 'lg:col-span-3';
  });

  return { metadataBlockCount, summaryColSpanClass, blockColSpanClass };
}
