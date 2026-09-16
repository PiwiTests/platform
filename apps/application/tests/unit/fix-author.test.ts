import { describe, test, expect } from 'vitest';

// The schema barrel picks the PostgreSQL schema when PIWI_DATABASE_URL is set;
// the module under test imports it, so clear it before importing.
delete process.env.PIWI_DATABASE_URL;
const { selectFixAuthorRecipient } = await import('../../server/utils/notifications/fix-author');

const USERS = [
  { id: 1, email: 'ada@example.com' },
  { id: 2, email: 'Grace@Example.com' },
  { id: 3, email: null },
];

describe('selectFixAuthorRecipient — registered users only', () => {
  test('matches a registered user by email, case-insensitively', () => {
    expect(selectFixAuthorRecipient({ name: 'Ada', email: 'ada@example.com' }, USERS)).toEqual({
      userId: 1,
      email: 'ada@example.com',
    });
    // The commit email casing differs from the account email — still the same person.
    expect(selectFixAuthorRecipient({ name: 'Grace', email: 'grace@example.com' }, USERS)).toEqual({
      userId: 2,
      email: 'Grace@Example.com',
    });
  });

  test('never targets an author who is not a registered user', () => {
    expect(selectFixAuthorRecipient({ name: 'Outside', email: 'contributor@other.org' }, USERS)).toBeNull();
  });

  test('returns null when the author or its email is missing', () => {
    expect(selectFixAuthorRecipient(undefined, USERS)).toBeNull();
    expect(selectFixAuthorRecipient(null, USERS)).toBeNull();
    expect(selectFixAuthorRecipient({ name: 'No email', email: '' }, USERS)).toBeNull();
    expect(selectFixAuthorRecipient({ name: 'Spaces', email: '   ' }, USERS)).toBeNull();
  });

  test('a user row without an email is never a match', () => {
    expect(selectFixAuthorRecipient({ name: 'Ghost', email: '' }, [{ id: 3, email: null }])).toBeNull();
  });
});
