import { BUG_EVIDENCE_LIMITS } from '@piwitests/core/bug-report';
import { ARIA_CHECKED_ROLES, DomModel, normalizeWhiteSpace, parentElementOrShadowHost } from './engine-aria.js';
import { isSensitiveField } from './sensitive-fields.js';

/**
 * An outline of part of the page for a bug report: roles, names and states,
 * in the YAML form of a Playwright ARIA snapshot, built by the extension's own
 * accessibility model (`DomModel`). It is an approximation of that snapshot,
 * never presented as one, so it is always called an outline.
 */

const LANDMARK_ROLES = new Set([
  'banner',
  'complementary',
  'contentinfo',
  'form',
  'main',
  'navigation',
  'region',
  'search',
]);

/** Roles whose element adds nothing to the outline but its children. */
const FLATTENED_ROLES = new Set(['generic', 'none', 'presentation']);

/** The nearest landmark around `element`, or the body when there is none. */
export function outlineRoot(element: Element | null, model: DomModel): Element {
  for (let el: Element | undefined = element ?? undefined; el; el = parentElementOrShadowHost(el)) {
    const role = model.role(el);
    if (role && LANDMARK_ROLES.has(role)) return el;
  }
  return element?.ownerDocument.body ?? document.body;
}

interface OutlineNode {
  role: string;
  name: string;
  attrs: string[];
  /** Text shown after the colon: a field's value, or the text of a node with no element children. */
  value: string | null;
  children: Array<OutlineNode | string>;
}

/** A YAML scalar: plain when that reads the same, double-quoted otherwise. */
function scalar(text: string): string {
  return /^[\w][\w .,!?()/'+-]*$/.test(text) && !/^(true|false|null|yes|no|~)$/i.test(text) && !/\s$/.test(text)
    ? text
    : JSON.stringify(text);
}

/** A field's value for the outline: never one that holds a secret (`isSensitiveField`). */
function fieldValue(element: Element): string | null {
  if (isSensitiveField(element)) return null;
  const tag = element.tagName;
  if (tag === 'INPUT') {
    const input = element as HTMLInputElement;
    if (['password', 'hidden', 'checkbox', 'radio', 'file', 'button', 'submit', 'reset', 'image'].includes(input.type))
      return null;
    return input.value;
  }
  if (tag === 'TEXTAREA') return (element as HTMLTextAreaElement).value;
  return null;
}

function attributesOf(element: Element, role: string, model: DomModel): string[] {
  const attrs: string[] = [];
  if (ARIA_CHECKED_ROLES.includes(role)) {
    const checked = model.checked(element);
    if (checked === 'mixed') attrs.push('checked=mixed');
    else if (checked) attrs.push('checked');
  }
  if (model.disabled(element)) attrs.push('disabled');
  const expanded = model.expanded(element);
  if (expanded) attrs.push('expanded');
  const level = model.level(element);
  if (level > 0) attrs.push(`level=${level}`);
  const pressed = model.pressed(element);
  if (pressed === 'mixed') attrs.push('pressed=mixed');
  else if (pressed) attrs.push('pressed');
  if (model.selected(element)) attrs.push('selected');
  return attrs;
}

function childNodesOf(node: Element): Node[] {
  if (node.tagName === 'SLOT') {
    const assigned = (node as HTMLSlotElement).assignedNodes({ flatten: true });
    if (assigned.length > 0) return assigned;
  }
  return [...(node.shadowRoot ?? node).childNodes];
}

function collect(
  parent: Element,
  model: DomModel,
  skip: (element: Element) => boolean,
  out: Array<OutlineNode | string>,
): void {
  for (const child of childNodesOf(parent)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = normalizeWhiteSpace(child.textContent ?? '');
      if (!text) continue;
      const last = out[out.length - 1];
      if (typeof last === 'string') out[out.length - 1] = `${last} ${text}`;
      else out.push(text);
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const element = child as Element;
    if (skip(element) || model.isHiddenForAria(element)) continue;
    const role = model.role(element);
    if (!role || FLATTENED_ROLES.has(role)) {
      collect(element, model, skip, out);
      continue;
    }
    out.push(nodeFor(element, role, model, skip));
  }
}

function nodeFor(element: Element, role: string, model: DomModel, skip: (element: Element) => boolean): OutlineNode {
  const name = model.normalizedAccessibleName(element, false);
  const children: Array<OutlineNode | string> = [];
  collect(element, model, skip, children);
  let value = fieldValue(element);
  // A node's own text is its name more often than not: say it once.
  const texts = children.filter((c): c is string => typeof c === 'string');
  if (texts.length === children.length) {
    const text = texts.join(' ');
    children.length = 0;
    if (value == null && text && text !== name) value = text;
  }
  return { role, name, attrs: attributesOf(element, role, model), value, children };
}

function render(nodes: Array<OutlineNode | string>, indent: string, lines: string[], max: number): void {
  for (const node of nodes) {
    if (lines.length >= max) return;
    if (typeof node === 'string') {
      lines.push(`${indent}- text: ${scalar(node)}`);
      continue;
    }
    let head = `${indent}- ${node.role}`;
    if (node.name) head += ` ${JSON.stringify(node.name)}`;
    for (const attr of node.attrs) head += ` [${attr}]`;
    if (node.children.length > 0) {
      lines.push(`${head}:`);
      render(node.children, `${indent}  `, lines, max);
    } else if (node.value) {
      lines.push(`${head}: ${scalar(node.value)}`);
    } else {
      lines.push(head);
    }
  }
}

/**
 * The outline of `root` and what is inside it, at most `maxLines` lines. A cut
 * outline ends with a line that says so. Elements `skip` accepts (the
 * extension's own overlays) are left out.
 */
export function buildOutline(
  root: Element,
  options: { model?: DomModel; maxLines?: number; skip?: (element: Element) => boolean } = {},
): string {
  const model = options.model ?? new DomModel();
  const skip = options.skip ?? (() => false);
  const max = options.maxLines ?? BUG_EVIDENCE_LIMITS.outlineLines;
  const role = root.tagName === 'BODY' ? null : model.role(root);
  const nodes: Array<OutlineNode | string> = [];
  if (role && !FLATTENED_ROLES.has(role)) nodes.push(nodeFor(root, role, model, skip));
  else collect(root, model, skip, nodes);
  const lines: string[] = [];
  render(nodes, '', lines, max + 1);
  if (lines.length > max) {
    lines.length = max - 1;
    lines.push(`- text: ${JSON.stringify(`… outline cut at ${max} lines`)}`);
  }
  return lines.join('\n');
}
