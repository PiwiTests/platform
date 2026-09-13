import type { ClaudeCliStatus } from '~~/types/api';

/**
 * Client state for the local Claude CLI provider: health/auth status, the
 * interactive sign-in flow (streamed over SSE), and sign-out. Shared across
 * components via useState so the settings card and any status badge agree.
 */
export function useClaudeCli() {
  const status = useState<ClaudeCliStatus | null>('claude-cli-status', () => null);
  const loading = useState<boolean>('claude-cli-loading', () => false);
  const signingIn = useState<boolean>('claude-cli-signing-in', () => false);
  const loginLog = useState<string[]>('claude-cli-login-log', () => []);
  const loginUrl = useState<string | null>('claude-cli-login-url', () => null);

  async function refresh(force = false): Promise<void> {
    loading.value = true;
    try {
      status.value = await $fetch<ClaudeCliStatus>('/api/ai/claude-cli/status', {
        query: force ? { refresh: 'true' } : undefined,
      });
    } catch {
      // Keep the previous snapshot on a transient failure.
    } finally {
      loading.value = false;
    }
  }

  /** Run `claude auth login` and stream its progress. Resolves once the CLI exits. */
  async function signIn(): Promise<{ success: boolean; error: string | null }> {
    if (signingIn.value) return { success: false, error: 'Sign-in already in progress' };
    signingIn.value = true;
    loginLog.value = [];
    loginUrl.value = null;

    try {
      const res = await fetch(withBase('/api/ai/claude-cli/login'), {
        method: 'POST',
        headers: { accept: 'text/event-stream' },
      });
      if (!res.ok || !res.body) {
        return { success: false, error: `Sign-in failed to start (HTTP ${res.status})` };
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let outcome: { success: boolean; error: string | null } = { success: false, error: 'Sign-in ended unexpectedly' };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() || '';
        for (const frame of frames) {
          const ev = frame.match(/^event:\s*(.+)$/m)?.[1]?.trim();
          const dataRaw = frame.match(/^data:\s*(.+)$/m)?.[1];
          if (!ev || dataRaw == null) continue;
          const payload = safeJson(dataRaw);
          if (ev === 'log') {
            const line = (payload as { line?: string })?.line;
            const url = (payload as { url?: string | null })?.url;
            if (line) loginLog.value = [...loginLog.value, line];
            if (url) loginUrl.value = url;
          } else if (ev === 'done') {
            const p = payload as { success?: boolean; error?: string | null };
            outcome = { success: Boolean(p?.success), error: p?.error ?? null };
          }
        }
      }
      return outcome;
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      signingIn.value = false;
      await refresh(true);
    }
  }

  async function signOut(): Promise<{ success: boolean; error: string | null }> {
    try {
      await $fetch('/api/ai/claude-cli/logout', { method: 'POST' });
      return { success: true, error: null };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      await refresh(true);
    }
  }

  return { status, loading, signingIn, loginLog, loginUrl, refresh, signIn, signOut };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Prefix an API path with the app base URL so it works under the demo sub-path too. */
function withBase(path: string): string {
  const base = useRuntimeConfig().app.baseURL || '/';
  return `${base.replace(/\/$/, '')}${path}`;
}
