export const DIAGNOSIS_CATEGORIES = [
  'app-bug',
  'test-bug',
  'flaky-test',
  'infrastructure',
  'environment',
  'unknown',
] as const;
export type DiagnosisCategory = (typeof DIAGNOSIS_CATEGORIES)[number];

export const DIAGNOSIS_CONFIDENCES = ['high', 'medium', 'low'] as const;
export type DiagnosisConfidence = (typeof DIAGNOSIS_CONFIDENCES)[number];

export const DIAGNOSIS_SEVERITIES = ['blocker', 'high', 'medium', 'low'] as const;
export type DiagnosisSeverity = (typeof DIAGNOSIS_SEVERITIES)[number];

/**
 * One candidate root cause. The model ranks several of these by `likelihood`
 * so the UI can surface alternatives instead of collapsing to a single verdict.
 */
export interface DiagnosisHypothesis {
  category: DiagnosisCategory;
  rootCause: string;
  /** Relative likelihood 0-100; hypotheses are sorted descending. */
  likelihood: number;
  evidence: string[];
}

export interface AiDiagnosisResult {
  /** Derived from the top-ranked hypothesis (kept for the DB column + compact views). */
  category: DiagnosisCategory;
  /** Derived bucket of `confidenceScore` (kept for the DB column + compact views). */
  confidence: DiagnosisConfidence;
  /** 0-100 calibrated confidence in the top-ranked hypothesis. */
  confidenceScore: number;
  /** Estimated impact of the failure. */
  severity: DiagnosisSeverity;
  /** Feature/component area touched, e.g. "checkout / payment". */
  affectedArea: string | null;
  summary: string;
  /** Derived from the top-ranked hypothesis. */
  rootCause: string;
  /** Derived from the top-ranked hypothesis. */
  evidence: string[];
  /** Ranked candidate root causes (at least one). */
  hypotheses: DiagnosisHypothesis[];
  suggestedFix: {
    description: string;
    file: string | null;
    code: string | null;
    /** Unified diff patch applicable with `git apply`, null when not enough context */
    patch: string | null;
  };
  /** Concrete things to check/collect to raise confidence (esp. when low). */
  investigationSteps: string[];
  preventionTips: string[];
}

/**
 * JSON schema the model must emit. Top-level `category`/`confidence`/`rootCause`/
 * `evidence` are intentionally NOT requested — they are derived from
 * `hypotheses[0]` + `confidenceScore` in `parseDiagnosisJson` to avoid the model
 * contradicting itself.
 */
export const DIAGNOSIS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'summary',
    'confidenceScore',
    'severity',
    'affectedArea',
    'hypotheses',
    'suggestedFix',
    'investigationSteps',
    'preventionTips',
  ],
  properties: {
    summary: { type: 'string' },
    confidenceScore: { type: 'integer', minimum: 0, maximum: 100 },
    severity: { type: 'string', enum: [...DIAGNOSIS_SEVERITIES] },
    affectedArea: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    hypotheses: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'rootCause', 'likelihood', 'evidence'],
        properties: {
          category: { type: 'string', enum: [...DIAGNOSIS_CATEGORIES] },
          rootCause: { type: 'string' },
          likelihood: { type: 'integer', minimum: 0, maximum: 100 },
          evidence: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    suggestedFix: {
      type: 'object',
      additionalProperties: false,
      required: ['description', 'file', 'code', 'patch'],
      properties: {
        description: { type: 'string' },
        file: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        code: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        patch: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      },
    },
    investigationSteps: { type: 'array', items: { type: 'string' } },
    preventionTips: { type: 'array', items: { type: 'string' } },
  },
};

const CONFIDENCE_SCORES: Record<DiagnosisConfidence, number> = { high: 85, medium: 55, low: 25 };

