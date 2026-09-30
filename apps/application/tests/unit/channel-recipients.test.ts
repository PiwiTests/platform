import { describe, expect, test } from 'vitest';
import { channelOwnerLabel, channelOwnerOf, channelRecipient } from '#shared/notifications/channel-recipients';

describe('channelOwnerOf', () => {
  test('a channel without an owner is global, the viewer’s own is theirs, anyone else’s is named', () => {
    expect(channelOwnerOf(null, 5)).toEqual({ kind: 'global' });
    expect(channelOwnerOf(5, 5)).toEqual({ kind: 'viewer' });
    expect(channelOwnerOf(7, 5, 'Alice')).toEqual({ kind: 'user', name: 'Alice' });
    expect(channelOwnerOf(7, 5)).toEqual({ kind: 'user', name: 'user #7' });
  });

  test('labels', () => {
    expect(channelOwnerLabel({ kind: 'global' })).toBe('Global channel');
    expect(channelOwnerLabel({ kind: 'viewer' })).toBe('Your channel');
    expect(channelOwnerLabel({ kind: 'user', name: 'Alice' })).toBe("Alice's channel");
  });
});

describe('channelRecipient', () => {
  const global = { kind: 'global' } as const;
  const viewer = { kind: 'viewer' } as const;
  const alice = { kind: 'user', name: 'Alice' } as const;

  test('an email channel names its address', () => {
    expect(channelRecipient({ type: 'email', address: 'qa@example.test' }, global)).toBe('Email to qa@example.test');
    expect(channelRecipient({ type: 'personal_email', address: 'me@example.test' }, viewer)).toBe(
      'Email to me@example.test, your account email',
    );
  });

  test('without the address or endpoint, it names whose it is', () => {
    expect(channelRecipient({ type: 'email' }, alice)).toBe("Email to Alice's address");
    expect(channelRecipient({ type: 'personal_email' }, alice)).toBe("Email to Alice's account email");
    expect(channelRecipient({ type: 'webhook' }, alice)).toBe("Webhook POST to Alice's endpoint");
  });

  test('chat channels, webhooks and browser tabs', () => {
    expect(channelRecipient({ type: 'slack' }, global)).toBe('Slack message to the channel its webhook posts to');
    expect(channelRecipient({ type: 'teams' }, global)).toBe(
      'Microsoft Teams card in the channel its webhook posts to',
    );
    expect(channelRecipient({ type: 'webhook', url: 'https://ci.example.test:8443/hooks/piwi?x=1' }, viewer)).toBe(
      'Webhook POST to ci.example.test:8443',
    );
    expect(channelRecipient({ type: 'browser' }, viewer)).toBe('Notification in your open dashboard tabs');
    expect(channelRecipient({ type: 'browser' }, global)).toBe(
      'Notification in the open dashboard tabs of everyone who can open the projects',
    );
  });
});
