export const DIAGNOSIS_CATEGORIES = ['app-bug', 'test-bug', 'flaky-test', 'infrastructure', 'environment', 'unknown'] as const
export type DiagnosisCategory = typeof DIAGNOSIS_CATEGORIES[number]

export const DIAGNOSIS_CONFIDENCES = ['high', 'medium', 'low'] as const
export type DiagnosisConfidence = typeof DIAGNOSIS_CONFIDENCES[number]

export interface AiDiagnosisResult {
  category: DiagnosisCategory
  confidence: DiagnosisConfidence
  summary: string
  rootCause: string
  evidence: string[]
  suggestedFix: {
    description: string
    file: string | null
    code: string | null
  }
  preventionTips: string[]
}

export const DIAGNOSIS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['category', 'confidence', 'summary', 'rootCause', 'evidence', 'suggestedFix', 'preventionTips'],
  properties: {
    category: { type: 'string', enum: [...DIAGNOSIS_CATEGORIES] },
    confidence: { type: 'string', enum: [...DIAGNOSIS_CONFIDENCES] },
    summary: { type: 'string' },
    rootCause: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
    suggestedFix: {
      type: 'object',
      additionalProperties: false,
      required: ['description', 'file', 'code'],
      properties: {
        description: { type: 'string' },
        file: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        code: { anyOf: [{ type: 'string' }, { type: 'null' }] }
      }
    },
    preventionTips: { type: 'array', items: { type: 'string' } }
  }
}

export function parseDiagnosisJson(text: string): AiDiagnosisResult {
  let parsed: unknown

  try {
    parsed = JSON.parse(text)
  } catch {
    // Strip markdown fences
    const fenceStripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
    try {
      parsed = JSON.parse(fenceStripped)
    } catch {
      // Slice from first { to last }
      const start = text.indexOf('{')
      const end = text.lastIndexOf('}')
      if (start === -1 || end === -1 || end <= start) throw new Error('Could not extract JSON from AI response')
      parsed = JSON.parse(text.slice(start, end + 1))
    }
  }

  if (!parsed || typeof parsed !== 'object') throw new Error('AI response is not an object')

  const raw = parsed as Record<string, unknown>

  const category = DIAGNOSIS_CATEGORIES.includes(raw.category as DiagnosisCategory)
    ? (raw.category as DiagnosisCategory)
    : 'unknown'

  const confidence = DIAGNOSIS_CONFIDENCES.includes(raw.confidence as DiagnosisConfidence)
    ? (raw.confidence as DiagnosisConfidence)
    : 'low'

  const summary = typeof raw.summary === 'string' ? raw.summary.trim().slice(0, 300) : ''
  const rootCause = typeof raw.rootCause === 'string' ? raw.rootCause : ''

  const evidence = Array.isArray(raw.evidence)
    ? raw.evidence.filter((e): e is string => typeof e === 'string').slice(0, 8)
    : []

  const preventionTips = Array.isArray(raw.preventionTips)
    ? raw.preventionTips.filter((t): t is string => typeof t === 'string').slice(0, 8)
    : []

  const rawFix = raw.suggestedFix && typeof raw.suggestedFix === 'object' ? raw.suggestedFix as Record<string, unknown> : {}
  const suggestedFix = {
    description: typeof rawFix.description === 'string' ? rawFix.description : '',
    file: typeof rawFix.file === 'string' ? rawFix.file : null,
    code: typeof rawFix.code === 'string' ? rawFix.code : null
  }

  return { category, confidence, summary, rootCause, evidence, suggestedFix, preventionTips }
}
