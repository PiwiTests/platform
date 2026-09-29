/**
 * Generates apps/docs/public/rag/, everything the "Ask the docs" panel needs to
 * answer a question in the reader's browser, with no server and no third party:
 *
 * - index.json: the model settings and the passages (page, anchor, headings,
 *   text as Markdown), and the name of the vectors file.
 * - vectors.<version>.bin: one embedding per passage, int8 with a float32 scale
 *   each (the first `count` float32 values are the scales, then `count * dim`
 *   int8). The name carries the index's version, so a browser never pairs an
 *   index with vectors from another build.
 * - models/: the embedding model's files, in the layout transformers.js reads
 *   from `env.localModelPath`.
 * - ort/: the ONNX Runtime WebAssembly files transformers.js runs the model with.
 *
 * The passages come from the same corpus the MCP `describe_piwi` tool serves
 * (apps/application/shared/docs-corpus.ts): the hand-written pages, one passage
 * per heading section, split at paragraph boundaries when a section is long.
 * The generated reference pages are not part of it.
 *
 * public/rag/ is a build artifact (gitignored). Embeddings are cached per
 * passage in .vitepress/cache, so editing one page embeds only its passages.
 *
 *   node scripts/generate-rag-index.mjs              fail on any error
 *   node scripts/generate-rag-index.mjs --optional   warn and exit 0 on error (local preview offline)
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const here = dirname(fileURLToPath(import.meta.url));
const docsRoot = join(here, '..');
const outDir = join(docsRoot, 'public/rag');
const cacheFile = join(docsRoot, '.vitepress/cache/rag-embeddings.json');
const require = createRequire(import.meta.url);

/** The embedding model: 384 dimensions, 512-token context, 23 MB once quantized to 8 bits. */
const MODEL = {
  id: 'Snowflake/snowflake-arctic-embed-xs',
  dtype: 'q8',
  dim: 384,
  pooling: 'cls',
  queryPrefix: 'Represent this sentence for searching relevant passages: ',
};
const MODEL_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'];
const ORT_FILES = ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];

/** A passage is at most this many characters (about 450 tokens of prose), under the model's 512-token context. */
const MAX_CHARS = 1800;
/** A section shorter than this joins the passage before it, so a one-line heading is not a passage of its own. */
const MIN_CHARS = 300;
const BATCH = 16;

/** The changelog: a page per release, which readers of "how do I" questions would land on by accident. */
const SKIPPED_PAGES = new Set(['reference/whats-new']);
/** Sections that only list links to other pages. */
const SKIPPED_SECTIONS = new Set(['related', 'try it in the demo']);

const optional = process.argv.includes('--optional');

// ── Corpus ────────────────────────────────────────────────────────────────────

const jiti = createJiti(import.meta.url, {
  alias: {
    '#shared': join(docsRoot, '../application/shared'),
    zod: dirname(require.resolve('zod/package.json')),
  },
});
const { buildDocsCorpus } = await jiti.import(join(docsRoot, '../application/shared/docs-corpus.ts'));
const { toPlain } = await jiti.import(join(docsRoot, '.vitepress/theme/ask-docs/search.ts'));

/** Every page and snippet under the docs root, keyed by relative path, the shape `buildDocsCorpus` reads. */
function readDocsFiles() {
  const files = {};
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(md|sh|ps1|ts|js|json)$/.test(entry.name)) {
        files[relative(docsRoot, path).split(sep).join('/')] = readFileSync(path, 'utf8');
      }
    }
  };
  walk(docsRoot);
  return files;
}

// ── Passages ──────────────────────────────────────────────────────────────────

const FENCE = /^\s*(`{3,}|~{3,})/;
const TABLE_RULE = /^[\s|:-]+$/;
const CALLOUTS = { tip: 'Tip', warning: 'Warning', danger: 'Danger', info: 'Note', details: 'Details' };

/** A link target as a path of the site (`/guide/reporter#options`); a target outside the docs stays as written. */
function siteLink(target, pagePath) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) return target;
  const [path = '', hash] = target.split('#');
  const absolute = path ? (path.startsWith('/') ? path : posix.join('/', posix.dirname(pagePath), path)) : `/${pagePath}`;
  const clean = posix.normalize(absolute).replace(/\.(md|html)$/, '').replace(/\/index$/, '') || '/';
  return clean + (hash ? `#${hash}` : '');
}

