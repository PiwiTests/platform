/**
 * Convert Playwright's JSON aria tree — the `aria/<callId>-<phase>.json` files a
 * 1.63 trace writes when `trace.snapshots.aria` is on — into the indented text
 * form the ARIA card renders and the page diff parses. Pure and node-free, so
 * the server, the demo and the UI share one converter.
 *
 * The JSON is an array of nodes: a bare string is a text node, an object carries
 * `role`, an optional `name`, boolean/enum state flags and an optional inline
 * `text` or nested `children`. The text form is one node per line, two spaces of
 * indent per level, state flags as `[marker]` suffixes — the same grammar
 * Playwright's own `ariaSnapshot()` dump uses.
 */

/** One node of a JSON aria tree: a bare string (text node) or an element node. */
export type AriaJsonNode = string | AriaJsonElement;

export interface AriaJsonElement {
  role?: string;
  name?: string;
  /** Inline text content when the node's only child is a text string. */
  text?: string;
  checked?: 'mixed' | boolean;
  disabled?: boolean;
  expanded?: boolean;
  active?: boolean;
  invalid?: string | boolean;
  level?: number;
  pressed?: 'mixed' | boolean;
  selected?: boolean;
  ariaHidden?: boolean;
  children?: AriaJsonNode[];
}

/** The bracketed state markers Playwright appends to a node's line, in its order. */
function stateMarkers(node: AriaJsonElement): string {
  let s = '';
  if (node.checked === 'mixed') s += ' [checked=mixed]';
  else if (node.checked === true) s += ' [checked]';
  if (node.disabled) s += ' [disabled]';
  if (node.expanded) s += ' [expanded]';
  if (node.active) s += ' [active]';
  if (node.invalid === 'grammar' || node.invalid === 'spelling') s += ` [invalid=${node.invalid}]`;
  else if (node.invalid === true) s += ' [invalid]';
  if (typeof node.level === 'number' && node.level) s += ` [level=${node.level}]`;
  if (node.pressed === 'mixed') s += ' [pressed=mixed]';
  else if (node.pressed === true) s += ' [pressed]';
  if (node.selected === true) s += ' [selected]';
  if (node.ariaHidden) s += ' [aria-hidden]';
  return s;
}

/** Render a JSON aria tree (an array of nodes) into the indented text form. */
export function ariaJsonTreeToText(nodes: AriaJsonNode[]): string {
  const lines: string[] = [];

  const visit = (node: AriaJsonNode, depth: number): void => {
    const pad = '  '.repeat(depth);

    if (typeof node === 'string') {
      const text = node.trim();
      if (text) lines.push(`${pad}- ${JSON.stringify(text)}`);
      return;
    }
    if (!node || typeof node !== 'object') return;

    const role = typeof node.role === 'string' ? node.role : '';
    if (!role) return;

    if (role === 'text') {
      const raw = typeof node.text === 'string' ? node.text : typeof node.name === 'string' ? node.name : '';
      const text = raw.trim();
      if (text) lines.push(`${pad}- ${JSON.stringify(text)}`);
      return;
    }

    let key = role;
    if (typeof node.name === 'string' && node.name) key += ` ${JSON.stringify(node.name)}`;
    key += stateMarkers(node);

    const inlineText = typeof node.text === 'string' ? node.text.trim() : '';
    if (inlineText && !(typeof node.name === 'string' && node.name)) {
      lines.push(`${pad}- ${key}: ${JSON.stringify(inlineText)}`);
    } else {
      lines.push(`${pad}- ${key}`);
    }

    for (const child of node.children ?? []) visit(child, depth + 1);
  };

  for (const node of nodes) visit(node, 0);
  return lines.join('\n');
}

/** Parse the raw bytes of an `aria/*.json` trace file into a node array, or null. */
export function parseAriaJsonTree(raw: string): AriaJsonNode[] | null {
  try {
    const json: unknown = JSON.parse(raw);
    return Array.isArray(json) ? (json as AriaJsonNode[]) : null;
  } catch {
    return null;
  }
}

/** Convert the raw bytes of an `aria/*.json` trace file to the text form, or null when empty/invalid. */
export function ariaJsonToText(raw: string): string | null {
  const tree = parseAriaJsonTree(raw);
  if (!tree) return null;
  const text = ariaJsonTreeToText(tree);
  return text.length > 0 ? text : null;
}

/**
 * The aria snapshot as text, preferring the JSON tree (a structured source with
 * states and boxes) over the YAML dump when a valid one is present. Falls back
 * to the YAML — and to null when neither yields anything.
 */
export function ariaTextPreferJson(
  ariaSnapshotJson: string | null | undefined,
  ariaSnapshotYaml: string | null | undefined,
): string | null {
  if (ariaSnapshotJson) {
    const text = ariaJsonToText(ariaSnapshotJson);
    if (text) return text;
  }
  return ariaSnapshotYaml ?? null;
}
