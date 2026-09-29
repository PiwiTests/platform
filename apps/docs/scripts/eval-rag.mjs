/**
 * Measures how well the "Ask the docs" retrieval finds the right page, so a
 * change of model, passage size or ranking shows up as a number.
 *
 * Every question below names the pages a reader would accept as the answer.
 * The script ranks the passages three ways, keywords only, embeddings only and
 * both fused (the ranking the panel uses), and prints how often an accepted
 * page is first, in the top 3 and in the top 5. The questions with no page are
 * outside the docs: their best similarity shows where the "no answer" threshold
 * in the worker can sit.
 *
 *   npm run docs:rag && node scripts/eval-rag.mjs [--verbose]
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const here = dirname(fileURLToPath(import.meta.url));
const ragDir = join(here, '../public/rag');
const verbose = process.argv.includes('--verbose');

const { parseVectors, denseScores, topScores, KeywordIndex, rankPassages, limitPerPage, assess, candidateSentences, cosine } = await createJiti(
  import.meta.url,
).import(join(here, '../.vitepress/theme/ask-docs/search.ts'));

/** [question, pages accepted as the answer]. No pages: the question is outside the docs. */
const QUESTIONS = [
  ['how do I find flaky tests?', ['features/flaky-tests']],
  ['my whole run went red, where do I start?', ['recipes/mass-failure', 'features/failure-clusters']],
  ['how do I send test results from GitHub Actions?', ['guide/ci', 'guide/reporter']],
  ['how do I merge shards into one run?', ['guide/ci']],
  ['how do I back up the database?', ['operate/backup-restore']],
  ['can I use PostgreSQL instead of SQLite?', ['operate/database']],
  ['how do I set up Slack notifications?', ['features/notifications']],
  ['how do I turn on sign-in?', ['operate/authentication']],
  ['which variable selects the AI provider?', ['guide/ai-provider']],
  ['what does the reporter record without any configuration?', ['reference/test-metadata']],
  ['how do I quarantine a flaky test?', ['features/flaky-tests']],
  ['how do I connect Jira?', ['operate/integrations', 'features/issue-tracking']],
  ['run Piwi with Docker', ['operate/deployment']],
  ['what happens when I upgrade to a new version?', ['operate/upgrading']],
  ['how long is data kept?', ['operate/storage']],
  ['a UI change broke my locator, how do I fix it?', ['recipes/broken-locator', 'features/locator-healing']],
  ['does Piwi send data to third parties?', ['guide/privacy']],
  ['what license is Piwi under?', ['guide/license']],
  ['how does Piwi compare with Allure?', ['guide/comparison']],
  ['how do I let a coding agent use Piwi?', ['features/mcp', 'features/agent-skills']],
  ['how do I import old Playwright reports?', ['guide/importing-runs']],
  ['what is a failure cluster?', ['guide/concepts', 'features/failure-clusters']],
  ['how do I share a failure with someone who has no account?', ['features/share-links']],
  ['open a failing line in VS Code from the dashboard', ['features/ide-integration', 'features/editors']],
  ['can traces be stored in S3?', ['operate/storage']],
  ['capture network timing and console output', ['guide/capture-fixtures']],
  ['keyboard shortcut for the command palette', ['reference/keyboard-shortcuts']],
  ['how do I use the desktop app?', ['features/desktop']],
  ['what should I check before going to production?', ['operate/production-checklist']],
  ['wrapConfig', ['guide/reporter']],
  ['runLabel', ['guide/ci']],
  ['PIWI_DASHBOARD_URL', ['guide/ci', 'guide/reporter', 'guide/getting-started']],
  ['what is the weather in Paris?', []],
  ['how do I bake sourdough bread?', []],
  ['who won the 2018 football world cup?', []],
  ['write me a poem about cats', []],
  ['how do I merge two pandas dataframes?', []],
  ['reset my Netflix password', []],
  ['what is the capital of Australia?', []],
  ['how do I train a neural network in PyTorch?', []],
  ['recommend a good pizza recipe', []],
  ['how do I deploy a Lambda function on AWS?', []],
  ['how do I write a unit test in Rust?', []],
];

const index = JSON.parse(readFileSync(join(ragDir, 'index.json'), 'utf8'));
const buffer = readFileSync(join(ragDir, 'vectors.bin'));
const store = parseVectors(
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  index.passages.length,
  index.model.dim,
);
const keywords = new KeywordIndex(index.passages);

