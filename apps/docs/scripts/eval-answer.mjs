/**
 * Measures what a local generative model does with the passages the search
 * found, so a model can be chosen on numbers rather than on a first impression.
 *
 * For each question the script runs the same retrieval as the panel, gives the
 * best passages to the model with the panel's instructions (ask-docs/prompt.ts)
 * and checks the reply:
 *
 * - grounding: names in the reply (backticked values, ALL_CAPS variables,
 *   camelCase options, --flags) that no passage contains, and the share of the
 *   reply's words that some passage uses (ask-docs/prompt.ts `checkGrounding`);
 * - form: bullet lists, and tables with the same number of cells on every row;
 * - citations: `[n]` markers that point at a passage that was given;
 * - abstention: a refusal for a question outside the docs, an answer inside.
 *
 * It runs the model on the CPU with the same transformers.js the browser uses,
 * so the speed is a floor: a GPU is much faster.
 *
 *   node scripts/eval-answer.mjs --model onnx-community/LFM2.5-350M-ONNX --dtype q4 [--verbose]
 *     [--passages 3] [--limit 8] [--cache <dir>] [--max-new-tokens 400]
 */
import { QUESTIONS } from './rag-questions.mjs';
import { loadRag, prompt } from './rag-lib.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};
const modelId = option('model');
const dtype = option('dtype', 'q4');
const passageCount = Number(option('passages', '3'));
const maxNewTokens = Number(option('max-new-tokens', '400'));
const verbose = args.includes('--verbose');
if (!modelId) throw new Error('--model <hugging face id> is required');

/** Questions that call for a list, a table or steps, then questions outside the docs and two on a nearby topic. */
const ASKED = [
  'how do I find flaky tests?',
  'how do I merge shards into one run?',
  'can I use PostgreSQL instead of SQLite?',
  'how do I set up Slack notifications?',
  'which variable selects the AI provider?',
  'what does the reporter record without any configuration?',
  'how do I connect Jira?',
  'what happens when I upgrade to a new version?',
  'how does Piwi compare with Allure?',
  'how do I let a coding agent use Piwi?',
  'how do I back up the database?',
  'what is a failure cluster?',
  'what is the weather in Paris?',
  'how do I merge two pandas dataframes?',
  'reset my Netflix password',
  'how do I deploy a Lambda function on AWS?',
  'how do I write a unit test in Rust?',
];
const questions = ASKED.slice(0, Number(option('limit', String(ASKED.length)))).map((question) => ({
  question,
  covered: QUESTIONS.find(([q]) => q === question)?.[1].length > 0,
}));

const rag = await loadRag();
const { AutoTokenizer, TextStreamer, env, pipeline } = await import('@huggingface/transformers');
if (option('cache')) env.cacheDir = option('cache');
env.allowRemoteModels = true;

const loadStarted = performance.now();
const generator = await pipeline('text-generation', modelId, { dtype });
const loadSeconds = (performance.now() - loadStarted) / 1000;
const tokenizer = generator.tokenizer ?? (await AutoTokenizer.from_pretrained(modelId));
console.log(`model ${modelId} (${dtype}) loaded in ${loadSeconds.toFixed(1)} s, ${passageCount} passages per question`);

// ── Checks on a reply ─────────────────────────────────────────────────────────

/** Every table of a reply, and whether its rows all have as many cells as its header. */
function tablesIn(markdown) {
  const tables = [];
  let rows = [];
  const flush = () => {
    if (rows.length) tables.push(rows);
    rows = [];
  };
  for (const line of markdown.split('\n')) {
    if (/^\s*\|/.test(line)) rows.push(line);
    else flush();
  }
  flush();
  const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').length;
  return tables.map((table) => ({
    valid: table.length >= 3 && /^[\s|:-]+$/.test(table[1]) && table.every((row) => cells(row) === cells(table[0])),
  }));
}

const citations = (markdown) => [...markdown.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));

// ── Run ───────────────────────────────────────────────────────────────────────

