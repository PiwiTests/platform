import { describe, test, expect } from 'vitest';
import {
  ANSWER_SIMILARITY,
  RELATED_SIMILARITY,
  KeywordIndex,
  addIntroduced,
  assess,
  assessKeywords,
  candidateSentences,
  clipBlock,
  denseScores,
  excerpt,
  fuseRankings,
  identifiersIn,
  limitPerPage,
  looksLikeIdentifier,
  mentionsIdentifier,
  parseVectors,
  pickSources,
  quoteBlocks,
  rankPassages,
  searchTerms,
  selectBlocks,
  splitBlocks,
  splitSentences,
  toPlain,
  topScores,
  type Block,
  type Passage,
  type ScoredBlock,
} from '../../../docs/.vitepress/theme/ask-docs/search';

const passage = (page: string, headings: string[], text: string): Passage => ({
  page,
  anchor: headings[0]?.toLowerCase().replace(/\s+/g, '-') ?? '',
  title: page,
  headings,
  text,
});

describe('searchTerms', () => {
  test('lower-cases, drops a plural s and removes stop words', () => {
    expect(searchTerms('How do the Failures group?')).toEqual(['failure', 'group']);
  });

  test('an identifier counts as itself and as its parts', () => {
    expect(searchTerms('PIWI_AI_PROVIDER')).toEqual(['piwi_ai_provider', 'piwi', 'ai', 'provider']);
    expect(searchTerms('runLabel')).toEqual(['runlabel', 'run', 'label']);
  });
});

describe('identifiers', () => {
  test('identifiersIn finds names as typed', () => {
    expect(identifiersIn('what does runLabel do')).toEqual(['runLabel']);
    expect(identifiersIn('set PIWI_DASHBOARD_URL')).toEqual(['PIWI_DASHBOARD_URL']);
    expect(identifiersIn('how do I find flaky tests?')).toEqual([]);
  });

  test('looksLikeIdentifier is true for a short query holding a name', () => {
    expect(looksLikeIdentifier('wrapConfig')).toBe(true);
    expect(looksLikeIdentifier('PIWI_DASHBOARD_URL')).toBe(true);
    expect(looksLikeIdentifier('runLabel option')).toBe(true);
    expect(looksLikeIdentifier('what does the runLabel option do exactly')).toBe(false);
    expect(looksLikeIdentifier('how do I find flaky tests?')).toBe(false);
  });

  test('mentionsIdentifier ignores case', () => {
    expect(mentionsIdentifier('Set runlabel explicitly.', ['runLabel'])).toBe(1);
    expect(mentionsIdentifier('Set the label explicitly.', ['runLabel'])).toBe(0);
  });
});

describe('vectors', () => {
  const dim = 4;
  /** Unit vectors quantized the way scripts/generate-rag-index.mjs writes them. */
  function pack(rows: number[][]): ArrayBuffer {
    const scales = new Float32Array(rows.length);
    const data = new Int8Array(rows.length * dim);
    rows.forEach((row, i) => {
      const scale = Math.max(...row.map(Math.abs)) / 127;
      scales[i] = scale;
      data.set(
        row.map((x) => Math.round(x / scale)),
        i * dim,
      );
    });
    const bytes = Buffer.concat([Buffer.from(scales.buffer), Buffer.from(data.buffer)]);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }

  test('denseScores returns the cosine similarity of each row', () => {
    const store = parseVectors(
      pack([
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0.6, 0.8, 0, 0],
      ]),
      3,
      dim,
    );
    const scores = denseScores(store, [0.6, 0.8, 0, 0]);
    expect(scores[0]).toBeCloseTo(0.6, 2);
    expect(scores[1]).toBeCloseTo(0.8, 2);
    expect(scores[2]).toBeCloseTo(1, 2);
    expect(topScores(scores, 2).map((hit) => hit.index)).toEqual([2, 1]);
  });

  test('parseVectors rejects a file of the wrong size', () => {
    expect(() => parseVectors(new ArrayBuffer(10), 3, dim)).toThrow(/expected 24/);
  });
});

