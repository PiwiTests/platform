import { h } from 'vue'
import { UIcon } from '#components'
import type { Column } from '@tanstack/vue-table'
import { formatDuration as formatDurationLib, formatDistanceToNow } from 'date-fns'

/**
 * Creates a sortable column header render function.
 * Use as: { header: createSortHeader('My Column'), ... }
 */
export function createSortHeader<T = unknown>(label: string) {
  return ({ column }: { column: Column<T, unknown> }) => {
    const sorted = column.getIsSorted()
    const iconName = sorted === 'asc'
      ? 'i-lucide-chevron-up'
      : sorted === 'desc'
        ? 'i-lucide-chevron-down'
        : 'i-lucide-chevrons-up-down'
    return h('button', {
      class: 'flex items-center gap-1 font-semibold select-none cursor-pointer hover:text-highlighted transition-colors',
      onClick: () => column.toggleSorting()
    }, [
      label,
      h(UIcon, { name: iconName, class: ['shrink-0 size-3.5', !sorted && 'opacity-40'] })
    ])
  }
}

export function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes === 0) return '0 B'

  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}

/**
 * Format an absolute timestamp for display.
 *
 * Accepts a `Date`, an ISO string, a numeric string, or a number. Numeric
 * values are auto-detected as Unix seconds (`< 1e12`) or milliseconds, so it
 * works for both `integer(timestamp)` columns (seconds) and raw millisecond
 * fields such as `startedAt`, as well as `Date` objects (e.g. PostgreSQL).
 *
 * @param date The value to format.
 * @param options.dateOnly Omit the time component (date only).
 * @returns A locale string, or `'N/A'` for empty/invalid input.
 */
export function prettyDateFormat(
  date: string | Date | number | null | undefined,
  options: { dateOnly?: boolean } = {}
): string {
  if (date === null || date === undefined || date === '') return 'N/A'

  let d: Date
  if (date instanceof Date) {
    d = date
  } else {
    const n = typeof date === 'number' ? date : Number(date)
    if (!Number.isNaN(n) && String(date).trim() !== '') {
      // Numeric input: values below 1e12 are Unix seconds, otherwise milliseconds
      d = new Date(n < 1e12 ? n * 1000 : n)
    } else {
      // Non-numeric string (ISO 8601, etc.)
      d = new Date(date)
    }
  }

  if (Number.isNaN(d.getTime())) return 'N/A'
  return options.dateOnly ? d.toLocaleDateString() : d.toLocaleString()
}

export function formatRelativeTime(date: string | Date | number | null | undefined): string {
  if (!date) return 'N/A'
  return formatDistanceToNow(new Date(date), { addSuffix: true })
}

export function formatDuration(ms?: number | null) {
  if (ms === null || ms === undefined) return 'N/A'
  const sign = ms < 0 ? '−' : ''
  return sign + formatDurationLib({ seconds: Math.abs(ms) / 1000 })
}

export function getStatusColor(status: string) {
  switch (status) {
    case 'passed': return 'success'
    case 'failed': return 'error'
    case 'timedOut': return 'warning'
    case 'interrupted': return 'warning'
    case 'cancelled': return 'neutral'
    case 'initialising': return 'info'
    case 'running': return 'info'
    default: return 'neutral'
  }
}

/**
 * Generate a random vibrant hex color.
 * Uses HSL with fixed saturation/lightness for visually appealing results.
 *
 * Conversion uses the standard HSL → RGB chroma method:
 *   c = chroma, x = intermediate value per 60° sector, m = brightness offset
 *   The (r,g,b) triple is selected from one of six 60°-wide hue sectors,
 *   then shifted by m and scaled to [0,255].
 */
export function randomHexColor(): string {
  const hue = Math.floor(Math.random() * 360)
  const s = 65 // saturation %: vibrant but not neon
  const l = 50 // lightness %: mid-range for good contrast on both light/dark backgrounds
  const c = (1 - Math.abs(2 * l / 100 - 1)) * s / 100
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1))
  const m = l / 100 - c / 2
  let r = 0, g = 0, b = 0
  if (hue < 60) {
    r = c
    g = x
  } else if (hue < 120) {
    r = x
    g = c
  } else if (hue < 180) {
    g = c
    b = x
  } else if (hue < 240) {
    g = x
    b = c
  } else if (hue < 300) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

/**
 * Convert file path to API file path.
 * Removes the storage path prefix if present to create a relative path for the API
 * If the path is already relative, returns it as-is
 */
export function getFileApiPath(filePath: string): string {
  // If path is already relative (doesn't start with . or /), return as-is
  if (!filePath.startsWith('.') && !filePath.startsWith('/')) {
    return filePath
  }

  // Remove storage path prefix for backward compatibility with absolute paths
  const storagePath = '.data/storage/'
  return filePath.replace(storagePath, '')
}
