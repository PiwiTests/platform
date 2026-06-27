import Anthropic from '@anthropic-ai/sdk';
import { getAppSetting } from './app-settings';
import { decryptSecret, getEncryptionKey } from './crypto';
import type { AiProvider, AiConfig, AiModelRole, ResolvedAiRole } from '~~/types/api';

export type { AiConfig };

type DbClient = Awaited<ReturnType<typeof import('../database').getDatabase>>;

/** Stored shape of a single role in the `ai` app-setting (apiKey is encrypted). */
interface StoredRole {
  provider?: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string; // encrypted at rest
  /** When set, inherit provider/apiKey/baseUrl from the named role (model may still differ). */
  reuse?: AiModelRole | null;
}

/** Stored shape of the `ai` app-setting. New installs use `roles`; older installs use the flat fields. */
interface StoredAi {
  autoDiagnose?: boolean;
  roles?: Partial<Record<AiModelRole, StoredRole>>;
  // ── Legacy flat fields (pre-roles installs) ──
  provider?: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  researchModel?: string;
  researchProvider?: string;
  researchBaseUrl?: string;
  researchApiKey?: string;
}

function isValidRole(role: ResolvedAiRole): boolean {
  if (role.provider === 'anthropic') return Boolean(role.apiKey);
  if (role.provider === 'openai') return Boolean(role.baseUrl && role.model);
  return false;
}

/** Build a resolved role from raw (already-decrypted) values, or null if incomplete/invalid. */
function makeRole(
  provider?: string | null,
  apiKey?: string | null,
  model?: string | null,
  baseUrl?: string | null,
): ResolvedAiRole | null {
  const p = (provider || '') as AiProvider;
  if (p !== 'anthropic' && p !== 'openai') return null;
  const role: ResolvedAiRole = { provider: p, apiKey: apiKey || '', model: model || '', baseUrl: baseUrl || null };
  return isValidRole(role) ? role : null;
}

const ROLE_ORDER: AiModelRole[] = ['diagnosis', 'research', 'embedding'];

/** Resolve the new `roles` storage shape, decrypting keys and following `reuse` links. */
function resolveStoredRoles(roles: Partial<Record<AiModelRole, StoredRole>>): AiConfig['roles'] {
  const decrypt = (enc?: string) => (enc ? decryptSecret(enc, getEncryptionKey()) : '');
  const out: Record<AiModelRole, ResolvedAiRole | null> = { diagnosis: null, research: null, embedding: null };

  for (const role of ROLE_ORDER) {
    const cfg = roles[role];
    if (!cfg) continue;
    if (cfg.reuse && out[cfg.reuse]) {
      const base = out[cfg.reuse]!;
      out[role] = makeRole(base.provider, base.apiKey, cfg.model || base.model, base.baseUrl);
    } else {
      out[role] = makeRole(cfg.provider, decrypt(cfg.apiKey), cfg.model, cfg.baseUrl);
    }
  }

  return { diagnosis: out.diagnosis!, research: out.research, embedding: out.embedding };
}

/**
 * Assemble the full AiConfig from a resolved diagnosis role plus optional
 * research/embedding roles. Returns null when the diagnosis role is unusable.
 */
function assembleConfig(
  diagnosis: ResolvedAiRole | null,
  research: ResolvedAiRole | null,
  embedding: ResolvedAiRole | null,
  autoDiagnose: boolean,
  source: 'env' | 'settings',
): AiConfig | null {
  if (!diagnosis) return null;
  return {
    provider: diagnosis.provider,
    apiKey: diagnosis.apiKey,
    model: diagnosis.model,
    baseUrl: diagnosis.baseUrl,
    autoDiagnose,
    source,
    roles: { diagnosis, research, embedding },
  };
}

