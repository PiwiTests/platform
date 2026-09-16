import { describe, test, expect } from 'vitest';
import { buildDiagnosisSystemPrompt, languageInstruction } from '../../server/utils/ai-system-prompt';

describe('languageInstruction', () => {
  test('is empty when no language is set (today’s behavior)', () => {
    expect(languageInstruction(null)).toBe('');
    expect(languageInstruction(undefined)).toBe('');
    expect(languageInstruction('  ')).toBe('');
  });

  test('names the language and keeps data verbatim', () => {
    const line = languageInstruction('French');
    expect(line).toContain('French');
    expect(line).toContain('keep code, locators, file paths and error text verbatim');
  });
});

describe('buildDiagnosisSystemPrompt', () => {
  test('appends a Response Language block only when a language is set', () => {
    const withLang = buildDiagnosisSystemPrompt({ language: 'Japanese' });
    expect(withLang).toContain('## Response Language');
    expect(withLang).toContain('Japanese');

    const without = buildDiagnosisSystemPrompt({});
    expect(without).not.toContain('## Response Language');
  });

  test('keeps the global and project instruction blocks alongside the language', () => {
    const prompt = buildDiagnosisSystemPrompt({
      globalInstructions: 'Be terse.',
      projectInstructions: 'This is the checkout suite.',
      language: 'German',
    });
    expect(prompt).toContain('## Global Analysis Instructions');
    expect(prompt).toContain('## Project-Specific Context');
    expect(prompt).toContain('## Response Language');
    expect(prompt).toContain('German');
  });
});