const results = [];
for (const { question, covered } of questions) {
  const { shown } = await rag.retrieve(question);
  const given = shown.slice(0, passageCount).map(({ index: at }) => {
    const { title, headings, text } = rag.index.passages[at];
    return { title, headings, markdown: text };
  });
  const messages = prompt.buildMessages(question, given);

  const started = performance.now();
  let firstToken = 0;
  let tokens = 0;
  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: () => {},
    token_callback_function: () => {
      if (!tokens++) firstToken = performance.now() - started;
    },
  });
  const output = await generator(messages, {
    max_new_tokens: maxNewTokens,
    do_sample: false,
    repetition_penalty: 1.1,
    return_full_text: false,
    streamer,
    tokenizer_encode_kwargs: { enable_thinking: false },
  });
  const seconds = (performance.now() - started) / 1000;
  const raw = output[0].generated_text.at(-1).content;
  const reply = prompt.readAnswer(raw);
  const markdown = prompt.normalizeCitations(reply.markdown);

  const grounding = reply.covered ? prompt.checkGrounding(markdown, given.map((p) => p.markdown)) : null;
  const cited = citations(markdown);
  const row = {
    question,
    expectCovered: covered,
    covered: reply.covered,
    seconds,
    firstToken: firstToken / 1000,
    tokens,
    invented: grounding?.invented ?? [],
    support: grounding?.support ?? 1,
    lists: (markdown.match(/^\s*(?:[-*]|\d+\.)\s/gm) ?? []).length,
    tables: tablesIn(markdown),
    cited: cited.length,
    badCitations: cited.filter((n) => n < 1 || n > given.length).length,
  };
  results.push(row);
  const flag = row.covered === row.expectCovered ? 'ok ' : 'BAD';
  console.log(
    `${flag} ${row.covered ? 'answered' : 'refused '} ${seconds.toFixed(0).padStart(3)} s (first token ${row.firstToken.toFixed(1)} s, ${tokens} tokens)  invented ${row.invented.length}  support ${row.support.toFixed(2)}  lists ${row.lists}  tables ${row.tables.length}  cites ${row.cited}  ${question}`,
  );
  if (row.invented.length) console.log(`      invented: ${row.invented.slice(0, 6).join(' | ')}`);
  if (verbose) console.log(markdown ? markdown.split('\n').map((line) => `      ${line}`).join('\n') : `      (${raw.trim().slice(0, 120)})`);
}

// ── Summary ───────────────────────────────────────────────────────────────────

const inside = results.filter((r) => r.expectCovered);
const outside = results.filter((r) => !r.expectCovered);
const answered = inside.filter((r) => r.covered);
const pct = (n, of) => (of ? `${Math.round((100 * n) / of)}%` : 'n/a');
const mean = (list, pick) => (list.length ? list.reduce((sum, item) => sum + pick(item), 0) / list.length : 0);
const tables = answered.flatMap((r) => r.tables);
console.log(`\n== ${modelId} (${dtype})`);
console.log(`answers inside the docs:   ${answered.length}/${inside.length}`);
console.log(`refusals outside the docs: ${outside.filter((r) => !r.covered).length}/${outside.length}`);
console.log(`answers with an invented name: ${pct(answered.filter((r) => r.invented.length).length, answered.length)} (${answered.reduce((sum, r) => sum + r.invented.length, 0)} names)`);
console.log(`support (share of a reply's words found in the passages): inside the docs min ${Math.min(...answered.map((r) => r.support), 1).toFixed(2)}, mean ${mean(answered, (r) => r.support).toFixed(2)}; replies to questions outside the docs: ${outside.filter((r) => r.covered).map((r) => r.support.toFixed(2)).join(', ') || 'none'}`);
console.log(`answers with a list: ${pct(answered.filter((r) => r.lists).length, answered.length)}, with a table: ${pct(answered.filter((r) => r.tables.length).length, answered.length)} (valid tables ${pct(tables.filter((t) => t.valid).length, tables.length)})`);
console.log(`answers with a citation: ${pct(answered.filter((r) => r.cited).length, answered.length)}, wrong citation numbers: ${answered.reduce((sum, r) => sum + r.badCitations, 0)}`);
console.log(`time per answer: ${mean(answered, (r) => r.seconds).toFixed(0)} s (first token ${mean(answered, (r) => r.firstToken).toFixed(1)} s), ${mean(answered, (r) => r.tokens / Math.max(0.1, r.seconds - r.firstToken)).toFixed(1)} tokens/s after it`);