export async function resolveAiConfig(db: DbClient): Promise<AiConfig | null> {
  const runtimeConfig = useRuntimeConfig();
  const envAi = runtimeConfig.ai as
    | {
        provider?: string;
        apiKey?: string;
        model?: string;
        baseUrl?: string;
        autoDiagnose?: boolean | string;
        researchModel?: string;
        researchProvider?: string;
        researchBaseUrl?: string;
        researchApiKey?: string;
        embeddingProvider?: string;
        embeddingModel?: string;
        embeddingBaseUrl?: string;
        embeddingApiKey?: string;
      }
    | undefined;

  if (envAi?.provider) {
    const diagnosis = makeRole(envAi.provider, envAi.apiKey, envAi.model, envAi.baseUrl);
    // Research defaults its provider/baseUrl/key to the diagnosis role when not overridden.
    const research = envAi.researchModel
      ? makeRole(
          envAi.researchProvider || envAi.provider,
          envAi.researchApiKey || envAi.apiKey,
          envAi.researchModel,
          envAi.researchBaseUrl || envAi.baseUrl,
        )
      : null;
    const embedding = makeRole(
      envAi.embeddingProvider,
      envAi.embeddingApiKey,
      envAi.embeddingModel,
      envAi.embeddingBaseUrl,
    );
    return assembleConfig(diagnosis, research, embedding, String(envAi.autoDiagnose) === 'true', 'env');
  }

  const stored = await getAppSetting<StoredAi>(db, 'ai');
  if (!stored) return null;

  const autoDiagnose = Boolean(stored.autoDiagnose);

  // New role-based storage
  if (stored.roles) {
    const roles = resolveStoredRoles(stored.roles);
    return assembleConfig(roles.diagnosis, roles.research, roles.embedding, autoDiagnose, 'settings');
  }

  // Legacy flat storage → map onto roles
  if (!stored.provider) return null;
  const decrypt = (enc?: string) => (enc ? decryptSecret(enc, getEncryptionKey()) : '');
  const diagnosis = makeRole(stored.provider, decrypt(stored.apiKey), stored.model, stored.baseUrl);
  const research = stored.researchModel
    ? makeRole(
        stored.researchProvider || stored.provider,
        stored.researchApiKey ? decrypt(stored.researchApiKey) : decrypt(stored.apiKey),
        stored.researchModel,
        stored.researchBaseUrl || stored.baseUrl,
      )
    : null;
  return assembleConfig(diagnosis, research, null, autoDiagnose, 'settings');
}

/** Resolved config for a given role, or null when that role is unconfigured. */
export function resolveAiRole(config: AiConfig, role: AiModelRole): ResolvedAiRole | null {
  return config.roles[role];
}

export interface AiAttachedImage {
  name: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  data: string; // base64
}

export interface AiCallOptions {
  system: string;
  user: string;
  jsonSchema?: object;
  maxTokens?: number;
  images?: AiAttachedImage[];
}