describe('toPlain', () => {
  test('keeps the words a reader sees', () => {
    const markdown =
      'Set **`PIWI_AI_PROVIDER`** in the [reporter options](/guide/reporter#options) and see _this_ note.';
    expect(toPlain(markdown)).toBe('Set PIWI_AI_PROVIDER in the reporter options and see this note.');
  });

  test('a code span keeps its underscores and asterisks', () => {
    expect(toPlain('Use `PIWI_AI_*` and `_config`.')).toBe('Use PIWI_AI_* and _config.');
  });

  test('drops quote and heading markers, and turns a table row into its cells', () => {
    expect(toPlain('> **Tip**')).toBe('Tip');
    expect(toPlain('## Options')).toBe('Options');
    expect(toPlain('| Name | Value |\n|------|-------|\n| `a` | one<br>two |')).toBe('Name | Value\n\na | one two');
  });

  test('leaves code fences as written', () => {
    const fence = '```bash\nnpx piwi **init** [x](y)\n```';
    expect(toPlain(fence)).toBe(fence);
  });
});

describe('splitBlocks', () => {
  const markdown = [
    '## Heading that is not content',
    '',
    'Piwi keeps every run so you can compare a failure with the last green one. It also groups failures.',
    'A second line of the same paragraph.',
    '- First item with enough words to count',
    '- Second item, with a [link](/guide/ci) inside',
    '  and a continuation line',
    '',
    '| Option | Meaning |',
    '| --- | --- |',
    '| `retries` | How many times a failing test is tried again |',
    '| `workers` | The number of parallel workers |',
    '',
    '```bash',
    'npx piwi report --open',
    '```',
    '',
    '> **Tip**',
    '>',
    '> Keep the reporter and the dashboard on the same version.',
  ].join('\n');
  const blocks = splitBlocks(markdown);

  test('classifies paragraphs, lists, tables, code and quotations', () => {
    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'list', 'table', 'code', 'quote']);
  });

  test('a heading is not a block, and a list interrupts a paragraph without a blank line', () => {
    expect(blocks[0]!.markdown).not.toContain('##');
    expect(blocks[0]!.markdown).not.toContain('First item');
    expect(blocks[1]!.markdown.split('\n')).toHaveLength(3);
  });

  test('a block keeps its Markdown and lists what can be quoted from it', () => {
    expect(blocks[3]!.markdown).toBe('```bash\nnpx piwi report --open\n```');
    expect(blocks[3]!.sentences).toEqual([]);
    // "It also groups failures." is under 30 characters: too short to quote.
    expect(blocks[0]!.sentences).toEqual([
      'Piwi keeps every run so you can compare a failure with the last green one.',
      'A second line of the same paragraph.',
    ]);
    expect(blocks[1]!.sentences).toEqual([
      'First item with enough words to count',
      'Second item, with a link inside and a continuation line',
    ]);
  });

  test('table rows are sentences, the header row is not', () => {
    expect(blocks[2]!.sentences).toEqual([
      'retries – How many times a failing test is tried again',
      'workers – The number of parallel workers',
    ]);
  });

  test('candidateSentences can leave the table rows out', () => {
    expect(candidateSentences(markdown, { rows: false })).not.toContain('workers – The number of parallel workers');
    expect(candidateSentences(markdown)).toContain('workers – The number of parallel workers');
  });
});

describe('splitSentences', () => {
  test('breaks at a capital and keeps abbreviations together', () => {
    expect(splitSentences('It runs. Then it stops. See e.g. the guide for more.')).toEqual([
      'It runs.',
      'Then it stops.',
      'See e.g. the guide for more.',
    ]);
  });
});

