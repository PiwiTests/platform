/**
 * What the evaluation scripts share: the docs index, its keyword ranking and
 * its embedding model, loaded in Node from public/rag the way the browser
 * worker loads them, and the retrieval steps the worker runs for a question.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const here = dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(import.meta.url);

export const ragDir = join(here, '../public/rag');
/** ask-docs/search.ts: ranking, blocks and confidence, the code the worker runs. */
export const search = await jiti.import(join(here, '../.vitepress/theme/ask-docs/search.ts'));
/** ask-docs/prompt.ts: the instructions given to a generative model. */
export const prompt = await jiti.import(join(here, '../.vitepress/theme/ask-docs/prompt.ts'));

export async function loadRag() {
  const index = JSON.parse(readFileSync(join(ragDir, 'index.json'), 'utf8'));
  const file = readFileSync(join(ragDir, index.vectors));
  const store = search.parseVectors(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
    index.passages.length,
    index.model.dim,
  );
  const keywords = new search.KeywordIndex(index.passages);

  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = join(ragDir, 'models');
  env.allowRemoteModels = false;
  const extractor = await pipeline('feature-extraction', index.model.id, { dtype: index.model.dtype });
  const embed = (input) => extractor(input, { pooling: index.model.pooling, normalize: true });

  /** The rankings and the passages the panel would list for a question. */
  async function retrieve(question) {
    const queryVector = (await embed(index.model.queryPrefix + question)).data;
    const denseTop = search.topScores(search.denseScores(store, queryVector), 30);
    const keywordTop = keywords.search(question, 30);
    const ranked = search.rankPassages(question, denseTop, keywordTop);
    const shown = search.pickSources(question, ranked, index.passages);
    return { queryVector, denseTop, keywordTop, ranked, shown };
  }

  /** Best similarity between the question and any sentence of the passages the answer would quote from. */
  async function bestSentence(queryVector, shown, count = 3) {
    const sentences = shown.slice(0, count).flatMap(({ index: at }) => search.candidateSentences(index.passages[at].text));
    if (!sentences.length) return 0;
    const vectors = (await embed(sentences)).data;
    let best = 0;
    for (let k = 0; k < sentences.length; k++) {
      best = Math.max(best, search.cosine(queryVector, vectors.subarray(k * index.model.dim, (k + 1) * index.model.dim)));
    }
    return best;
  }

  return { index, store, keywords, embed, retrieve, bestSentence };
}
