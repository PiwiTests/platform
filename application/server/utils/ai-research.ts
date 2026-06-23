/**
 * Pre-analysis ("research") stage of the two-stage diagnosis pipeline.
 *
 * A cheaper/faster model does a fast first pass over the failure context to
 * narrow the search — candidate hypotheses + the data gaps that would most
 * improve the diagnosis — which is then handed to the main model as guidance.
 * It deliberately produces NO final verdict or fix.
 */

import { DIAGNOSIS_CATEGORIES, type DiagnosisCategory } from '#shared/ai-diagnosis';

export const RESEARCH_SYSTEM_PROMPT = `You are a triage assistant doing a FAST first pass on a Playwright test failure, before a senior engineer writes the final diagnosis.
From the failure context (note the "## Data Coverage" map of what evidence is present/absent), output a brief, structured pre-analysis:
- hypotheses: candidate root causes, each with a category, a one-line rootCause, and a rough likelihood (0-100).
- dataGaps: which absent or thin evidence, if gathered, would most improve the diagnosis (reference section names like networkRequests, scmInvestigation, testSource).
- notes: one or two sentences on where the senior engineer should focus.
Be concise and do NOT produce a final verdict, confidence score, or code fix — you are only narrowing the search.
Categories: app-bug, test-bug, flaky-test, infrastructure, environment, unknown.`;

export interface ResearchHypothesis {
  category: DiagnosisCategory;
  rootCause: string;
  likelihood: number;
}

export interface ResearchResult {
  hypotheses: ResearchHypothesis[];
  dataGaps: string[];
  notes: string;
}

export const RESEARCH_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['hypotheses', 'dataGaps', 'notes'],
  properties: {
    hypotheses: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'rootCause', 'likelihood'],
        properties: {
          category: { type: 'string', enum: [...DIAGNOSIS_CATEGORIES] },
          rootCause: { type: 'string' },
          likelihood: { type: 'integer', minimum: 0, maximum: 100 },
        },
      },
    },
    dataGaps: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
};

function asCategory(v: unknown): DiagnosisCategory {
  return DIAGNOSIS_CATEGORIES.includes(v as DiagnosisCategory) ? (v as DiagnosisCategory) : 'unknown';
}

export function parseResearchJson(text: string): ResearchResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      return { hypotheses: [], dataGaps: [], notes: '' };
    }
    try {
      parsed = JSON.parse(text.slice(start, end + 1));
    } catch {
      return { hypotheses: [], dataGaps: [], notes: '' };
    }
  }
  const raw = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;

  const hypotheses = (Array.isArray(raw.hypotheses) ? raw.hypotheses : [])
    .map((h): ResearchHypothesis => {
      const o = (h && typeof h === 'object' ? h : {}) as Record<string, unknown>;
      const likelihood = typeof o.likelihood === 'number' ? Math.max(0, Math.min(100, Math.round(o.likelihood))) : 50;
      return {
        category: asCategory(o.category),
        rootCause: typeof o.rootCause === 'string' ? o.rootCause : '',
        likelihood,
      };
    })
    .filter((h) => h.rootCause)
    .slice(0, 5);

  const dataGaps = (Array.isArray(raw.dataGaps) ? raw.dataGaps : [])
    .filter((g): g is string => typeof g === 'string')
    .slice(0, 8);

  const notes = typeof raw.notes === 'string' ? raw.notes.slice(0, 600) : '';

  return { hypotheses, dataGaps, notes };
}

/** Render the research result as a guidance block appended to the final prompt. */
export function formatResearchBlock(research: ResearchResult): string {
  if (research.hypotheses.length === 0 && research.dataGaps.length === 0 && !research.notes) return '';
  const lines = ['## Pre-Analysis (from a fast research model — treat as a hint, verify against the evidence)'];
  if (research.hypotheses.length) {
    lines.push('Candidate hypotheses:');
    for (const h of research.hypotheses) lines.push(`- (${h.category}, ~${h.likelihood}/100) ${h.rootCause}`);
  }
  if (research.dataGaps.length) {
    lines.push('Suspected data gaps:');
    for (const g of research.dataGaps) lines.push(`- ${g}`);
  }
  if (research.notes) lines.push(`Notes: ${research.notes}`);
  return lines.join('\n');
}