const { pipeline, env } = await import('@huggingface/transformers');
env.cacheDir = join(ragDir, 'models');
env.allowRemoteModels = false;
const extractor = await pipeline('feature-extraction', index.model.id, { dtype: index.model.dtype });

const pagesOf = (ranked) => limitPerPage(ranked, index.passages, 1, 10).map(({ index: i }) => index.passages[i].page);
const firstHit = (pages, accepted) => pages.findIndex((page) => accepted.includes(page)) + 1 || Infinity;

const tally = { keywords: [], dense: [], fused: [] };
const outside = [];
const verdicts = [];
for (const [question, accepted] of QUESTIONS) {
  const output = await extractor(index.model.queryPrefix + question, { pooling: index.model.pooling, normalize: true });
  const dense = denseScores(store, output.data);
  const denseTop = topScores(dense, 30);
  const keywordTop = keywords.search(question, 30);
  const fused = rankPassages(question, denseTop, keywordTop);
  const sentences = limitPerPage(fused, index.passages, 1, 3).flatMap(({ index: i }) => candidateSentences(index.passages[i].text));
  let bestSentence = 0;
  if (sentences.length) {
    const embedded = await extractor(sentences, { pooling: index.model.pooling, normalize: true });
    for (let k = 0; k < sentences.length; k++) {
      bestSentence = Math.max(bestSentence, cosine(output.data, embedded.data.subarray(k * index.model.dim, (k + 1) * index.model.dim)));
    }
  }
  const verdict = assess(question, denseTop[0].score, keywords.unknownShare(question), keywordTop[0]?.matched ?? 0);
  if (!accepted.length) {
    outside.push({ question, sentence: bestSentence, cosine: denseTop[0].score, unknown: keywords.unknownShare(question), verdict });
    continue;
  }
  verdicts.push({ question, verdict, sentence: bestSentence, cosine: denseTop[0].score });
  const ranks = { keywords: firstHit(pagesOf(keywordTop), accepted), dense: firstHit(pagesOf(denseTop), accepted), fused: firstHit(pagesOf(fused), accepted) };
  for (const key of Object.keys(tally)) tally[key].push(ranks[key]);
  const best = denseTop[0];
  if (verbose || ranks.fused > 3) {
    console.log(`${ranks.fused <= 3 ? 'ok  ' : 'MISS'} fused#${ranks.fused} dense#${ranks.dense} kw#${ranks.keywords} cos ${best.score.toFixed(2)}  ${question}`);
    if (ranks.fused > 3) console.log(`       got ${pagesOf(fused).slice(0, 3).join(', ')}, wanted ${accepted.join(' or ')}`);
  }
}

const rate = (ranks, within) => `${Math.round((100 * ranks.filter((r) => r <= within).length) / ranks.length)}%`;
console.log(`\n${tally.fused.length} questions inside the docs, ${index.passages.length} passages, model ${index.model.id}`);
console.log('ranking    top 1  top 3  top 5');
for (const [name, ranks] of Object.entries(tally)) console.log(`${name.padEnd(10)} ${rate(ranks, 1).padStart(5)}  ${rate(ranks, 3).padStart(5)}  ${rate(ranks, 5).padStart(5)}`);

const count = (list, verdict) => list.filter((item) => item.verdict === verdict).length;
console.log(`\nconfidence inside the docs: ${count(verdicts, 'answer')} answer, ${count(verdicts, 'related')} related, ${count(verdicts, 'none')} none (of ${verdicts.length})`);
const sentenceScores = verdicts.map((v) => v.sentence).sort((a, b) => a - b);
console.log(`best sentence similarity inside the docs: min ${sentenceScores[0].toFixed(2)}, p10 ${sentenceScores[Math.floor(sentenceScores.length * 0.1)].toFixed(2)}, median ${sentenceScores[sentenceScores.length >> 1].toFixed(2)}`);
for (const item of verdicts.filter((v) => v.sentence < 0.66)) console.log(`  low sentence ${item.sentence.toFixed(2)}  ${item.question}`);
for (const item of verdicts.filter((v) => v.verdict !== 'answer')) console.log(`  ${item.verdict.padEnd(7)} cos ${item.cosine.toFixed(2)}  ${item.question}`);
console.log(`confidence outside the docs: ${count(outside, 'answer')} answer, ${count(outside, 'related')} related, ${count(outside, 'none')} none (of ${outside.length})`);
for (const { question, cosine, unknown, verdict, sentence } of outside) console.log(`  ${verdict.padEnd(7)} cos ${cosine.toFixed(2)}  sentence ${sentence.toFixed(2)}  unknown ${unknown.toFixed(2)}  ${question}`);