describe('clipBlock', () => {
  const block = (kind: Block['kind'], markdown: string): Block => ({ kind, markdown, sentences: [] });

  test('leaves a short block as it is', () => {
    expect(clipBlock(block('paragraph', 'Short.'), 100)).toEqual({ markdown: 'Short.', clipped: false });
  });

  test('cuts a paragraph at a word', () => {
    const clipped = clipBlock(block('paragraph', `${'word '.repeat(60)}end`), 40);
    expect(clipped.clipped).toBe(true);
    expect(clipped.markdown.endsWith('…')).toBe(true);
    expect(clipped.markdown.length).toBeLessThanOrEqual(41);
  });

  test('a table keeps its header, its rule and one row', () => {
    const rows = Array.from({ length: 30 }, (_unused, i) => `| row ${i} | value of row number ${i} |`);
    const clipped = clipBlock(block('table', ['| Name | Value |', '| --- | --- |', ...rows].join('\n')), 120);
    const lines = clipped.markdown.split('\n');
    expect(lines.slice(0, 3)).toEqual(['| Name | Value |', '| --- | --- |', '| row 0 | value of row number 0 |']);
    expect(clipped.clipped).toBe(true);
    expect(lines.length).toBeLessThan(30);
  });

  test('a code sample keeps its fences', () => {
    const code = ['```bash', ...Array.from({ length: 40 }, (_unused, i) => `command --number ${i}`), '```'].join('\n');
    const clipped = clipBlock(block('code', code), 200);
    expect(clipped.markdown.startsWith('```bash')).toBe(true);
    expect(clipped.markdown.endsWith('```')).toBe(true);
    expect(clipped.clipped).toBe(true);
  });
});

describe('KeywordIndex', () => {
  const passages = [
    passage('guide/ci', ['Troubleshooting'], 'Shards create several runs instead of one. Set `runLabel` explicitly.'),
    passage('guide/concepts', ['Test run'], 'A test run is one execution of the suite. The run label names it.'),
    passage('operate/database', ['PostgreSQL'], 'Point the dashboard at a shared PostgreSQL database.'),
    passage('guide/other', ['Setup'], 'See [the setup](/guide/reporter#options) for the steps.'),
  ];
  const index = new KeywordIndex(passages);

  test('ranks the passage with the exact name first', () => {
    expect(index.search('runLabel', 5)[0]?.index).toBe(0);
  });

  test('matches a plural and a heading word', () => {
    expect(index.search('postgres databases', 5)[0]?.index).toBe(2);
    expect(index.search('troubleshooting', 5)[0]?.index).toBe(0);
  });

  test('indexes the words of a link, not its target', () => {
    expect(index.search('setup', 5).map((hit) => hit.index)).toContain(3);
    expect(index.search('reporter', 5)).toEqual([]);
  });

  test('reports how many query terms a passage holds', () => {
    const [best] = index.search('shared postgresql database', 5);
    expect(best).toMatchObject({ index: 2, matched: 3 });
  });

  test('unknownShare is the part of the query the docs never use', () => {
    expect(index.unknownShare('postgresql database')).toBe(0);
    expect(index.unknownShare('netflix password')).toBe(1);
    expect(index.unknownShare('netflix postgresql')).toBe(0.5);
  });
});

describe('ranking', () => {
  const dense = [
    { index: 1, score: 0.7 },
    { index: 2, score: 0.6 },
    { index: 0, score: 0.5 },
  ];
  const keyword = [
    { index: 2, score: 9 },
    { index: 3, score: 8 },
    { index: 1, score: 1 },
  ];

  test('a passage in both lists outranks one in a single list', () => {
    const fused = fuseRankings({ hits: dense, weight: 1 }, { hits: keyword, weight: 1 });
    expect(
      fused
        .map((hit) => hit.index)
        .slice(0, 2)
        .sort(),
    ).toEqual([1, 2]);
    expect(fused.map((hit) => hit.index)).toContain(3);
  });

  test('a bare name is ranked by keywords alone', () => {
    expect(rankPassages('runLabel', dense, keyword)).toBe(keyword);
  });

  test('without embeddings the keyword list is used as is', () => {
    expect(rankPassages('how do I merge shards?', [], keyword)).toBe(keyword);
  });

  test('a question fuses both lists', () => {
    expect(rankPassages('how do I merge shards?', dense, keyword).map((hit) => hit.index)).toContain(0);
  });

  test('limitPerPage keeps at most n passages of a page', () => {
    const passages = [passage('a', [], ''), passage('a', [], ''), passage('a', [], ''), passage('b', [], '')];
    const ranked = [0, 1, 2, 3].map((index) => ({ index, score: 1 }));
    expect(limitPerPage(ranked, passages, 2, 5).map((hit) => hit.index)).toEqual([0, 1, 3]);
    expect(limitPerPage(ranked, passages, 2, 1).map((hit) => hit.index)).toEqual([0]);
  });

  test('pickSources keeps the passages that hold a bare name, when there are any', () => {
    const passages = [
      passage('a', [], 'Nothing about the name here.'),
      passage('b', [], 'Set `runLabel` explicitly.'),
      passage('c', [], 'Another passage without it.'),
    ];
    const ranked = [0, 1, 2].map((index) => ({ index, score: 1 }));
    expect(pickSources('runLabel', ranked, passages).map((hit) => hit.index)).toEqual([1]);
    expect(pickSources('anything else', ranked, passages).map((hit) => hit.index)).toEqual([0, 1, 2]);
    expect(pickSources('missingName', ranked, passages).map((hit) => hit.index)).toEqual([0, 1, 2]);
  });
});