/** One line as passage Markdown: HTML a Markdown renderer would show as text is converted, images go, links point at site paths. */
function inline(line, pagePath) {
  return line
    .replace(/<code[^>]*>([^<]*)<\/code>/g, (_, code) => `\`${code}\``)
    .replace(/<\/?span[^>]*>/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g, (_, target, title) => `](${siteLink(target, pagePath)}${title})`)
    .replace(/^(#{1,6}\s+.*?)\s*\{#[\w-]+\}\s*$/, '$1');
}

const calloutTitle = (kind, title) =>
  ['warning', 'danger'].includes(kind) && title ? `${CALLOUTS[kind]}: ${title}` : title || CALLOUTS[kind];

/**
 * The lines of a section as passage Markdown, the way the page writes them:
 * code fences, tables, lists and links stay. Layout-only syntax goes, a callout
 * becomes a quotation with its title in bold, and a code group's tab label
 * becomes a bold line above its fence.
 */
function markdownLines(lines, pagePath) {
  const out = [];
  let fence = null;
  let callout = false;
  for (const line of lines) {
    const marker = line.match(FENCE)?.[1];
    if (fence) {
      out.push(line);
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (marker) {
      fence = marker;
      const labeled = line.match(/^(\s*(?:`{3,}|~{3,})\s*[\w+-]*)\s+\[([^\]]+)\]\s*$/);
      if (labeled) out.push(`**${labeled[2]}**`, '', labeled[1].trimEnd());
      else out.push(line);
      continue;
    }
    const trimmed = line.trim();
    const container = trimmed.match(/^:::\s*([a-z-]+)\s*(.*)$/);
    if (container) {
      const [, kind, title] = container;
      callout = kind in CALLOUTS;
      if (callout) out.push(`> **${calloutTitle(kind, title)}**`, '>');
      continue;
    }
    if (trimmed === ':::') {
      callout = false;
      continue;
    }
    if (/^<!--.*-->$/.test(trimmed) || /^\[Image:/.test(trimmed) || /^\[\[toc\]\]$/i.test(trimmed)) continue;
    if (/^<\/?[A-Za-z][^>]*>$/.test(trimmed)) continue;
    const text = inline(line, pagePath);
    out.push(callout ? (text.trim() ? `> ${text}` : '>') : text);
  }
  while (out.length && !out[0].trim()) out.shift();
  while (out.length && !out.at(-1).trim()) out.pop();
  return out.map((line) => (line.trim() ? line : ''));
}

/** Blocks of lines: split at blank lines outside code fences. */
function blocksOf(lines) {
  const blocks = [];
  let current = [];
  let fence = false;
  for (const line of lines) {
    if (FENCE.test(line)) fence = !fence;
    if (!line && !fence) {
      if (current.length) blocks.push(current.join('\n'));
      current = [];
    } else current.push(line);
  }
  if (current.length) blocks.push(current.join('\n'));
  return blocks;
}

/** A block over the budget is cut at line breaks; a table repeats its header and a code sample its fences in every piece. */
function cutBlock(block) {
  if (block.length <= MAX_CHARS) return [block];
  const rows = block.split('\n');
  const isTable = rows[0]?.startsWith('|') && TABLE_RULE.test(rows[1] ?? '');
  const isCode = FENCE.test(rows[0] ?? '') && rows.length > 2 && FENCE.test(rows.at(-1) ?? '');
  const head = isTable ? rows.slice(0, 2) : isCode ? rows.slice(0, 1) : [];
  const foot = isCode ? rows.slice(-1) : [];
  const body = rows.slice(head.length, rows.length - foot.length);
  const pieces = [];
  let piece = [];
  const join = (lines) => [...head, ...lines, ...foot].join('\n');
  for (const line of body) {
    if (piece.length && join([...piece, line]).length > MAX_CHARS) {
      pieces.push(join(piece));
      piece = [];
    }
    piece.push(line.slice(0, MAX_CHARS));
  }
  if (piece.length) pieces.push(join(piece));
  return pieces;
}

/** Text cut into pieces of at most MAX_CHARS, at block boundaries. */
function pack(lines) {
  const pieces = [];
  let piece = '';
  for (const block of blocksOf(lines).flatMap(cutBlock)) {
    if (piece && piece.length + block.length + 2 > MAX_CHARS) {
      pieces.push(piece);
      piece = '';
    }
    piece += (piece ? '\n\n' : '') + block;
  }
  if (piece) pieces.push(piece);
  return pieces;
}

/** The prose of a passage, for measuring how much a section really says. */
const proseLength = (text) =>
  toPlain(
    text
      .split('\n')
      .filter((line) => !/^\s*(#|\||`{3})/.test(line))
      .join('\n'),
  ).trim().length;

/** The `description` of a page's front matter, the one-sentence summary written for its search snippet. */
function descriptionOf(source = '') {
  const frontMatter = /^---\n([\s\S]*?)\n---/.exec(source)?.[1] ?? '';
  return /^description:\s*"?(.*?)"?\s*$/m.exec(frontMatter)?.[1] ?? '';
}

function passagesOf(page, description) {
  const lead = page.lines.slice(0, page.sections[0]?.start ?? page.lines.length).filter((line) => !/^#\s/.test(line));
  const units = [
    { lines: description ? [description, '', ...lead] : lead, anchor: '', level: 1, heading: '' },
    ...page.sections
      .filter((s) => !SKIPPED_SECTIONS.has(s.text.toLowerCase()))
      .map((s) => ({
        lines: page.lines.slice(s.start + 1, s.ownEnd),
        anchor: s.anchor,
        level: s.level,
        heading: s.text,
      })),
  ];
  const path = [];
  const passages = [];
  for (const unit of units) {
    if (unit.heading) {
      path.length = unit.level - 2;
      path[unit.level - 2] = unit.heading;
    }
    const headings = path.filter(Boolean);
    for (const text of pack(markdownLines(unit.lines, page.path))) {
      const previous = passages.at(-1);
      const joins =
        previous && proseLength(text) < MIN_CHARS && previous.text.length + text.length + 2 <= MAX_CHARS;
      if (joins) {
        const label = unit.heading && unit.anchor !== previous.anchor ? `${'#'.repeat(unit.level)} ${unit.heading}\n\n` : '';
        previous.text += `\n\n${label}${text}`;
      } else if (proseLength(text) >= 40 || text.includes('```')) {
        passages.push({ page: page.path, anchor: unit.anchor, title: page.title, headings, text });
      }
    }
  }
  return passages;
}

// ── Embeddings ────────────────────────────────────────────────────────────────

const sha = (text) => createHash('sha256').update(text).digest('hex');

/** The text the model reads: the page and heading path, then the passage. */
const embeddingInput = (p) => [p.title, ...p.headings].join(' > ') + '\n\n' + toPlain(p.text);

/** Unit-length vector to int8 with one float32 scale: `x ≈ q * scale`. */
function quantize(vector) {
  let max = 0;
  for (const x of vector) max = Math.max(max, Math.abs(x));
  const scale = max / 127 || 1;
  return { scale, q: Int8Array.from(vector, (x) => Math.round(x / scale)) };
}

const loadCache = () => {
  try {
    return JSON.parse(readFileSync(cacheFile, 'utf8'));
  } catch {
    return {};
  }
};

const modelReady = () => MODEL_FILES.every((file) => existsSync(join(outDir, 'models', MODEL.id, file)));

/** Load the model into public/rag/models, downloading it when the files are not there yet. */
async function loadExtractor() {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = join(outDir, 'models');
  return pipeline('feature-extraction', MODEL.id, { dtype: MODEL.dtype });
}

async function embed(passages) {
  const cache = loadCache();
  const keys = passages.map((p) => sha(`${MODEL.id}\n${MODEL.dtype}\n${embeddingInput(p)}`));
  const missing = [...new Set(keys.filter((key) => !cache[key]))];
  if (missing.length || !modelReady()) {
    const extractor = await loadExtractor();
    const inputOf = new Map(keys.map((key, i) => [key, embeddingInput(passages[i])]));
    for (let i = 0; i < missing.length; i += BATCH) {
      const batch = missing.slice(i, i + BATCH);
      const output = await extractor(
        batch.map((key) => inputOf.get(key)),
        { pooling: MODEL.pooling, normalize: true },
      );
      batch.forEach((key, j) => {
        const { scale, q } = quantize(output.data.subarray(j * MODEL.dim, (j + 1) * MODEL.dim));
        cache[key] = { s: scale, q: Buffer.from(q.buffer).toString('base64') };
      });
      const done = Math.min(i + BATCH, missing.length);
      if (done === missing.length || (i / BATCH) % 10 === 9) console.log(`generate-rag-index: embedded ${done}/${missing.length} passages`);
    }
    await extractor.dispose?.();
    mkdirSync(dirname(cacheFile), { recursive: true });
    writeFileSync(cacheFile, JSON.stringify(Object.fromEntries(keys.map((key) => [key, cache[key]]))));
  }
  return { keys, cache, embedded: missing.length };
}

/** Copy the ONNX Runtime WebAssembly files transformers.js loads, from the installed onnxruntime-web. */
function copyRuntime() {
  const dist = dirname(require.resolve('onnxruntime-web'));
  mkdirSync(join(outDir, 'ort'), { recursive: true });
  for (const file of ORT_FILES) {
    const target = join(outDir, 'ort', file);
    if (!existsSync(target) || statSync(target).size !== statSync(join(dist, file)).size) {
      copyFileSync(join(dist, file), target);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const files = readDocsFiles();
  const corpus = buildDocsCorpus(files, { generated: true });
  corpus.pages = corpus.pages.filter((page) => !SKIPPED_PAGES.has(page.path));
  const passages = corpus.pages.flatMap((page) => passagesOf(page, descriptionOf(files[`${page.path}.md`])));
  if (!passages.length) throw new Error('no passages: the docs pages were not found');

  const { keys, cache, embedded } = await embed(passages);
  copyRuntime();

  const count = passages.length;
  const scales = new Float32Array(count);
  const vectors = new Int8Array(count * MODEL.dim);
  keys.forEach((key, i) => {
    scales[i] = cache[key].s;
    vectors.set(new Int8Array(Buffer.from(cache[key].q, 'base64')), i * MODEL.dim);
  });
  const binary = Buffer.concat([Buffer.from(scales.buffer), Buffer.from(vectors.buffer)]);

  // The download the panel reports progress against: the model file, then the WebAssembly runtime.
  const bytes = statSync(join(outDir, 'models', MODEL.id, 'onnx/model_quantized.onnx')).size;
  const runtimeBytes = statSync(join(outDir, 'ort/ort-wasm-simd-threaded.wasm')).size;
  const model = { ...MODEL, bytes, runtimeBytes };
  const version = sha(JSON.stringify({ model, passages })).slice(0, 12);
  const vectorsFile = `vectors.${version}.bin`;
  mkdirSync(outDir, { recursive: true });
  for (const file of readdirSync(outDir)) if (/^vectors(\..+)?\.bin$/.test(file)) rmSync(join(outDir, file));
  writeFileSync(join(outDir, vectorsFile), binary);
  writeFileSync(join(outDir, 'index.json'), JSON.stringify({ version, model, vectors: vectorsFile, passages }));

  const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;
  console.log(
    `generate-rag-index: ${count} passages from ${corpus.pages.length} pages (${embedded} embedded, ${count - embedded} cached), vectors ${kb(binary.length)}, index ${kb(statSync(join(outDir, 'index.json')).size)}`,
  );
}

try {
  await main();
} catch (error) {
  if (!optional) throw error;
  console.warn(`generate-rag-index: skipped, "Ask the docs" will be unavailable (${error.message})`);
}
