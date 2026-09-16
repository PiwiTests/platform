import { describe, it, expect } from 'vitest';
import { buildOpenAiBody, type OpenAiAttempt } from '../../server/utils/ai-provider';
import type { ResolvedAiRole, AiCallOptions } from '~~/types/api';

function role(temperature: number | null): ResolvedAiRole {
  return { provider: 'openai', apiKey: '', model: 'gpt-test', baseUrl: 'http://localhost:1234/v1', temperature };
}

const opts: AiCallOptions = { system: 'system prompt', user: 'user prompt' };
const attempt: OpenAiAttempt = { strictFormat: true, withImages: false };

describe('buildOpenAiBody temperature', () => {
  it('omits temperature entirely when unset — required so reasoning models (o1/o3/GPT-5-class) do not reject the request', () => {
    const body = buildOpenAiBody(role(null), opts, attempt);
    expect('temperature' in body).toBe(false);
  });

  it('sends the exact configured value when set', () => {
    const body = buildOpenAiBody(role(0.3), opts, attempt);
    expect(body.temperature).toBe(0.3);
  });

  it('sends an explicit 0 when configured (a valid value for non-reasoning models)', () => {
    const body = buildOpenAiBody(role(0), opts, attempt);
    expect(body.temperature).toBe(0);
  });
});
