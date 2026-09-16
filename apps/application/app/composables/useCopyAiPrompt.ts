/**
 * Copies the exact request a diagnosis would send for a given context endpoint —
 * system prompt, user message, image count and response schema — built from
 * stored data, so it works whether or not an AI provider is configured. Shared
 * by the copy-prompt button and the next-step line.
 */
export function useCopyAiPrompt() {
  const { copy, copied } = useCopy();
  const toast = useToast();
  const loading = ref(false);

  // Fetched directly rather than through `$fetch`, so the base path is applied by
  // hand — the demo's service worker only intercepts its own `/demo/` prefix.
  const base = computed(() => (useRuntimeConfig().app?.baseURL ?? '/').replace(/\/$/, ''));

  async function copyPrompt(contextEndpoint: string) {
    loading.value = true;
    try {
      const response = await fetch(`${base.value}${contextEndpoint}?format=prompt`);
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      copy(await response.text(), { toast: 'AI prompt copied' });
    } catch (error) {
      toast.add({ title: 'Could not copy the prompt', description: errorMessage(error), color: 'error' });
    } finally {
      loading.value = false;
    }
  }

  return { copyPrompt, copied, loading };
}
