import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/**
 * Text written straight into the UI, bypassing `t()`: a string or template
 * literal with a letter in it that is
 *
 * - assigned to `textContent`, `innerText`, `title`, `placeholder`, `ariaLabel` or `alt`;
 * - passed to `setAttribute` for `title`, `aria-label`, `placeholder` or `alt`;
 * - passed to `append`, `prepend`, `replaceChildren` or `createTextNode`;
 * - written as text, or as one of those attributes, inside an HTML template string.
 *
 * oxlint has no selector rule to express this, hence a test. The walk follows
 * `? :`, `??`, `||`, `+` and template parts, and stops at calls: `t('key')`
 * is a call.
 */

const root = path.resolve(import.meta.dirname, '..', '..');
const srcDir = path.join(root, 'src');

/** The only file allowed to hold UI text in code: it reads the catalogs. */
const SKIPPED = new Set(['src/shared/i18n.ts']);

const TEXT_PROPERTIES = new Set(['textContent', 'innerText', 'title', 'placeholder', 'ariaLabel', 'alt']);
const TEXT_ATTRIBUTES = new Set(['title', 'aria-label', 'placeholder', 'alt']);
const TEXT_METHODS = new Set(['append', 'prepend', 'replaceChildren', 'createTextNode']);

const LETTER = /\p{L}/u;

/** A stylesheet written into a `<style>`: rules in braces. */
function isStylesheet(node: ts.Expression): boolean {
  const text = staticText(node);
  return text !== null && /\{[^}]*:[^}]*\}/.test(text);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return name.endsWith('.ts') ? [full] : [];
  });
}

/** The literal text parts of an expression, through the operators that pass text along. */
function literalParts(node: ts.Expression): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isTemplateExpression(node)) {
    return [
      node.head.text,
      ...node.templateSpans.flatMap((span) => [...literalParts(span.expression), span.literal.text]),
    ];
  }
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) {
    return literalParts(node.expression);
  }
  if (ts.isConditionalExpression(node)) return [...literalParts(node.whenTrue), ...literalParts(node.whenFalse)];
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (
      op === ts.SyntaxKind.PlusToken ||
      op === ts.SyntaxKind.QuestionQuestionToken ||
      op === ts.SyntaxKind.BarBarToken ||
      op === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      return [...literalParts(node.left), ...literalParts(node.right)];
    }
  }
  return [];
}

/** The static text of a template or string literal, with each `${…}` as a space. */
function staticText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node))
    return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(' ');
  return null;
}

/** Text a reader would see in an HTML fragment: text between tags, and the text attributes. */
function htmlText(html: string): string[] {
  if (!/<[a-z][a-z0-9-]*[\s>/]/i.test(html)) return [];
  const withoutBlocks = html.replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, ' ');
  const found: string[] = [];
  for (const match of withoutBlocks.matchAll(/\s(title|aria-label|placeholder|alt)\s*=\s*(["'])(.*?)\2/gi)) {
    found.push(match[3]!);
  }
  const text = withoutBlocks
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .trim();
  if (text) found.push(text);
  return found;
}

interface Finding {
  line: number;
  text: string;
}

function findings(file: string): Finding[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const found: Finding[] = [];
  const report = (node: ts.Node, text: string) => {
    if (LETTER.test(text)) {
      found.push({ line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, text: text.trim() });
    }
  };
  const visit = (node: ts.Node) => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      TEXT_PROPERTIES.has(node.left.name.text) &&
      !isStylesheet(node.right)
    ) {
      for (const text of literalParts(node.right)) report(node, text);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const [first, second] = node.arguments;
      if (
        method === 'setAttribute' &&
        first &&
        second &&
        ts.isStringLiteral(first) &&
        TEXT_ATTRIBUTES.has(first.text)
      ) {
        for (const text of literalParts(second)) report(node, text);
      }
      if (TEXT_METHODS.has(method)) {
        for (const argument of node.arguments) for (const text of literalParts(argument)) report(node, text);
      }
    }
    const literal = staticText(node);
    if (literal !== null && !isStylesheet(node as ts.Expression))
      for (const text of htmlText(literal)) report(node, text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const files = sourceFiles(srcDir)
  .map((file) => path.relative(root, file).split(path.sep).join('/'))
  .filter((file) => !SKIPPED.has(file))
  .sort();

describe('no text written straight into the UI', () => {
  it.each(files)('%s takes its texts from the catalogs', (file) => {
    expect(findings(path.join(root, file))).toEqual([]);
  });
});
