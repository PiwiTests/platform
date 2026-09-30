/**
 * Zod building blocks for the test-function catalog's wire shape — shared by
 * the create/update endpoints and the AI-extraction endpoint so the three
 * don't drift into three slightly different ideas of what a valid pattern
 * step looks like. Mirrors `@piwitests/core/function-match`'s
 * `TestFunctionEntry` shape (that package has no validation library of its
 * own — it stays dependency-free — so the runtime check lives here instead).
 * Lives in `shared/` (no server-only imports — just zod) so the demo
 * router's client-side `validate-proposal` mirror can validate a pasted AI
 * response with this exact schema too, not a hand-rolled approximation.
 */
import { z } from 'zod';

export const testFunctionNameSchema = z
  .string()
  .min(1, 'Name is required')
  .max(120)
  .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, 'Must be a valid JS identifier');

/**
 * `receiver` and `importName` reach generated code *unquoted* — `new X(page)`,
 * `await r.method()`, `import { X } from …` — so anything that is not a plain
 * identifier is arbitrary code in the spec the recorder hands the user, not a
 * call. They were only length-capped, which mattered because the AI-extraction
 * and MCP paths let a model reading repository source fill them in.
 * `@piwitests/core`'s `callIdentifiersAreSafe` refuses the same shapes again at
 * emit time, for entries stored before this check existed.
 */
export const optionalIdentifierSchema = z
  .string()
  .max(120)
  .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, 'Must be a valid JS identifier')
  .nullish();

/**
 * An import specifier, not a path on disk — `./pages/CartPage`,
 * `@fixtures/cart`. Quoted when emitted, so a quote or a line break in it
 * cannot break out of the literal, but neither belongs in a module path and
 * refusing them keeps the generated import readable.
 */
export const moduleSchema = z
  .string()
  .min(1, 'Module is required')
  .max(240)
  .regex(/^[^'"`\r\n]+$/, 'Must not contain quotes or line breaks');

export const stepActionSchema = z.enum([
  'goto',
  'click',
  'fill',
  'check',
  'uncheck',
  'selectOption',
  'press',
  'assertVisible',
]);

export const patternTargetSchema = z.object({
  role: z.string().nullish(),
  name: z.string().nullish(),
  testId: z.string().nullish(),
});

/**
 * `object` exists because most real Playwright helpers take an options bag
 * (`selectOption(page, { label }, { value })`), not positional scalars — its
 * `fields` list is what lets codegen emit a literal with the right keys. A
 * `paramSource` targets one of those fields via its own `path`.
 */
export const paramSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['string', 'number', 'boolean', 'object']),
  fields: z.array(z.string().min(1).max(80)).max(20).optional(),
});

export const patternStepSchema = z.object({
  action: stepActionSchema,
  target: patternTargetSchema,
});

export const paramSourceSchema = z.object({
  param: z.string().min(1),
  /** Which field of an `object` param this fills; omitted for a scalar param, which takes the value whole. */
  path: z.string().min(1).max(80).nullish(),
  stepIndex: z.number().int().min(0),
  from: z.enum(['text', 'value', 'testId']),
});

export const testFunctionKindSchema = z.enum(['page-object-method', 'helper', 'fixture']);

/**
 * What the AI extraction endpoint accepts back from the model. Deliberately
 * excludes `module` and `urlPattern` — a pasted function has no file path or
 * routing context to infer either from, so those stay user-supplied fields
 * in the review form rather than something the model is asked to guess.
 */
export const aiExtractedFunctionSchema = z.object({
  name: testFunctionNameSchema,
  kind: testFunctionKindSchema,
  receiver: optionalIdentifierSchema,
  importName: optionalIdentifierSchema,
  params: z.array(paramSchema).max(10),
  returnsPage: z.boolean().optional(),
  steps: z.array(patternStepSchema).min(1, 'At least one pattern step is required').max(30),
  paramSources: z.array(paramSourceSchema).max(10).optional(),
  /** The model's own confidence, 0-1 — surfaced in the review form so a low-confidence extraction reads as one. */
  confidence: z.number().min(0).max(1).optional(),
  /** What the model couldn't represent (unseen helper calls, collapsed branches, skipped locators) — shown beside the confidence so a thin pattern explains itself instead of looking complete. */
  notes: z.string().max(500).nullish(),
});

/**
 * The full wire shape for creating a catalog entry directly (unlike
 * `aiExtractedFunctionSchema`, includes `module`/`urlPattern`/`source` —
 * fields no extraction step can infer). Shared by the create endpoint
 * (`server/api/projects/[id]/test-functions.post.ts`) and the MCP
 * `create_test_function` tool so both hold a caller to the same shape.
 */
export const createTestFunctionSchema = z.object({
  name: testFunctionNameSchema,
  kind: testFunctionKindSchema,
  module: moduleSchema,
  receiver: optionalIdentifierSchema,
  importName: optionalIdentifierSchema,
  params: z.array(paramSchema).max(10),
  returnsPage: z.boolean().optional(),
  urlPattern: z.string().max(240).nullish(),
  steps: z.array(patternStepSchema).min(1, 'At least one pattern step is required').max(30),
  paramSources: z.array(paramSourceSchema).max(10).optional(),
  source: z.enum(['manual', 'scanned', 'recorded', 'ai-extracted']).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

/**
 * The same shape with every field optional — a PATCH-style update where an
 * absent field means "leave it alone". Lives here beside the create schema so
 * the endpoint and the demo router's mirror validate against the identical
 * rules.
 */
export const updateTestFunctionSchema = z.object({
  name: testFunctionNameSchema.optional(),
  kind: testFunctionKindSchema.optional(),
  module: moduleSchema.optional(),
  receiver: optionalIdentifierSchema,
  importName: optionalIdentifierSchema,
  params: z.array(paramSchema).max(10).optional(),
  returnsPage: z.boolean().optional(),
  urlPattern: z.string().max(240).nullish(),
  steps: z.array(patternStepSchema).min(1).max(30).optional(),
  paramSources: z.array(paramSourceSchema).max(10).optional(),
  source: z.enum(['manual', 'scanned', 'recorded', 'ai-extracted']).optional(),
  confidence: z.number().min(0).max(1).optional(),
});