describe('excerpt', () => {
  test('prefers the sentence that uses the query terms', () => {
    const text =
      'The dashboard shows every run in a list ordered by date. [Quarantine](/features/flaky-tests) keeps a flaky test out of the failing count.';
    expect(excerpt(text, 'quarantine a flaky test')).toBe('Quarantine keeps a flaky test out of the failing count.');
    expect(excerpt(text, 'unrelated words here')).toBe('The dashboard shows every run in a list ordered by date.');
  });

  test('clips a long sentence at a word', () => {
    const clipped = excerpt(`${'word '.repeat(100)}end.`, 'word', 40);
    expect(clipped.length).toBeLessThanOrEqual(41);
    expect(clipped.endsWith('…')).toBe(true);
  });
});

describe('answer blocks', () => {
  const scored = (
    markdown: string,
    passageRank: number,
    order: number,
    score: number,
    kind: Block['kind'] = 'paragraph',
  ): ScoredBlock => ({
    block: { kind, markdown, sentences: [markdown] },
    passage: passageRank,
    order,
    score,
  });

  test('selectBlocks keeps blocks near the best score, in reading order', () => {
    const chosen = selectBlocks([
      scored('Second passage block that is close to the best one.', 1, 0, 0.7),
      scored('First passage block that holds the best score overall.', 0, 3, 0.72),
      scored('A far weaker block that is not quoted at all here.', 0, 0, 0.62),
    ]);
    expect(chosen.map((item) => item.block.markdown)).toEqual([
      'First passage block that holds the best score overall.',
      'Second passage block that is close to the best one.',
    ]);
  });

  test('selectBlocks quotes nothing below the floor', () => {
    expect(selectBlocks([scored('A block that is not close to the question at all.', 0, 0, 0.5)])).toEqual([]);
  });

  test('selectBlocks skips a near repeat and stops at three blocks', () => {
    const chosen = selectBlocks([
      scored('Piwi groups failures that share an error fingerprint together.', 0, 0, 0.75),
      scored('Piwi groups failures that share an error fingerprint together again.', 0, 1, 0.74),
      scored('Each cluster is triaged once from the failure inbox screen.', 0, 2, 0.73),
      scored('A cluster carries a suggested fix from the diagnosis panel.', 0, 3, 0.72),
      scored('Clusters can be exported as a bundle for someone else to read.', 0, 4, 0.71),
    ]);
    expect(chosen.map((item) => item.order)).toEqual([0, 2, 3]);
  });

  test('selectBlocks stays within the budget but always keeps the best block', () => {
    const long = (word: string) => `${word} `.repeat(120).trim();
    const chosen = selectBlocks(
      [scored(long('alpha'), 0, 0, 0.75), scored(long('bravo'), 0, 1, 0.74), scored(long('charlie'), 0, 2, 0.73)],
      0.6,
      0.06,
      1000,
    );
    expect(chosen).toHaveLength(1);
    expect(chosen[0]!.block.markdown).toContain('alpha');
  });

  test('addIntroduced adds the block a paragraph ending with a colon introduces', () => {
    const introduction: Block = { kind: 'paragraph', markdown: 'Run this command:', sentences: ['Run this command:'] };
    const command: Block = { kind: 'code', markdown: '```bash\nnpx piwi init\n```', sentences: [] };
    const after: Block = { kind: 'paragraph', markdown: 'Something else entirely.', sentences: [] };
    const chosen: ScoredBlock[] = [{ block: introduction, passage: 0, order: 0, score: 0.7 }];
    const added = addIntroduced(chosen, [[introduction, command, after]]);
    expect(added.map((item) => item.block.kind)).toEqual(['paragraph', 'code']);
    expect(addIntroduced(added, [[introduction, command, after]])).toHaveLength(2);
  });

  test('addIntroduced leaves a paragraph without a colon alone', () => {
    const plain: Block = { kind: 'paragraph', markdown: 'Run this command.', sentences: ['Run this command.'] };
    const command: Block = { kind: 'code', markdown: '```bash\nnpx piwi init\n```', sentences: [] };
    expect(addIntroduced([{ block: plain, passage: 0, order: 0, score: 0.7 }], [[plain, command]])).toHaveLength(1);
  });
});

