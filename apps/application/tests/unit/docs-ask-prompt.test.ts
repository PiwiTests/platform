import { describe, test, expect } from 'vitest';
import {
  REFUSAL,
  buildMessages,
  checkGrounding,
  linkCitations,
  normalizeCitations,
  readAnswer,
  withoutLinkTargets,
} from '../../../docs/.vitepress/theme/ask-docs/prompt';

describe('withoutLinkTargets', () => {
  test('keeps the words of a link and drops its address', () => {
    expect(withoutLinkTargets('See the [reporter options](/guide/reporter#options) and [CI](./ci).')).toBe(
      'See the reporter options and CI.',
    );
  });

  test('leaves a code fence as written', () => {
    const fence = '```md\n[a](b)\n```';
    expect(withoutLinkTargets(fence)).toBe(fence);
  });
});

describe('buildMessages', () => {
  const passages = [
    {
      title: 'Flaky tests & quarantine',
      headings: ['Flaky test detection'],
      markdown: 'A test is flaky when its result changes. See [runs](/guide/concepts).',
    },
    { title: 'Database', headings: [], markdown: '| Backend | Use |\n|---|---|\n| SQLite | default |' },
  ];
  const [system, user] = buildMessages('how do I find flaky tests?', passages);

  test('gives the rules, then the numbered passages and the question', () => {
    expect(system!.role).toBe('system');
    expect(system!.content).toContain(REFUSAL);
    expect(user!.role).toBe('user');
    expect(user!.content).toContain('[1] Flaky tests & quarantine > Flaky test detection\nA test is flaky');
    expect(user!.content).toContain('[2] Database\n| Backend | Use |');
    expect(user!.content.endsWith('Question: how do I find flaky tests?')).toBe(true);
  });

  test('does not hand the model addresses to copy', () => {
    expect(user!.content).not.toContain('/guide/concepts');
    expect(user!.content).toContain('See runs.');
  });
});

describe('readAnswer', () => {
  test('a short reply that says the passages do not answer is no answer', () => {
    for (const reply of [
      REFUSAL,
      '  The docs do not cover this.\n',
      'None of the passages addresses writing a unit test in Rust.',
      'The provided documentation does not contain information regarding weather conditions.',
      'I cannot find that in the passages.',
    ]) {
      expect(readAnswer(reply)).toEqual({ covered: false, markdown: '' });
    }
  });

  test('a long answer that happens to start like a refusal is an answer', () => {
    const answer = `The docs do not cover this in one place, so here are the steps: ${'- Set the provider variable first [1]\n'.repeat(8)}`;
    expect(readAnswer(answer).covered).toBe(true);
  });

  test('a refusal written after an answer is removed, the answer stands', () => {
    expect(readAnswer(`- Set the provider variable first [1]\n\n${REFUSAL}`)).toEqual({
      covered: true,
      markdown: '- Set the provider variable first [1]',
    });
  });

  test('an empty reply is no answer, and reasoning is dropped', () => {
    expect(readAnswer('   ')).toEqual({ covered: false, markdown: '' });
    expect(readAnswer('<think>Let me think about it.</think>\n- The answer [1]')).toEqual({
      covered: true,
      markdown: '- The answer [1]',
    });
    expect(readAnswer('<think>never closed')).toEqual({ covered: false, markdown: '' });
  });
});

describe('checkGrounding', () => {
  const passages = [
    'Set `PIWI_AI_PROVIDER` to `anthropic`, `openai` or `claude-cli`. The UI then shows the provider read-only.',
  ];

  test('an answer made of the passages is fully supported', () => {
    const grounding = checkGrounding(
      'Set `PIWI_AI_PROVIDER` to `openai` [1]. The UI shows the provider read-only.',
      passages,
    );
    expect(grounding.invented).toEqual([]);
    expect(grounding.support).toBeGreaterThan(0.9);
  });

  test('a name that no passage contains is reported', () => {
    const grounding = checkGrounding('Run `piwi config --set environment=Paris` and set PIWI_TIME_ZONE.', passages);
    expect(grounding.invented).toEqual(['piwi config --set environment=Paris', 'PIWI_TIME_ZONE']);
    expect(grounding.support).toBeLessThan(0.5);
  });

  test('a value made of words the passages contain is not invented', () => {
    expect(checkGrounding('Use `openai` or `claude-cli`.', passages).invented).toEqual([]);
  });

  test('an empty answer has nothing to doubt', () => {
    expect(checkGrounding('', passages)).toEqual({ invented: [], support: 1 });
  });
});

describe('citations', () => {
  test('normalizeCitations gives each cited passage its own marker', () => {
    expect(normalizeCitations('One [1, 2] and two [2;3] and three [1].')).toBe(
      'One [1][2] and two [2][3] and three [1].',
    );
  });

  test('linkCitations turns a citation into a link to its source', () => {
    expect(linkCitations('Use the switch [1] then restart [2].', ['/a#x', '/b'])).toBe(
      'Use the switch [\\[1\\]](/a#x) then restart [\\[2\\]](/b).',
    );
  });

  test('linkCitations leaves code, unknown numbers and real links alone', () => {
    const markdown = ['Read `list[1]` and [3] and [1](/already) here.', '', '```js', 'const x = list[1]', '```'].join(
      '\n',
    );
    expect(linkCitations(markdown, ['/a', '/b'])).toBe(markdown);
  });
});
