/**
 * Who a notification channel reaches and whose channel it is, in words. A
 * picker that sends to channels (a report schedule's *Send to*) shows both, so
 * the person choosing sees where the message lands before anything is sent.
 * Loads unchanged in the app, the server and the demo.
 */

/** Whose a channel is, from the reader's side. */
export type ChannelOwner = { kind: 'global' } | { kind: 'viewer' } | { kind: 'user'; name: string };

/** What a channel's recipient is read from: its type, its owner and the non-secret part of its config. */
export interface ChannelRecipientInput {
  type: string;
  /** An email channel's address, or the owner's account email for `personal_email`; absent when the reader may not see it. */
  address?: string | null;
  /** A webhook channel's endpoint. */
  url?: string | null;
}

export function channelOwnerOf(
  userId: number | null,
  viewerId: number | null,
  ownerName?: string | null,
): ChannelOwner {
  if (userId === null) return { kind: 'global' };
  if (userId === viewerId) return { kind: 'viewer' };
  return { kind: 'user', name: ownerName || `user #${userId}` };
}

/** "Global channel", "Your channel", "Alice's channel". */
export function channelOwnerLabel(owner: ChannelOwner): string {
  if (owner.kind === 'global') return 'Global channel';
  if (owner.kind === 'viewer') return 'Your channel';
  return `${owner.name}'s channel`;
}

function urlHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

/**
 * What the channel sends and who receives it: "Email to qa@example.com",
 * "Slack message to the channel its webhook posts to". With the address or
 * endpoint absent, it names whose it is instead.
 */
export function channelRecipient(channel: ChannelRecipientInput, owner: ChannelOwner): string {
  const possessive = owner.kind === 'viewer' ? 'your' : owner.kind === 'user' ? `${owner.name}'s` : null;
  switch (channel.type) {
    case 'personal_email': {
      const account = possessive ? `${possessive} account email` : 'the account email';
      return channel.address ? `Email to ${channel.address}, ${account}` : `Email to ${account}`;
    }
    case 'email':
      return channel.address ? `Email to ${channel.address}` : `Email to ${possessive ?? 'its'} address`;
    case 'slack':
      return 'Slack message to the channel its webhook posts to';
    case 'teams':
      return 'Microsoft Teams card in the channel its webhook posts to';
    case 'webhook': {
      const host = urlHost(channel.url);
      return host ? `Webhook POST to ${host}` : `Webhook POST to ${possessive ?? 'its'} endpoint`;
    }
    case 'browser':
      return possessive
        ? `Notification in ${possessive} open dashboard tabs`
        : 'Notification in the open dashboard tabs of everyone who can open the projects';
    default:
      return channel.type;
  }
}
