import * as fs from 'node:fs';

/** Read a snippet of source code surrounding the given line, returning a formatted string with line numbers. Returns `null` on error. */
export function readSourceSnippet(file: string, line: number, context: number): string | null {
  try {
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');
    const start = Math.max(0, line - context - 1);
    const end = Math.min(lines.length, line + context);
    return lines
      .slice(start, end)
      .map((l, i) => {
        const lineNum = start + i + 1;
        const marker = lineNum === line ? '> ' : '  ';
        return `${marker}${String(lineNum).padStart(4)} | ${l}`;
      })
      .join('\n');
  } catch {
    return null;
  }
}