function clampScore(n: unknown, fallback: number): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** Bucket a 0-100 score into the coarse enum used by badges and DB columns. */
export function scoreToConfidence(score: number): DiagnosisConfidence {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

function asCategory(v: unknown): DiagnosisCategory {
  return DIAGNOSIS_CATEGORIES.includes(v as DiagnosisCategory) ? (v as DiagnosisCategory) : 'unknown';
}

function asStringArray(v: unknown, max: number): string[] {
  return Array.isArray(v) ? v.filter((e): e is string => typeof e === 'string').slice(0, max) : [];
}

function parseHypothesis(raw: unknown): DiagnosisHypothesis {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    category: asCategory(o.category),
    rootCause: typeof o.rootCause === 'string' ? o.rootCause : '',
    likelihood: clampScore(o.likelihood, 50),
    evidence: asStringArray(o.evidence, 8),
  };
}

export function parseDiagnosisJson(text: string): AiDiagnosisResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    // Strip markdown fences
    const fenceStripped = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();
    try {
      parsed = JSON.parse(fenceStripped);
    } catch {
      // Slice from first { to last }
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start === -1 || end === -1 || end <= start) throw new Error('Could not extract JSON from AI response');
      parsed = JSON.parse(text.slice(start, end + 1));
    }
  }

  if (!parsed || typeof parsed !== 'object') throw new Error('AI response is not an object');

  const raw = parsed as Record<string, unknown>;

  // Hypotheses are the source of truth. Fall back to a synthesized single
  // hypothesis when a model returns the legacy top-level shape.
  let hypotheses = Array.isArray(raw.hypotheses) ? raw.hypotheses.map(parseHypothesis).slice(0, 5) : [];
  hypotheses = hypotheses.filter((h) => h.rootCause || h.evidence.length);
  if (hypotheses.length === 0) {
    hypotheses = [
      {
        category: asCategory(raw.category),
        rootCause: typeof raw.rootCause === 'string' ? raw.rootCause : '',
        likelihood: clampScore(raw.confidenceScore, CONFIDENCE_SCORES[asConfidence(raw.confidence)]),
        evidence: asStringArray(raw.evidence, 8),
      },
    ];
  }
  hypotheses.sort((a, b) => b.likelihood - a.likelihood);
  const primary = hypotheses[0]!;

  const confidenceScore = clampScore(
    raw.confidenceScore,
    primary.likelihood || CONFIDENCE_SCORES[asConfidence(raw.confidence)],
  );
  const confidence = scoreToConfidence(confidenceScore);

  const summary = typeof raw.summary === 'string' ? raw.summary.trim().slice(0, 300) : '';
  const severity = DIAGNOSIS_SEVERITIES.includes(raw.severity as DiagnosisSeverity)
    ? (raw.severity as DiagnosisSeverity)
    : 'medium';
  const affectedArea = typeof raw.affectedArea === 'string' && raw.affectedArea.trim() ? raw.affectedArea.trim() : null;

  const investigationSteps = asStringArray(raw.investigationSteps, 8);
  const preventionTips = asStringArray(raw.preventionTips, 8);

  const rawFix =
    raw.suggestedFix && typeof raw.suggestedFix === 'object' ? (raw.suggestedFix as Record<string, unknown>) : {};
  const suggestedFix = {
    description: typeof rawFix.description === 'string' ? rawFix.description : '',
    file: typeof rawFix.file === 'string' ? rawFix.file : null,
    code: typeof rawFix.code === 'string' ? rawFix.code : null,
    patch: typeof rawFix.patch === 'string' ? rawFix.patch : null,
  };

  return {
    category: primary.category,
    confidence,
    confidenceScore,
    severity,
    affectedArea,
    summary,
    rootCause: primary.rootCause,
    evidence: primary.evidence,
    hypotheses,
    suggestedFix,
    investigationSteps,
    preventionTips,
  };
}

function asConfidence(v: unknown): DiagnosisConfidence {
  return DIAGNOSIS_CONFIDENCES.includes(v as DiagnosisConfidence) ? (v as DiagnosisConfidence) : 'low';
}
