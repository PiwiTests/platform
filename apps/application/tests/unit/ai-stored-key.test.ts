import { describe, test, expect } from 'vitest';
import { storedKeyFor } from '../../server/utils/ai-provider';

const stored = { provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-stored' };

describe('storedKeyFor', () => {
  test('returns the stored key for the endpoint it was saved for', () => {
    expect(storedKeyFor(stored, 'openai', 'https://openrouter.ai/api/v1')).toBe('sk-stored');
    expect(storedKeyFor(stored, 'openai', 'https://OpenRouter.ai/api/v1/')).toBe('sk-stored');
    expect(storedKeyFor({ provider: 'anthropic', baseUrl: null, apiKey: 'k' }, 'anthropic', '')).toBe('k');
  });

  test('never hands the stored key to another endpoint or provider', () => {
    expect(storedKeyFor(stored, 'openai', 'https://attacker.example/v1')).toBe('');
    expect(storedKeyFor(stored, 'anthropic', 'https://openrouter.ai/api/v1')).toBe('');
    expect(storedKeyFor(stored, undefined, 'https://openrouter.ai/api/v1')).toBe('');
    expect(storedKeyFor(null, 'openai', 'https://openrouter.ai/api/v1')).toBe('');
  });
});
