export function useFoldableSummary(key: string) {
  const cookieKey = `piwi-summary-fold-${key}`;
  const folded = ref(false);

  if (import.meta.server) {
    try {
      const headers = useRequestHeaders(['cookie']);
      const cookieStr = headers.cookie || '';
      const match = cookieStr.match(new RegExp(`(?:^|;\\s*)${cookieKey}=([^;]*)`));
      if (match) {
        folded.value = match[1] === 'true';
      }
    } catch {
      // headers not available
    }
  } else {
    try {
      const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${cookieKey}=([^;]*)`));
      if (match) {
        folded.value = match[1] === 'true';
      }
    } catch {
      // document not available
    }
  }

  function toggle() {
    folded.value = !folded.value;
    if (import.meta.client) {
      document.cookie = `${cookieKey}=${folded.value}; path=/; max-age=31536000; sameSite=lax`;
    }
  }

  return { folded, toggle };
}
