/**
 * The instructions a local model gets to write an answer from the passages the
 * search found, and the reading of what it writes back. Pure functions, shared
 * by the generation worker, the unit tests and scripts/eval-answer.mjs.
 *
 * The model only rewrites: it is given the passages and told to use nothing
 * else, to cite them by number, and to say so when they do not answer the
 * question. Lists and tables are its choice of form.
 */
import { searchTerms, toPlain } from './search'

export interface ContextPassage {
  title: string
  headings: string[]
  /** The passage as Markdown. */
  markdown: string
}

export interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

/** What the model writes, and only that, when the passages do not answer the question. */
export const REFUSAL = 'The docs do not cover this.'

const INSTRUCTIONS = [
  'You answer questions about Piwi, a dashboard for Playwright test results, using only the numbered passages of its documentation.',
  '',
  'Rules:',
  '1. Write the answer in Markdown. Use a bullet list for steps or several items. Use a table only to compare several things on the same fields. Put commands, option names and values in backticks, copied exactly from the passages.',
  '2. End every bullet, sentence and table row with the number of the passage it comes from, like [1].',
  '3. Use only facts stated in the passages. Do not add advice, steps or examples of your own.',
  `4. If none of the passages answers the question, write only: ${REFUSAL}`,
].join('\n')

/** Markdown with each link reduced to its text: the model needs the words, and would invent the addresses. */
export function withoutLinkTargets(markdown: string): string {
  let fence: string | null = null
  return markdown
    .split('\n')
    .map((line) => {
      const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1]
      if (fence) {
        if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null
        return line
      }
      if (marker) {
        fence = marker
        return line
      }
      return line.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    })
    .join('\n')
}

/** The system instructions, then the numbered passages and the question. */
export function buildMessages(question: string, passages: ContextPassage[]): ChatMessage[] {
  const context = passages
    .map(({ title, headings, markdown }, at) => `[${at + 1}] ${[title, ...headings].join(' > ')}\n${withoutLinkTargets(markdown)}`)
    .join('\n\n')
  return [
    { role: 'system', content: INSTRUCTIONS },
    { role: 'user', content: `Passages:\n\n${context}\n\nQuestion: ${question}` },
  ]
}

export interface ReadAnswer {
  /** False when the model says the passages do not answer the question. */
  covered: boolean
  markdown: string
}

/** A short reply that says the passages do not answer, in the model's own words. */
const REFUSES =
  /^\W*(?:the docs do not cover|none of the (?:provided |given )?passages|(?:the )?(?:provided |given )?(?:passages|documentation|docs|text) (?:do|does) not (?:contain|cover|mention|address)|i (?:cannot|can't|could not|couldn't) (?:find|answer))/i
const TRAILING_REFUSAL = /\s*the docs do not cover this\.?\s*$/i

/**
 * What a model wrote as an answer. Its reasoning, if it wrote any, is dropped;
 * a short reply that says the passages do not answer is no answer; a refusal
 * written after an answer is removed, the answer stands.
 */
export function readAnswer(output: string): ReadAnswer {
  const text = output.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim()
  if (!text || (text.length < 240 && REFUSES.test(text))) return { covered: false, markdown: '' }
  const markdown = text.replace(TRAILING_REFUSAL, '').trim()
  return { covered: markdown.length > 0, markdown }
}

/** `[1, 2]` and `[1][2]` cite the same passages: every citation becomes its own `[n]`. */
export function normalizeCitations(markdown: string): string {
  return markdown.replace(/\[(\d+(?:\s*[,;]\s*\d+)+)\]/g, (_match, numbers: string) =>
    numbers
      .split(/\s*[,;]\s*/)
      .map((n) => `[${n}]`)
      .join(''),
  )
}

/** `[n]` becomes a link to the n-th source, so a citation in an answer opens its passage. Code stays as written. */
export function linkCitations(markdown: string, hrefs: string[]): string {
  let fence: string | null = null
  return markdown
    .split('\n')
    .map((line) => {
      const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1]
      if (fence) {
        if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null
        return line
      }
      if (marker) {
        fence = marker
        return line
      }
      return line
        .split(/(`[^`]*`)/)
        .map((part, at) =>
          at % 2
            ? part
            : part.replace(/\[(\d+)\](?!\()/g, (whole, n: string) => {
                const href = hrefs[Number(n) - 1]
                return href ? `[\\[${n}\\]](${href})` : whole
              }),
        )
        .join('')
    })
    .join('\n')
}

export interface Grounding {
  /** Names in the answer (code, VARIABLES, camelCase options, --flags) that no passage contains. */
  invented: string[]
  /** Share of the answer's words that some passage also uses, from 0 to 1. */
  support: number
}

/** Names a reader could copy out of an answer: backticked values, VARIABLES, camelCaseOptions and --flags. */
function namesIn(markdown: string): string[] {
  const names = new Set<string>()
  for (const match of markdown.matchAll(/`([^`\n]+)`/g)) names.add(match[1]!.trim())
  for (const match of markdown.matchAll(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]{2,}\b|\b[a-z]+[A-Z][A-Za-z0-9]+\b|--[a-z][a-z-]+/g)) names.add(match[0])
  return [...names]
}

/**
 * How far an answer stays inside the passages it was written from. A model can
 * write a fluent answer that no passage supports; a name it made up, or words
 * the passages never use, show it. This is a check on the words, not on the
 * meaning: it does not catch a wrong negation.
 */
export function checkGrounding(answer: string, passages: string[]): Grounding {
  const context = passages.join('\n')
  const contextTerms = new Set(searchTerms(toPlain(context)))
  const terms = [...new Set(searchTerms(toPlain(answer.replace(/\[\d+\]/g, ''))))]
  const missing = namesIn(answer).filter(
    (name) => !context.includes(name) && !name.split(/\s+/).every((part) => context.includes(part)),
  )
  // A flag inside a command that is already reported is not reported twice.
  const invented = missing.filter((name) => !missing.some((other) => other !== name && other.includes(name)))
  const supported = terms.filter((term) => contextTerms.has(term)).length
  return { invented, support: terms.length ? supported / terms.length : 1 }
}
