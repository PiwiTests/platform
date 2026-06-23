import Anthropic from '@anthropic-ai/sdk';
import { getAppSetting } from './app-settings';
import { decryptSecret, getEncryptionKey } from './crypto';
import type { AiProvider, AiConfig } from '~~/types/api';

export type { AiConfig };

type DbClient = Awaited<ReturnType<typeof import('../database').getDatabase>>;

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
      }
    | undefined;

  if (envAi?.provider) {
    const provider = envAi.provider as AiProvider;
    const config: AiConfig = {
      provider,
      apiKey: envAi.apiKey || '',
      model: envAi.model || '',
      baseUrl: envAi.baseUrl || null,
      autoDiagnose: String(envAi.autoDiagnose) === 'true',
      source: 'env',
      researchModel: envAi.researchModel || null,
      researchProvider: (envAi.researchProvider as AiProvider) || null,
      researchBaseUrl: envAi.researchBaseUrl || null,
      researchApiKey: envAi.researchApiKey || null,
    };
    if (!isValidConfig(config)) return null;
    return config;
  }

  const stored = await getAppSetting<{
    provider?: string;
    apiKey?: string;
    model?: string;
    baseUrl?: string;
    autoDiagnose?: boolean;
    researchModel?: string;
    researchProvider?: string;
    researchBaseUrl?: string;
    researchApiKey?: string;
  }>(db, 'ai');

  if (!stored?.provider) return null;

  const config: AiConfig = {
    provider: stored.provider as AiProvider,
    apiKey: stored.apiKey ? decryptSecret(stored.apiKey, getEncryptionKey()) : '',
    model: stored.model || '',
    baseUrl: stored.baseUrl || null,
    autoDiagnose: Boolean(stored.autoDiagnose),
    source: 'settings',
    researchModel: stored.researchModel || null,
    researchProvider: (stored.researchProvider as AiProvider) || null,
    researchBaseUrl: stored.researchBaseUrl || null,
    researchApiKey: stored.researchApiKey ? decryptSecret(stored.researchApiKey, getEncryptionKey()) : null,
  };
  if (!isValidConfig(config)) return null;
  return config;
}

function isValidConfig(config: AiConfig): boolean {
  if (config.provider === 'anthropic') {
    return Boolean(config.apiKey);
  }
  if (config.provider === 'openai') {
    return Boolean(config.baseUrl && config.model);
  }
  return false;
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

export async function callAiProvider(config: AiConfig, opts: AiCallOptions): Promise<AiCallResult> {
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

async function callAnthropic(config: AiConfig, opts: AiCallOptions): Promise<AiCallResult> {
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

async function callOpenAiCompat(config: AiConfig, opts: AiCallOptions): Promise<AiCallResult> {
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
