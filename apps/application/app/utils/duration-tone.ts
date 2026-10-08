/**
 * The tones of a duration on an execution's evidence. A duration that stands
 * out in its test (`durationStandout` in `#shared/duration-standout`) takes the
 * one warning tone, its number and its bar alike; every other duration stays
 * neutral. A failure keeps its outcome color from `STATUS_PALETTE`.
 */

/** The number of a duration that stands out. */
export const STANDOUT_TEXT_CLASS = 'text-warning-700 dark:text-warning-400 font-medium';

/** The bar of a duration that stands out. */
export const STANDOUT_BAR_CLASS = 'bg-warning';

/** The number of any other duration. */
export const DURATION_TEXT_CLASS = 'text-muted';

/** The bar of any other duration. */
export const DURATION_BAR_CLASS = 'bg-zinc-400 dark:bg-zinc-500';
