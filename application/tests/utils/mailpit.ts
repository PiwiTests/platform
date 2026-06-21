/**
 * Helper for interacting with the Mailpit API.
 * Mailpit HTTP API: http://<host>:8025/api/v1/
 */

export interface MailpitMessage {
  ID: string;
  Subject: string;
  From: { Address: string; Name: string };
  To: Array<{ Address: string; Name: string }>;
  Snippet: string;
  Date: string;
}

export interface MailpitMessageDetail extends MailpitMessage {
  HTML: string;
  Text: string;
}

export class MailpitClient {
  constructor(private readonly baseUrl: string) {}

  async deleteAll(): Promise<void> {
    await fetch(`${this.baseUrl}/api/v1/messages`, { method: 'DELETE' });
  }

  async listMessages(): Promise<MailpitMessage[]> {
    const res = await fetch(`${this.baseUrl}/api/v1/messages`);
    const data = (await res.json()) as { messages: MailpitMessage[] };
    return data.messages ?? [];
  }

  async waitForMessage(
    predicate: (msg: MailpitMessage) => boolean,
    opts: { timeoutMs?: number; pollMs?: number } = {},
  ): Promise<MailpitMessage> {
    const { timeoutMs = 10_000, pollMs = 400 } = opts;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const msgs = await this.listMessages();
      const match = msgs.find(predicate);
      if (match) return match;
      await new Promise((r) => setTimeout(r, pollMs));
    }
    throw new Error(`Mailpit: no matching message within ${timeoutMs}ms`);
  }

  async getMessage(id: string): Promise<MailpitMessageDetail> {
    const res = await fetch(`${this.baseUrl}/api/v1/message/${id}`);
    return res.json() as Promise<MailpitMessageDetail>;
  }

  /** Pull the first URL matching a pattern out of the email body (HTML or text). */
  extractLink(msg: MailpitMessageDetail, pattern: RegExp): string | null {
    const hay = msg.HTML || msg.Text || '';
    const m = hay.match(pattern);
    return m ? m[0] : null;
  }
}
