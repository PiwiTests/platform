/**
 * Readable names for the action keys the locator index stores
 * (`selectOption`, `expect.not.toBeVisible`, …), in sentence case.
 */
const ACTION_LABELS: Record<string, string> = {
  click: 'Click',
  dblclick: 'Double click',
  fill: 'Fill',
  selectOption: 'Select option',
  check: 'Check',
  uncheck: 'Uncheck',
  hover: 'Hover',
  tap: 'Tap',
  focus: 'Focus',
  blur: 'Blur',
  press: 'Press',
  type: 'Type',
  setInputFiles: 'Set input files',
  dragTo: 'Drag and drop',
  drop: 'Drop',
  dispatchEvent: 'Dispatch event',
  scrollIntoViewIfNeeded: 'Scroll into view',
  waitFor: 'Wait for',
  count: 'Count',
  evaluate: 'Evaluate',
  expect: 'Expect',
  other: 'Other',
};

export function locatorActionLabel(action: string): string {
  if (action.startsWith('expect.')) {
    const rest = action.slice('expect.'.length);
    return rest.startsWith('not.') ? `Expect not ${rest.slice(4)}` : `Expect ${rest}`;
  }
  return ACTION_LABELS[action] ?? action;
}
