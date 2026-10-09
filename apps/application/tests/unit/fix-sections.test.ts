import { describe, test, expect } from 'vitest';
import type { NextStepKind } from '#shared/next-step';
import { FIX_SECTION_ORDER, fixSectionForNextStep, type FixSectionKey } from '../../app/utils/fix-sections';

const ALL: FixSectionKey[] = [...FIX_SECTION_ORDER];

describe('fixSectionForNextStep', () => {
  test.each<[NextStepKind, FixSectionKey]>([
    ['apply-patch', 'diagnosis'],
    ['follow-diagnosis', 'diagnosis'],
    ['diagnose', 'diagnosis'],
    ['replace-locator', 'locator-fix'],
    ['rerun-in-ci', 'verify'],
    ['reproduce', 'reproduce'],
    ['open-blocker', 'blocked'],
  ])('%s points at %s', (kind, section) => {
    expect(fixSectionForNextStep(kind, ALL)).toBe(section);
  });

  test.each<NextStepKind>([
    'mark-resolved',
    'see-what-changed',
    'compare-attempts',
    'verify-flake-fix',
    'reproduce-flake',
  ])('%s points at no section', (kind) => {
    expect(fixSectionForNextStep(kind, ALL)).toBeNull();
  });

  test('a section the page does not show gives none', () => {
    expect(fixSectionForNextStep('replace-locator', ['diagnosis', 'verify'])).toBeNull();
    expect(fixSectionForNextStep('apply-patch', ['verify'])).toBeNull();
  });

  test('no next step gives none', () => {
    expect(fixSectionForNextStep(null, ALL)).toBeNull();
    expect(fixSectionForNextStep(undefined, ALL)).toBeNull();
  });
});
