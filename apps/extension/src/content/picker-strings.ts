import type { AnchorPickerStrings, PickerOverlayStrings } from '@piwitests/picker-dom';
import { t } from '../shared/i18n.js';

/** Where a number goes in a text of the anchors step: the step fills it in. */
const COUNT = '{count}';

/** The picking overlay's texts in the interface language. A text the catalog lacks stays the overlay's English. */
export function pickerOverlayStrings(): PickerOverlayStrings {
  return {
    banner: t('pick_overlayBanner'),
    keys: t('pick_overlayKeys'),
    keysHovering: t('pick_overlayKeysHovering'),
    analyzing: t('pick_overlayAnalyzing'),
  };
}

/** The anchors step's texts in the interface language. A text the catalog lacks stays the step's English. */
export function anchorPickerStrings(): AnchorPickerStrings {
  return {
    title: t('pick_anchorsTitle'),
    hint: t('pick_anchorsHint'),
    noneSelected: t('pick_anchorsNoneSelected'),
    matchesOne: t('pick_anchorsMatchesOne'),
    matchesMany: t('pick_anchorsMatchesMany', { count: COUNT }),
    countUnavailable: t('pick_anchorsCountUnavailable'),
    containsOne: t('pick_anchorsContainsOne'),
    containsMany: t('pick_anchorsContainsMany', { count: COUNT }),
    needsTestId: t('pick_anchorsNeedsTestId'),
    noHook: t('pick_anchorsNoHook'),
    use: t('pick_anchorsUse'),
    skip: t('pick_anchorsSkip'),
  };
}
