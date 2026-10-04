/**
 * The attributes whose change can change what a locator finds or how an
 * element is named: roles and ARIA states, names and labels, visibility, and
 * the attributes test ids are commonly read from. The overlays that follow
 * the page observe these alone, so a page changing any other attribute does
 * not keep them scanning.
 */
export const LOCATOR_ATTRIBUTES = [
  'class',
  'style',
  'hidden',
  'open',
  'id',
  'role',
  'type',
  'name',
  'value',
  'href',
  'for',
  'title',
  'alt',
  'placeholder',
  'disabled',
  'readonly',
  'contenteditable',
  'aria-label',
  'aria-labelledby',
  'aria-describedby',
  'aria-hidden',
  'aria-disabled',
  'aria-checked',
  'aria-selected',
  'aria-expanded',
  'aria-pressed',
  'aria-level',
  'data-testid',
  'data-test-id',
  'data-test',
  'data-qa',
  'data-cy',
];