export interface AiCallResult {
  text: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface StreamChunk {
  type: 'text' | 'done' | 'error';
  data: unknown;
}

export interface StreamResult {
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export async function callAiProvider(config: ResolvedAiRole, opts: AiCallOptions): Promise<AiCallResult> {
  try {
    if (config.provider === 'anthropic') {
      return await callAnthropic(config, opts);
    }
    return await callOpenAiCompat(config, opts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[${config.provider}] ${msg.slice(0, 500)}`, { cause: err });
  }
}

async function callAnthropic(config: ResolvedAiRole, opts: AiCallOptions): Promise<AiCallResult> {
  const client = new Anthropic({
    apiKey: config.apiKey,
    baseURL: config.baseUrl || undefined,
    timeout: 120_000,
    maxRetries: 1,
  });

  type ImageBlock = {
    type: 'image';
    source: { type: 'base64'; media_type: AiAttachedImage['mediaType']; data: string };
  };
  type TextBlock = { type: 'text'; text: string };

  const userContent: string | Array<ImageBlock | TextBlock> = opts.images?.length
    ? [
        ...opts.images.map(
          (img): ImageBlock => ({
            type: 'image',
            source: { type: 'base64', media_type: img.mediaType, data: img.data },
          }),
        ),
        { type: 'text', text: opts.user },
      ]
    : opts.user;

  const res = await client.messages.create({
    model: config.model || 'claude-opus-4-8',
    max_tokens: opts.maxTokens ?? 8192,
    system: opts.system,
    messages: [{ role: 'user', content: userContent as Anthropic.MessageParam['content'] }],
    ...(opts.jsonSchema
      ? {
          output_config: {
            format: { type: 'json_schema' as const, schema: opts.jsonSchema as { [key: string]: unknown } },
          },
        }
      : {}),
  });

  if (res.stop_reason === 'refusal') {
    throw new Error('The model declined to analyze this failure');
  }

  const text = res.content.find((b) => b.type === 'text')?.text ?? '';
  return {
    text,
    model: res.model,
    inputTokens: res.usage.input_tokens ?? null,
    outputTokens: res.usage.output_tokens ?? null,
  };
}

async function callOpenAiCompat(config: ResolvedAiRole, opts: AiCallOptions): Promise<AiCallResult> {
  const baseUrl = (config.baseUrl || '').replace(/\/$/, '');
  const url = `${baseUrl}/chat/completions`;

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (config.apiKey) headers['authorization'] = `Bearer ${config.apiKey}`;

  const systemContent = opts.jsonSchema
    ? `${opts.system}\n\nRespond ONLY with a JSON object matching this schema:\n${JSON.stringify(opts.jsonSchema)}`
    : opts.system;

  type OAIPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

  const userMessageContent: string | OAIPart[] = opts.images?.length
    ? [
        ...opts.images.map(
          (img): OAIPart => ({
            type: 'image_url',
            image_url: { url: `data:${img.mediaType};base64,${img.data}` },
          }),
        ),
        { type: 'text', text: opts.user },
      ]
    : opts.user;

  const body = JSON.stringify({
    model: config.model,
    max_tokens: opts.maxTokens ?? 8192,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: userMessageContent },
    ],
  });

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`openai provider returned HTTP ${res.status}: ${bodyText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const text = data.choices?.[0]?.message?.content ?? '';
  return {
    text,
    model: data.model || config.model,
    inputTokens: data.usage?.prompt_tokens ?? null,
    outputTokens: data.usage?.completion_tokens ?? null,
  };
}

/**
 * Streaming variant of callAiProvider. Yields text tokens as they arrive from
 * the model, then a final `'done'` chunk with token counts.
 */
export async function* streamAiProvider(config: ResolvedAiRole, opts: AiCallOptions): AsyncGenerator<StreamChunk> {
  try {
    if (config.provider === 'anthropic') {
      yield* streamAnthropic(config, opts);
    } else {
      yield* streamOpenAiCompat(config, opts);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    yield { type: 'error', data: msg };
  }
}

async function* streamAnthropic(config: ResolvedAiRole, opts: AiCallOptions): AsyncGenerator<StreamChunk> {
  const client = new Anthropic({
    apiKey: config.apiKey,
    baseURL: config.baseUrl || undefined,
    timeout: 120_000,
    maxRetries: 1,
  });

  type ImageBlock = {
    type: 'image';
    source: { type: 'base64'; media_type: AiAttachedImage['mediaType']; data: string };
  };
  type TextBlock = { type: 'text'; text: string };

  const userContent: string | Array<ImageBlock | TextBlock> = opts.images?.length
    ? [
        ...opts.images.map(
          (img): ImageBlock => ({
            type: 'image',
            source: { type: 'base64', media_type: img.mediaType, data: img.data },
          }),
        ),
        { type: 'text', text: opts.user },
      ]
    : opts.user;

  const textChunks: string[] = [];
  let streamError: Error | null = null;
  let finalMsg: Anthropic.Message | null = null;
  let index = 0;
  let resolveFinal: (() => void) | null = null;
  const finalDone = new Promise<void>((r) => {
    resolveFinal = r;
  });

  const stream = client.messages.stream({
    model: config.model || 'claude-opus-4-8',
    max_tokens: opts.maxTokens ?? 8192,
    system: opts.system,
    messages: [{ role: 'user', content: userContent as Anthropic.MessageParam['content'] }],
    ...(opts.jsonSchema
      ? {
          output_config: {
            format: { type: 'json_schema' as const, schema: opts.jsonSchema as { [key: string]: unknown } },
          },
        }
      : {}),
  });

  stream.on('text', (text: string) => {
    textChunks.push(text);
  });

  stream.finalMessage().then(
    (msg) => {
      finalMsg = msg;
      if (resolveFinal) resolveFinal();
    },
    (err) => {
      streamError = err;
      if (resolveFinal) resolveFinal();
    },
  );

  // Poll for text chunks until the stream completes
  while (!finalMsg && !streamError) {
    while (index < textChunks.length) {
      yield { type: 'text', data: textChunks[index++] };
    }
    const raceResult = await Promise.race([finalDone, new Promise<undefined>((r) => setTimeout(r, 80))]);
    if (raceResult !== undefined) break;
  }

  // Drain any remaining chunks
  while (index < textChunks.length) {
    yield { type: 'text', data: textChunks[index++] };
  }

  if (streamError) throw streamError;

  const msg = finalMsg!;

  if (msg.stop_reason === 'refusal') {
    yield { type: 'error', data: 'The model declined to analyze this failure' };
    return;
  }

  yield {
    type: 'done',
    data: {
      model: msg.model,
      inputTokens: msg.usage?.input_tokens ?? null,
      outputTokens: msg.usage?.output_tokens ?? null,
    } as StreamResult,
  };
}

async function* streamOpenAiCompat(config: ResolvedAiRole, opts: AiCallOptions): AsyncGenerator<StreamChunk> {
  const baseUrl = (config.baseUrl || '').replace(/\/$/, '');
  const url = `${baseUrl}/chat/completions`;

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (config.apiKey) headers['authorization'] = `Bearer ${config.apiKey}`;

  const systemContent = opts.jsonSchema
    ? `${opts.system}\n\nRespond ONLY with a JSON object matching this schema:\n${JSON.stringify(opts.jsonSchema)}`
    : opts.system;

  type OAIPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

  const userMessageContent: string | OAIPart[] = opts.images?.length
    ? [
        ...opts.images.map(
          (img): OAIPart => ({
            type: 'image_url',
            image_url: { url: `data:${img.mediaType};base64,${img.data}` },
          }),
        ),
        { type: 'text', text: opts.user },
      ]
    : opts.user;

  const body = JSON.stringify({
    model: config.model,
    max_tokens: opts.maxTokens ?? 8192,
    temperature: 0.2,
    stream: true,
    stream_options: { include_usage: true },
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: userMessageContent },
    ],
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120_000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      throw new Error(`openai provider returned HTTP ${res.status}: ${bodyText.slice(0, 300)}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('Response body is not readable');

    const decoder = new TextDecoder();
    let buffer = '';
    let modelName = config.model;
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6).trim();
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>;
            model?: string;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
            x_groq?: { usage?: { completion_tokens?: number; prompt_tokens?: number } };
          };

          if (parsed.model) modelName = parsed.model;

          // Some providers (Groq, etc.) put usage in a custom field
          const usage =
            parsed.usage ||
            ((parsed as Record<string, unknown>).x_groq as
              | { prompt_tokens?: number; completion_tokens?: number }
              | undefined);
          if (usage) {
            if (usage.prompt_tokens != null) inputTokens = usage.prompt_tokens;
            if (usage.completion_tokens != null) outputTokens = usage.completion_tokens;
          }

          const choice = parsed.choices?.[0];
          if (choice?.delta?.content) {
            yield { type: 'text', data: choice.delta.content };
          }
        } catch {
          // Skip malformed SSE lines
        }
      }
    }

    yield { type: 'done', data: { model: modelName, inputTokens, outputTokens } as StreamResult };
  } finally {
    clearTimeout(timeoutId);
  }
}
