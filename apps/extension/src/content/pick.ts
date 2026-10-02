import {
  bindToTool,
  endTool,
  installEscapeToCancel,
  isToolActive,
  startTool,
  teardownToolSurfaces,
  toolIsCurrent,
  waitForGlobal,
} from '../shared/tool-session.js';
import {
  installPickerOverlay,
  removePickerOverlay,
  showAnchorPicker,
  generateAnchoredAlternatives,
  mergeCandidates,
  type PickedAnchorInfo,
} from '@piwitests/picker-dom';
import { headingLevel, TAG_TO_ROLE, INPUT_TYPE_TO_ROLE } from '@piwitests/core/locator-generation';
import { initI18n } from '../shared/i18n.js';
import { anchorPickerStrings, pickerOverlayStrings } from './picker-strings.js';
import { renderResultsPanel } from './results-panel.js';
import { checkLocators, installDescribeHook, rankElement, ROLE_SOURCES } from './verified-locators.js';

const PICK_GLOBALS = [
  '__piwiPickState',
  '__piwiPickedElement',
  '__piwiAnchorState',
  '__piwiPickAnchors',
  '__piwiPickChainCount',
] as const;

function clearPickGlobals(): void {
  for (const key of PICK_GLOBALS) delete (globalThis as any)[key];
}

/**
 * Runs the full guided pick flow: element pick (snap + tree-walk), optional
 * anchor scoping, ranked alternatives, then the results panel. A single
 * injection of this module runs this once. Injected again while a pick runs
 * (a second "Pick element" trigger), it leaves that pick be; any other tool
 * running gives way to it.
 */
async function runPick(): Promise<void> {
  const g = globalThis as any;
  if (isToolActive('pick')) return;
  const toolEpoch = startTool('pick', teardownToolSurfaces);
  installEscapeToCancel();
  const removeDescribeHook = bindToTool(toolEpoch, installDescribeHook());
  try {
    // The overlay, the anchors step and the results speak the language chosen in the settings.
    await initI18n();
    if (!toolIsCurrent(toolEpoch)) return;
    clearPickGlobals();
    installPickerOverlay({ transport: 'global', failing: null, strings: pickerOverlayStrings() });
    const state = await waitForGlobal<string>('__piwiPickState', toolEpoch);
    if (state !== 'picked' || !toolIsCurrent(toolEpoch)) return;
    // The element is ours now, so the picking overlay has done its job. Left
    // up it just sits there reading "Analyzing element…" — behind the anchors
    // step, and for the whole life of the results panel.
    removePickerOverlay();

    const el: Element = g.__piwiPickedElement;
    const { attrs, accessibleName, role, ranked: alternatives } = rankElement(el);
    const level = headingLevel({ ...attrs, accessibleName }, role);

    let anchors: PickedAnchorInfo[] = [];
    let chainLeafCount: number | undefined;
    if (role) {
      showAnchorPicker({
        tagRoles: TAG_TO_ROLE,
        inputRoles: INPUT_TYPE_TO_ROLE,
        roleSources: ROLE_SOURCES,
        leafRole: role,
        leafLevel: level,
        leafTestId: attrs.attributes['data-testid'] ?? null,
        strings: anchorPickerStrings(),
      });
      const anchorState = await waitForGlobal<string>('__piwiAnchorState', toolEpoch);
      if (!toolIsCurrent(toolEpoch)) return;
      if (anchorState === 'done') {
        anchors = g.__piwiPickAnchors ?? [];
        chainLeafCount = g.__piwiPickChainCount;
      }
    }

    const ranked = mergeCandidates(
      alternatives,
      generateAnchoredAlternatives({ role, level }, anchors, chainLeafCount),
    );
    // Checked on the page as it is when the panel opens: verified first, then the others with their real count.
    const checked = checkLocators(el, ranked, { keepAmbiguous: true });
    if (checked.length === 0) return;
    await renderResultsPanel(checked, el, toolEpoch);
  } catch (err) {
    // A throw anywhere after the pick is logged, and the overlay goes below:
    // left up, it would read "Analyzing element…" for good.
    console.warn('[Piwi Picker] the pick flow failed:', err);
  } finally {
    removeDescribeHook();
    // Belt and braces: covers the early returns above (no locators generated,
    // pick skipped) as well as anything thrown. A pick another tool took over
    // from leaves the overlay and the pick globals to that tool.
    if (toolIsCurrent(toolEpoch)) {
      removePickerOverlay();
      clearPickGlobals();
    }
    endTool(toolEpoch);
  }
}

void runPick();
