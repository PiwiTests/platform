/**
 * ARIA-snapshot rendering — the accessibility-tree view of a failure. Used as
 * the fallback for executions with no stored trace (only the captured ARIA
 * tree), and as an on-demand alternative view even when a trace *is* available.
 *
 * Playwright's `ariaSnapshot()` dump is an indented, YAML-ish tree; this module
 * parses that tree back into a real hierarchy and renders it as a nested,
 * inspector-style view (role chips + accessible names + state badges, drawn
 * with tree guides). Pickable rows
 * carry real `role` / `aria-label` / `aria-level` attributes so the interactive
 * locator picker probes them into correct `getByRole` / `getByText` locators.
 *
 * Kept in its own module (no node-only imports) so the browser demo can render
 * it too: the trace path in `dom-snapshot.ts` pulls in node-only zlib, but this
 * renderer needs nothing beyond string parsing. `dom-snapshot.ts` re-exports it,
 * so server callers are unchanged.
 */

/** One node parsed out of an `ariaSnapshot()` dump. */
interface AriaTreeNode {
  role: string;
  /** Accessible name (quoted in the dump), when present. */
  name: string | null;
  /** Heading level parsed from a `[level=N]` marker, null when absent. */
  level: number | null;
  /** State markers: `disabled`, `checked`, `expanded`, `checked=mixed`, … */
  states: string[];
  /** Trailing text value (for `text:`/`paragraph:` nodes with inline content). */
  value: string | null;
  children: AriaTreeNode[];
}

/** The accessible name is untrusted tested-page DOM — escape in both contexts. */
function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const unescapeName = (s: string): string => s.replace(/\\(.)/g, '$1');

/** Roles that carry no useful `getByRole` locator — picked via text instead. */
const NO_ROLE_LOCATOR = new Set(['generic', 'none', 'presentation', 'paragraph', 'text']);
/** Nameless structural wrappers whose children are hoisted so the tree stays legible. */
const HOISTED_WHEN_NAMELESS = new Set(['generic', 'none', 'presentation']);

/** Role → inline chip style (background + text color). */
const ARIA_ROLE_COLORS: Record<string, string> = {
  button: 'background:#dbeafe;color:#1e40af',
  link: 'background:#dbeafe;color:#1e40af',
  heading: 'background:#f3e8ff;color:#6b21a8',
  textbox: 'background:#dcfce7;color:#166534',
  searchbox: 'background:#dcfce7;color:#166534',
  combobox: 'background:#dcfce7;color:#166534',
  listbox: 'background:#dcfce7;color:#166534',
  spinbutton: 'background:#dcfce7;color:#166534',
  slider: 'background:#dcfce7;color:#166534',
  checkbox: 'background:#fef3c7;color:#92400e',
  radio: 'background:#fef3c7;color:#92400e',
  switch: 'background:#fef3c7;color:#92400e',
  navigation: 'background:#f1f5f9;color:#334155',
  main: 'background:#f1f5f9;color:#334155',
  banner: 'background:#f1f5f9;color:#334155',
  contentinfo: 'background:#f1f5f9;color:#334155',
  complementary: 'background:#f1f5f9;color:#334155',
  region: 'background:#f1f5f9;color:#334155',
  form: 'background:#f1f5f9;color:#334155',
  search: 'background:#f1f5f9;color:#334155',
  article: 'background:#f1f5f9;color:#334155',
  dialog: 'background:#ffe4e6;color:#9f1239',
  alert: 'background:#fee2e2;color:#991b1b',
  img: 'background:#fce7f3;color:#9d174d',
  list: 'background:#f8fafc;color:#475569',
  listitem: 'background:#f8fafc;color:#475569',
  tab: 'background:#e0e7ff;color:#3730a3',
  tablist: 'background:#e0e7ff;color:#3730a3',
  tabpanel: 'background:#f5f3ff;color:#5b21b6',
  menuitem: 'background:#f8fafc;color:#475569',
  menu: 'background:#f8fafc;color:#475569',
  option: 'background:#f8fafc;color:#475569',
  table: 'background:#f1f5f9;color:#334155',
  rowgroup: 'background:#f8fafc;color:#475569',
  row: 'background:#f8fafc;color:#475569',
  columnheader: 'background:#e0e7ff;color:#3730a3',
  rowheader: 'background:#e0e7ff;color:#3730a3',
  cell: 'background:#f8fafc;color:#475569',
  gridcell: 'background:#f8fafc;color:#475569',
  separator: 'background:#f8fafc;color:#94a3b8',
};

