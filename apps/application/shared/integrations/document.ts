/**
 * A provider-neutral document tree. A ticket body or a wiki page is built once
 * as an `IssueDocument` and rendered per target markup (Markdown, ADF, …). The
 * renderers themselves arrive in a later milestone; this file is the model plus
 * a small builder helper.
 */

/** An inline run of text, optionally a link and/or styled. */
export type Inline = string | { text: string; href?: string; code?: boolean; strong?: boolean };

export type DocNode =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; inlines: Inline[] }
  | { type: 'bullets'; items: Inline[][] }
  | { type: 'code'; language?: string; text: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'facts'; rows: [label: string, value: Inline[]][] }
  | { type: 'rule' };

export interface IssueDocument {
  nodes: DocNode[];
}

/**
 * A tiny builder so callers assemble a document without repeating the node
 * shapes. `doc()` starts an empty document; each method appends a node and
 * returns the builder, and `build()` returns the finished `IssueDocument`.
 */
export function doc() {
  const nodes: DocNode[] = [];
  const builder = {
    heading(level: 1 | 2 | 3, text: string) {
      nodes.push({ type: 'heading', level, text });
      return builder;
    },
    paragraph(...inlines: Inline[]) {
      nodes.push({ type: 'paragraph', inlines });
      return builder;
    },
    bullets(items: Inline[][]) {
      nodes.push({ type: 'bullets', items });
      return builder;
    },
    code(text: string, language?: string) {
      nodes.push({ type: 'code', language, text });
      return builder;
    },
    table(headers: string[], rows: string[][]) {
      nodes.push({ type: 'table', headers, rows });
      return builder;
    },
    facts(rows: [label: string, value: Inline[]][]) {
      nodes.push({ type: 'facts', rows });
      return builder;
    },
    rule() {
      nodes.push({ type: 'rule' });
      return builder;
    },
    /** Append a pre-built node (or skip a falsy one, so sections degrade cleanly). */
    push(node: DocNode | null | undefined) {
      if (node) nodes.push(node);
      return builder;
    },
    build(): IssueDocument {
      return { nodes };
    },
  };
  return builder;
}
