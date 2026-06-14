import { h } from 'vue';
import { UIcon } from '#components';
import type { Column } from '@tanstack/vue-table';
import { formatDuration as formatDurationLib, formatDistanceToNow } from 'date-fns';

/**
 * Creates a sortable column header render function.
 * Use as: { header: createSortHeader('My Column'), ... }
 */
export function createSortHeader<T = unknown>(label: string) {
  return ({ column }: { column: Column<T, unknown> }) => {
    const sorted = column.getIsSorted();
    const iconName =
      sorted === 'asc'
        ? 'i-lucide-chevron-up'
        : sorted === 'desc'
          ? 'i-lucide-chevron-down'
          : 'i-lucide-chevrons-up-down';
    return h(
      'button',
      {
        class:
          'flex items-center gap-1 font-semibold select-none cursor-pointer hover:text-highlighted transition-colors',
        onClick: () => column.toggleSorting(),
      },
      [label, h(UIcon, { name: iconName, class: ['shrink-0 size-3.5', !sorted && 'opacity-40'] })],
    );
  };
}

export function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
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
  options: { dateOnly?: boolean } = {},
): string {
  if (date === null || date === undefined || date === '') return 'N/A';

  let d: Date;
  if (date instanceof Date) {
    d = date;
  } else {
    const n = typeof date === 'number' ? date : Number(date);
    if (!Number.isNaN(n) && String(date).trim() !== '') {
      // Numeric input: values below 1e12 are Unix seconds, otherwise milliseconds
      d = new Date(n < 1e12 ? n * 1000 : n);
    } else {
      // Non-numeric string (ISO 8601, etc.)
      d = new Date(date);
    }
  }

  if (Number.isNaN(d.getTime())) return 'N/A';
  return options.dateOnly ? d.toLocaleDateString() : d.toLocaleString();
}

export function formatRelativeTime(date: string | Date | number | null | undefined): string {
  if (!date) return 'N/A';
  return formatDistanceToNow(new Date(date), { addSuffix: true });
}

export function formatDuration(ms?: number | null) {
  if (ms === null || ms === undefined) return 'N/A';
  const sign = ms < 0 ? '−' : '';
  return sign + formatDurationLib({ seconds: Math.abs(ms) / 1000 });
}

export function reportIcon(type: string): string {
  switch (type) {
    case 'html':
      return 'i-lucide-layout-dashboard';
    case 'monocart':
      return 'i-lucide-bar-chart-2';
    case 'blob':
      return 'i-lucide-download';
    default:
      return 'i-lucide-file-text';
  }
}

/**
 * Map a browser project name to a recognizable icon.
 */
export function getBrowserIcon(browserName?: string | null): string {
  if (!browserName) return 'i-lucide-globe';
  const name = browserName.toLowerCase();
  if (name.includes('chrome') || name.includes('chromium')) return 'i-simple-icons-googlechrome';
  if (name.includes('firefox')) return 'i-simple-icons-firefoxbrowser';
  if (name.includes('safari') || name.includes('webkit')) return 'i-simple-icons-safari';
  if (name.includes('edge')) return 'i-simple-icons-microsoftedge';
  return 'i-lucide-globe';
}

export function getBrowserHexColor(browserName?: string | null): string {
  if (!browserName) return '#6b7280';
  const name = browserName.toLowerCase();
  if (name.includes('chrome') || name.includes('chromium')) return '#4285F4';
  if (name.includes('firefox')) return '#FF7139';
  if (name.includes('safari') || name.includes('webkit')) return '#007AFF';
  if (name.includes('edge')) return '#0078D7';
  return '#6b7280';
}

