export function useDetailGrid(blockCount: () => number) {
  const metadataBlockCount = computed(blockCount)

  const summaryColSpanClass = computed(() => {
    const c = metadataBlockCount.value
    if (c === 0) return 'lg:col-span-8'
    if (c === 3) return 'lg:col-span-5'
    if (c === 2) return 'lg:col-span-4'
    return 'lg:col-span-5'
  })

  const blockColSpanClass = computed(() => {
    const c = metadataBlockCount.value
    if (c === 3) return 'lg:col-span-1'
    if (c === 2) return 'lg:col-span-2'
    if (c === 1) return 'lg:col-span-3'
    return ''
  })

  return { metadataBlockCount, summaryColSpanClass, blockColSpanClass }
}