/** Parse the content after `- ` on one snapshot line into a node (null if unparseable). */
function parseNodeContent(content: string): AriaTreeNode | null {
  const s = content.trim();
  if (!s) return null;

  const roleMatch = s.match(/^([a-zA-Z]+)/);
  if (!roleMatch) {
    // A bare quoted string is a text node: `- "some text"`.
    const quoted = s.match(/^"((?:[^"\\]|\\.)*)"/);
    if (quoted) {
      return { role: 'text', name: null, level: null, states: [], value: unescapeName(quoted[1]!), children: [] };
    }
    return null;
  }

  const role = roleMatch[1]!.toLowerCase();
  let rest = s.slice(roleMatch[0].length);

  // Accessible name, quoted right after the role.
  let name: string | null = null;
  const nameMatch = rest.match(/^\s+"((?:[^"\\]|\\.)*)"/);
  if (nameMatch) {
    name = unescapeName(nameMatch[1]!);
    rest = rest.slice(nameMatch[0].length);
  }

  // `[level=N]` and other `[state]` / `[state=value]` markers (ignore `[ref=eN]`).
  let level: number | null = null;
  const states: string[] = [];
  for (const marker of rest.matchAll(/\[([a-z][a-z0-9-]*)(?:=([^\]]*))?\]/gi)) {
    const key = marker[1]!.toLowerCase();
    const val = marker[2];
    if (key === 'level') level = val != null ? Number(val) : null;
    else if (key === 'ref') continue;
    else states.push(val != null ? `${key}=${val}` : key);
  }

  // Inline text value: `text: hello`, `paragraph: some text` (a bare trailing
  // `:` just opens a child block and carries no value).
  let value: string | null = null;
  const withoutBrackets = rest.replace(/\[[^\]]*\]/g, '').trim();
  if (withoutBrackets.startsWith(':')) {
    let after = withoutBrackets.slice(1).trim();
    const q = after.match(/^"((?:[^"\\]|\\.)*)"$/);
    if (q) after = unescapeName(q[1]!);
    if (after) value = after;
  }

  return { role, name, level, states, value, children: [] };
}

/** Parse the whole snapshot into a tree, nesting by leading-whitespace indent. */
function parseAriaTree(ariaSnapshot: string): AriaTreeNode[] {
  const root: AriaTreeNode = { role: '', name: null, level: null, states: [], value: null, children: [] };
  const stack: { indent: number; node: AriaTreeNode }[] = [{ indent: -1, node: root }];

  for (const rawLine of ariaSnapshot.split('\n')) {
    const m = rawLine.match(/^(\s*)-\s+(.*)$/);
    if (!m) continue;
    const indent = m[1]!.length;
    const node = parseNodeContent(m[2]!);
    if (!node) continue;
    while (stack.length > 1 && stack[stack.length - 1]!.indent >= indent) stack.pop();
    stack[stack.length - 1]!.node.children.push(node);
    stack.push({ indent, node });
  }
  return root.children;
}

/** The text a node contributes to picking: its value for text nodes, else its name. */
function nodeText(node: AriaTreeNode): string {
  const isTextual = node.role === 'text' || (node.role === 'paragraph' && !!node.value && !node.name);
  const raw = isTextual ? (node.value ?? '') : (node.name ?? '');
  return raw.length > 300 ? raw.slice(0, 300) : raw;
}

function renderNode(node: AriaTreeNode): string {
  const isTextual = node.role === 'text' || (node.role === 'paragraph' && !!node.value && !node.name);
  const text = nodeText(node);
  const hasRoleLocator = !NO_ROLE_LOCATOR.has(node.role);
  // Only nodes with an accessible name (or textual value) yield a useful locator.
  const pickable = text.trim().length > 0;

  const badges: string[] = [];
  if (node.level != null && Number.isFinite(node.level)) badges.push(`level ${node.level}`);
  for (const st of node.states) badges.push(st);
  const badgeStr = badges.join(' · ');

  // Rows are marked and styled via data-* attributes, never `class`: the picker
  // probe reads `class` off the picked element, so a styling class here would
  // leak a bogus `locator('.pw-row')` alternative for every ARIA pick.
  let attrs = ` data-pw-row data-role="${escapeAttr(node.role)}"`;
  if (isTextual) attrs += ' data-pw-text';
  if (node.name) attrs += ` data-name="${escapeAttr(node.name)}"`;
  if (badgeStr) attrs += ` data-badges="${escapeAttr(badgeStr)}"`;

  if (pickable) {
    attrs += ' data-pw-pick';
    // Real ARIA attributes so the picker probe resolves the right role/name.
    if (hasRoleLocator) {
      attrs += ` role="${escapeAttr(node.role)}"`;
      if (node.name) attrs += ` aria-label="${escapeAttr(node.name)}"`;
      if (node.level != null && Number.isFinite(node.level)) attrs += ` aria-level="${node.level}"`;
    }
  }

  const row = `<div${attrs}>${escapeText(text)}</div>`;
  const kids = node.children.length ? `<div data-pw-children>${renderNodes(node.children)}</div>` : '';
  return `<div data-pw-node>${row}${kids}</div>`;
}

