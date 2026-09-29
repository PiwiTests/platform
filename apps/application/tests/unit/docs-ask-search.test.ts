import { describe, test, expect } from 'vitest';
import {
  ANSWER_SIMILARITY,
  RELATED_SIMILARITY,
  KeywordIndex,
  assess,
  assessKeywords,
  candidateSentences,
  denseScores,
  excerpt,
  fuseRankings,
  identifiersIn,
  limitPerPage,
  looksLikeIdentifier,
  mentionsIdentifier,
  parseVectors,
  rankPassages,
  searchTerms,
  selectAnswer,
  splitSentences,
  topScores,
  type Passage,
  type ScoredSentence,
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

describe('KeywordIndex', () => {
  const passages = [
    passage('guide/ci', ['Troubleshooting'], 'Shards create several runs instead of one. Set runLabel explicitly.'),
    passage('guide/concepts', ['Test run'], 'A test run is one execution of the suite. The run label names it.'),
    passage('operate/database', ['PostgreSQL'], 'Point the dashboard at a shared PostgreSQL database.'),
  ];
  const index = new KeywordIndex(passages);

  test('ranks the passage with the exact name first', () => {
    expect(index.search('runLabel', 5)[0]?.index).toBe(0);
  });

  test('matches a plural and a heading word', () => {
    expect(index.search('postgres databases', 5)[0]?.index).toBe(2);
    expect(index.search('troubleshooting', 5)[0]?.index).toBe(0);
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
});

describe('sentences', () => {
  test('splitSentences breaks at a capital and keeps abbreviations together', () => {
    expect(splitSentences('It runs. Then it stops. See e.g. the guide for more.')).toEqual([
      'It runs.',
      'Then it stops.',
      'See e.g. the guide for more.',
    ]);
  });

  test('candidateSentences quotes prose and bullets, never code, tables or headings', () => {
    const text = [
      '## Heading that is not a sentence',
      '',
      'Piwi keeps every run so you can compare a failure with the last green one.',
      '',
      '```bash',
      'npx piwi report --open the dashboard from a terminal window',
      '```',
      '',
      '| Option | Meaning of the option in this table cell |',
      '| --- | --- |',
      '',
      '- Each flaky test links to its own history and quarantine action.',
      '- Short.',
    ].join('\n');
    expect(candidateSentences(text)).toEqual([
      'Piwi keeps every run so you can compare a failure with the last green one.',
      'Each flaky test links to its own history and quarantine action.',
    ]);
  });

  test('excerpt prefers the sentence that uses the query terms', () => {
    const text =
      'The dashboard shows every run in a list ordered by date. Quarantine keeps a flaky test out of the failing count.';
    expect(excerpt(text, 'quarantine a flaky test')).toBe('Quarantine keeps a flaky test out of the failing count.');
    expect(excerpt(text, 'unrelated words here')).toBe('The dashboard shows every run in a list ordered by date.');
  });

  test('excerpt clips a long sentence at a word', () => {
    const clipped = excerpt(`${'word '.repeat(100)}end.`, 'word', 40);
    expect(clipped.length).toBeLessThanOrEqual(41);
    expect(clipped.endsWith('…')).toBe(true);
  });
});

describe('selectAnswer', () => {
  const sentence = (text: string, passage: number, order: number, score: number): ScoredSentence => ({
    text,
    passage,
    order,
    score,
  });

  test('keeps sentences near the best score, in reading order', () => {
    const chosen = selectAnswer([
      sentence('Second passage first sentence is close to the best.', 1, 0, 0.7),
      sentence('First passage sentence holds the best score overall.', 0, 3, 0.72),
      sentence('A far weaker sentence that is not quoted at all here.', 0, 0, 0.62),
    ]);
    expect(chosen.map((s) => s.text)).toEqual([
      'First passage sentence holds the best score overall.',
      'Second passage first sentence is close to the best.',
    ]);
  });

  test('quotes nothing below the floor', () => {
    expect(selectAnswer([sentence('A sentence that is not close to the question at all.', 0, 0, 0.5)])).toEqual([]);
  });

  test('skips a near repeat and stops at three sentences', () => {
    const chosen = selectAnswer([
      sentence('Piwi groups failures that share an error fingerprint together.', 0, 0, 0.75),
      sentence('Piwi groups failures that share an error fingerprint together again.', 0, 1, 0.74),
      sentence('Each cluster is triaged once from the failure inbox screen.', 0, 2, 0.73),
      sentence('A cluster carries a suggested fix from the diagnosis panel.', 0, 3, 0.72),
      sentence('Clusters can be exported as a bundle for someone else to read.', 0, 4, 0.71),
    ]);
    expect(chosen).toHaveLength(3);
    expect(chosen.map((s) => s.order)).toEqual([0, 2, 3]);
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