export function getStatusColor(status: string) {
  switch (status) {
    case 'passed':
      return 'success';
    case 'failed':
      return 'error';
    case 'timedout':
      return 'warning';
    case 'timedOut':
      return 'warning';
    case 'interrupted':
      return 'warning';
    case 'cancelled':
      return 'neutral';
    case 'initialising':
      return 'info';
    case 'running':
      return 'info';
    case 'finalizing':
      return 'info';
    default:
      return 'neutral';
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
  const hue = Math.floor(Math.random() * 360);
  const s = 65; // saturation %: vibrant but not neon
  const l = 50; // lightness %: mid-range for good contrast on both light/dark backgrounds
  const c = ((1 - Math.abs((2 * l) / 100 - 1)) * s) / 100;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l / 100 - c / 2;
  let r = 0,
    g = 0,
    b = 0;
  if (hue < 60) {
    r = c;
    g = x;
  } else if (hue < 120) {
    r = x;
    g = c;
  } else if (hue < 180) {
    g = c;
    b = x;
  } else if (hue < 240) {
    g = x;
    b = c;
  } else if (hue < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Convert file path to API file path.
 * Removes the storage path prefix if present to create a relative path for the API
 * If the path is already relative, returns it as-is
 */
export function getFileApiPath(filePath: string): string {
  // If path is already relative (doesn't start with . or /), return as-is
  if (!filePath.startsWith('.') && !filePath.startsWith('/')) {
    return filePath;
  }

  // Remove storage path prefix for backward compatibility with absolute paths
  const storagePath = '.data/storage/';
  return filePath.replace(storagePath, '');
}

const ESC = '\u001B';

const ANSI_FG: Record<number, string> = {
  30: '#000000',
  31: '#dc2626',
  32: '#16a34a',
  33: '#d97706',
  34: '#2563eb',
  35: '#9333ea',
  36: '#0891b2',
  37: '#9ca3af',
};

const ANSI_BG: Record<number, string> = {
  40: '#000000',
  41: '#dc2626',
  42: '#16a34a',
  43: '#d97706',
  44: '#2563eb',
  45: '#9333ea',
  46: '#0891b2',
  47: '#9ca3af',
};

const ANSI_SGR_RE = new RegExp(`${ESC}\\[([0-9;]*)m`, 'g');

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Convert ANSI SGR escape sequences to HTML `<span>` tags with inline styles.
 * Handles bold/dim/italic/underline and standard 30–47 color codes.
 * Unrecognized codes are stripped.
 */
export function renderAnsi(text: string): string {
  const parts: string[] = [];
  let last = 0;
  let fg: string | undefined;
  let bg: string | undefined;
  let bold = false;
  let dim = false;
  let italic = false;
  let uline = false;

  const push = (raw: string) => {
    if (!raw) return;
    const props: string[] = [];
    if (bold) props.push('font-weight:600');
    if (dim) props.push('opacity:.7');
    if (italic) props.push('font-style:italic');
    if (uline) props.push('text-decoration:underline');
    if (fg) props.push(`color:${fg}`);
    if (bg) props.push(`background:${bg}`);
    const e = escapeHtml(raw);
    parts.push(props.length ? `<span style="${props.join(';')}">${e}</span>` : e);
  };

  const apply = (codes: number[]) => {
    for (const c of codes) {
      if (c === 0) {
        fg = undefined;
        bg = undefined;
        bold = false;
        dim = false;
        italic = false;
        uline = false;
      } else if (c === 1) {
        bold = true;
      } else if (c === 2) {
        dim = true;
      } else if (c === 3) {
        italic = true;
      } else if (c === 4) {
        uline = true;
      } else if (c === 22) {
        bold = false;
        dim = false;
      } else if (c === 23) {
        italic = false;
      } else if (c === 24) {
        uline = false;
      } else if (c >= 30 && c <= 37) {
        fg = ANSI_FG[c];
      } else if (c === 39) {
        fg = undefined;
      } else if (c >= 40 && c <= 47) {
        bg = ANSI_BG[c];
      } else if (c === 49) {
        bg = undefined;
      }
    }
  };

  let m: RegExpExecArray | null;
  while ((m = ANSI_SGR_RE.exec(text)) !== null) {
    push(text.slice(last, m.index));
    last = ANSI_SGR_RE.lastIndex;
    const codes = m[1] ? m[1].split(';').map(Number) : [0];
    apply(codes);
  }

  push(text.slice(last));
  return parts.join('');
}