function renderNodes(nodes: AriaTreeNode[]): string {
  let out = '';
  for (const node of nodes) {
    // Hoist the children of nameless structural wrappers so the tree isn't
    // buried under `generic`/`presentation` rows that carry no information.
    if (HOISTED_WHEN_NAMELESS.has(node.role) && !node.name && !node.value) {
      out += renderNodes(node.children);
      continue;
    }
    out += renderNode(node);
  }
  return out;
}

/**
 * Per-role chip color rules generated from ARIA_ROLE_COLORS. Attribute values
 * are left unquoted (valid, since roles are CSS identifiers) so the stylesheet
 * never contains the `data-role="…"` string the rendered rows carry.
 */
function roleChipCss(): string {
  return Object.entries(ARIA_ROLE_COLORS)
    .map(([role, style]) => `[data-pw-row][data-role=${role}]::before{${style}}`)
    .join('\n');
}

/**
 * Render a Playwright ARIA snapshot to a standalone HTML document — a nested,
 * inspector-style accessibility tree. Each node is a role-colored chip plus its
 * accessible name and any level/state badges, indented under its parent with
 * tree guides. Pickable rows carry `data-role`/`data-name` and real
 * `role`/`aria-label`/`aria-level` so the locator picker probes them correctly.
 * Returns null when the snapshot yields no renderable nodes.
 *
 * The accessible name is untrusted (tested-page DOM) and this HTML is loaded
 * into a sandboxed iframe, so it is escaped in both attribute and text contexts.
 */
export function renderAriaSnapshotHtml(ariaSnapshot: string): string | null {
  const tree = parseAriaTree(ariaSnapshot);
  const body = renderNodes(tree);
  if (!body) return null;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}
  body{margin:0;padding:10px 12px;font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:12.5px;color:#0f172a;background:#fff}
  [data-pw-node]{position:relative}
  [data-pw-children]{margin-left:9px;padding-left:11px;border-left:1px solid #e2e8f0}
  [data-pw-row]{position:relative;padding:2px 6px;margin:1px 0;border-radius:5px;line-height:1.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
  [data-pw-row]::before{content:attr(data-role);display:inline-block;font-size:9.5px;font-weight:600;text-transform:uppercase;letter-spacing:.03em;padding:1px 5px;border-radius:4px;margin-right:6px;background:#eef2f7;color:#475569;vertical-align:middle}
  [data-pw-row][data-badges]::after{content:attr(data-badges);margin-left:7px;font-size:10px;color:#94a3b8;padding:0 5px;border:1px solid #e2e8f0;border-radius:4px;vertical-align:middle}
  [data-pw-text]{color:#64748b;font-style:italic}
  [data-pw-text]::before{background:transparent;color:#94a3b8;border:1px dashed #cbd5e1}
  [data-pw-pick]{cursor:pointer}
  [data-pw-pick]:hover{background:rgba(124,58,237,.10);outline:1px solid rgba(124,58,237,.35)}
${roleChipCss()}
  @media(prefers-color-scheme:dark){
    body{color:#e5e7eb;background:#0b0f19}
    [data-pw-children]{border-left-color:#334155}
    [data-pw-row]::before{background:#1e293b;color:#94a3b8}
    [data-pw-row][data-badges]::after{color:#94a3b8;border-color:#334155}
    [data-pw-text]{color:#94a3b8}
    [data-pw-text]::before{background:transparent;color:#94a3b8;border-color:#475569}
    [data-pw-pick]:hover{background:rgba(139,92,246,.22);outline-color:rgba(139,92,246,.5)}
  }
</style></head>
<body><div data-pw-tree>${body}</div></body></html>`;
}
