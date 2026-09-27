import { describe, it, expect } from 'vitest';
import { parseSourceSnippet } from '../../shared/source-snippet';

describe('parseSourceSnippet', () => {
  // The reporter's format: `<marker><padded line no> | <code>`.
  const snippet = [
    '     8 |  * The Pay button stays disabled,',
    '     9 | ',
    ">   16 |   await page.getByRole('button', { name: 'Pay' }).click();",
    '*   17 | test("pays", async () => {',
  ].join('\n');

  it('splits each row into its gutter, line number and code', () => {
    expect(parseSourceSnippet(snippet)).toEqual([
      { gutter: '     8 | ', line: 8, code: ' * The Pay button stays disabled,', failing: false },
      { gutter: '     9 | ', line: 9, code: '', failing: false },
      {
        gutter: '>   16 | ',
        line: 16,
        code: "  await page.getByRole('button', { name: 'Pay' }).click();",
        failing: true,
      },
      { gutter: '*   17 | ', line: 17, code: 'test("pays", async () => {', failing: false },
    ]);
  });

  it('keeps a row without a line number as plain code', () => {
    expect(parseSourceSnippet('     |     ^')).toEqual([
      { gutter: '', line: null, code: '     |     ^', failing: false },
    ]);
  });
});