describe('quoteBlocks', () => {
  /** Two dimensions: the first says "about flaky tests", the second "about anything else". */
  const embedTexts = async (texts: string[]) => texts.flatMap((text) => (/flaky/i.test(text) ? [1, 0] : [0, 1]));
  const flaky = [
    'A test is flaky when its result is not deterministic across runs of the same code.',
    '',
    'Fix flaky tests in this order:',
    '',
    '- Start with the flaky tests that waste the most time',
    '- Then the flaky tests that block the pipeline',
    '',
    'Unrelated paragraph about how the dashboard stores its database on disk.',
  ].join('\n');

  test('quotes the blocks about the question, with the position of their passage', async () => {
    const quoted = await quoteBlocks(
      'how do I find flaky tests?',
      [1, 0],
      [flaky, 'Nothing here about the topic asked, only the storage of data.'],
      embedTexts,
      2,
    );
    expect(quoted.map((block) => block.markdown)).toEqual([
      'A test is flaky when its result is not deterministic across runs of the same code.',
      'Fix flaky tests in this order:',
      '- Start with the flaky tests that waste the most time\n- Then the flaky tests that block the pipeline',
    ]);
    expect(quoted.every((block) => block.source === 0 && !block.clipped)).toBe(true);
  });

  test('a bare name quotes the blocks that contain it, code included', async () => {
    const passageText = [
      'Set the dashboard address before the first run of the suite.',
      '',
      '```bash',
      'PIWI_DASHBOARD_URL=http://localhost:3000 npx playwright test',
      '```',
    ].join('\n');
    const quoted = await quoteBlocks('PIWI_DASHBOARD_URL', [1, 0], [passageText], embedTexts, 2);
    expect(quoted.map((block) => block.markdown)).toEqual([
      '```bash\nPIWI_DASHBOARD_URL=http://localhost:3000 npx playwright test\n```',
    ]);
  });

  test('quotes nothing when no passage has a sentence to score', async () => {
    expect(await quoteBlocks('anything at all', [1, 0], ['```bash\nls\n```'], embedTexts, 2)).toEqual([]);
  });
});

describe('confidence', () => {
  test('a similar passage answers, a distant one does not', () => {
    expect(assess('how do I find flaky tests?', ANSWER_SIMILARITY, 0, 3)).toBe('answer');
    expect(assess('what is the weather in Paris?', RELATED_SIMILARITY - 0.01, 0.5, 1)).toBe('none');
  });

  test('between the two, only a query in the docs vocabulary answers', () => {
    const between = (ANSWER_SIMILARITY + RELATED_SIMILARITY) / 2;
    expect(assess('how do I turn on sign-in?', between, 0, 3)).toBe('answer');
    expect(assess('how do I merge two pandas dataframes?', between, 0.5, 1)).toBe('related');
  });

  test('a bare name is judged by its keyword match', () => {
    expect(assess('runLabel', 0.5, 0, 2)).toBe('answer');
    expect(assess('fooBarBaz', 0.9, 1, 0)).toBe('none');
  });

  test('keyword-only mode never claims an answer', () => {
    expect(assessKeywords('find flaky tests', 3)).toBe('related');
    expect(assessKeywords('find flaky tests', 1)).toBe('none');
  });
});
