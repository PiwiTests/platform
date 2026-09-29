/**
 * Measures how well the "Ask the docs" retrieval finds the right page, so a
 * change of model, passage size or ranking shows up as a number.
 *
 * Every question in rag-questions.mjs names the pages a reader would accept as
 * the answer. The script ranks the passages three ways, keywords only,
 * embeddings only and both fused (the ranking the panel uses), and prints how
 * often an accepted page is first, in the top 3 and in the top 5. The questions
 * with no page are outside the docs: what the panel would claim for them, and
 * how close their best passage and sentence come, show where the confidence
 * thresholds in search.ts can sit.
 *
 *   npm run docs:rag && node scripts/eval-rag.mjs [--verbose]
 */
import { QUESTIONS } from './rag-questions.mjs';
import { loadRag, search } from './rag-lib.mjs';

const verbose = process.argv.includes('--verbose');
const rag = await loadRag();
const { index } = rag;

const pagesOf = (ranked) => search.limitPerPage(ranked, index.passages, 1, 10).map(({ index: i }) => index.passages[i].page);
const firstHit = (pages, accepted) => pages.findIndex((page) => accepted.includes(page)) + 1 || Infinity;

const tally = { keywords: [], dense: [], fused: [] };
const inside = [];
const outside = [];
for (const [question, accepted] of QUESTIONS) {
  const { queryVector, denseTop, keywordTop, ranked, shown } = await rag.retrieve(question);
  const unknown = rag.keywords.unknownShare(question);
  const verdict = search.assess(question, denseTop[0].score, unknown, keywordTop[0]?.matched ?? 0);
  const sentence = await rag.bestSentence(queryVector, shown);
  const row = { question, verdict, cosine: denseTop[0].score, sentence, unknown };
  if (!accepted.length) {
    outside.push(row);
    continue;
  }
  inside.push(row);
  const ranks = {
    keywords: firstHit(pagesOf(keywordTop), accepted),
    dense: firstHit(pagesOf(denseTop), accepted),
    fused: firstHit(pagesOf(ranked), accepted),
  };
  for (const key of Object.keys(tally)) tally[key].push(ranks[key]);
  if (verbose || ranks.fused > 3) {
    console.log(`${ranks.fused <= 3 ? 'ok  ' : 'MISS'} fused#${ranks.fused} dense#${ranks.dense} kw#${ranks.keywords} cos ${row.cosine.toFixed(2)}  ${question}`);
    if (ranks.fused > 3) console.log(`       got ${pagesOf(ranked).slice(0, 3).join(', ')}, wanted ${accepted.join(' or ')}`);
  }
}

const rate = (ranks, within) => `${Math.round((100 * ranks.filter((r) => r <= within).length) / ranks.length)}%`;
console.log(`\n${tally.fused.length} questions inside the docs, ${index.passages.length} passages, model ${index.model.id}`);
console.log('ranking    top 1  top 3  top 5');
for (const [name, ranks] of Object.entries(tally)) console.log(`${name.padEnd(10)} ${rate(ranks, 1).padStart(5)}  ${rate(ranks, 3).padStart(5)}  ${rate(ranks, 5).padStart(5)}`);

const count = (list, verdict) => list.filter((item) => item.verdict === verdict).length;
const scores = inside.map((row) => row.sentence).sort((a, b) => a - b);
console.log(`\nconfidence inside the docs: ${count(inside, 'answer')} answer, ${count(inside, 'related')} related, ${count(inside, 'none')} none (of ${inside.length})`);
console.log(`best sentence similarity inside the docs: min ${scores[0].toFixed(2)}, p10 ${scores[Math.floor(scores.length * 0.1)].toFixed(2)}, median ${scores[scores.length >> 1].toFixed(2)}`);
for (const row of inside.filter((r) => r.sentence < search.BLOCK_FLOOR + 0.05)) console.log(`  low sentence ${row.sentence.toFixed(2)}  ${row.question}`);
for (const row of inside.filter((r) => r.verdict !== 'answer')) console.log(`  ${row.verdict.padEnd(7)} cos ${row.cosine.toFixed(2)}  ${row.question}`);
console.log(`confidence outside the docs: ${count(outside, 'answer')} answer, ${count(outside, 'related')} related, ${count(outside, 'none')} none (of ${outside.length})`);
for (const row of outside) console.log(`  ${row.verdict.padEnd(7)} cos ${row.cosine.toFixed(2)}  sentence ${row.sentence.toFixed(2)}  unknown ${row.unknown.toFixed(2)}  ${row.question}`);
