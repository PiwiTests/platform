import type { Ref } from 'vue';

/**
 * The state of a page where the signed-in user allows or denies a client's
 * request to connect: Piwi Picker's and the editors' device authorization
 * (`/extension/connect`) and an MCP client's OAuth sign-in (`/oauth/consent`).
 * It loads the request on mount, unless the demo or `problem` says there is
 * none to load, and records the answer.
 */
export function useConnectRequest<T, A>(opts: {
  /** Why there is no request to load (a link without its code, an error the link carries), or null. */
  problem: () => string | null;
  /** Reads the request. */
  fetch: () => Promise<T>;
  /** Shown when reading fails with no message of its own. */
  loadFailed: string;
  /** Sends the answer about the request shown. */
  answer: (allow: boolean, request: T) => Promise<A>;
  /** The request once answered. */
  answered: (request: T, answer: A) => T;
}) {
  const config = useRuntimeConfig();
  const { authState } = useAuth();

  const request = ref(null) as Ref<T | null>;
  const loading = ref(true);
  const loadError = ref('');
  const deciding = ref<'allow' | 'deny' | null>(null);
  const decideError = ref('');

  /** Who answers, when authentication is on. */
  const signedInAs = computed(() => {
    const user = authState.value.user;
    return config.public.authEnabled && user ? user.name || user.username : null;
  });

  async function load() {
    loading.value = true;
    loadError.value = '';
    try {
      request.value = await opts.fetch();
    } catch (err) {
      request.value = null;
      loadError.value = errorMessage(err, opts.loadFailed);
    } finally {
      loading.value = false;
    }
  }

  /** Sends the answer; the server's reply, or null when it failed (the error is shown and the request reread). */
  async function decide(allow: boolean): Promise<A | null> {
    if (!request.value) return null;
    deciding.value = allow ? 'allow' : 'deny';
    decideError.value = '';
    try {
      const reply = await opts.answer(allow, request.value);
      request.value = opts.answered(request.value, reply);
      return reply;
    } catch (err) {
      decideError.value = errorMessage(err, 'The answer could not be saved.');
      await load();
      return null;
    } finally {
      deciding.value = null;
    }
  }

  onMounted(() => {
    const problem = config.public.demoMode ? 'The demo has no server to connect to.' : opts.problem();
    if (problem) {
      loading.value = false;
      loadError.value = problem;
      return;
    }
    void load();
  });

  return { request, loading, loadError, deciding, decideError, signedInAs, decide };
}
