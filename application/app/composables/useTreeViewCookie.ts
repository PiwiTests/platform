export function useTreeViewCookie(key: string) {
  const cookieKey = `piwi-tree-view-${key}`;
  const treeView = ref(false);

  if (import.meta.server) {
    try {
      const headers = useRequestHeaders(['cookie']);
      const cookieStr = headers.cookie || '';
      const match = cookieStr.match(new RegExp(`(?:^|;\\s*)${cookieKey}=([^;]*)`));
      if (match) {
        treeView.value = match[1] === 'true';
      }
    } catch {
      // headers not available
    }
  } else {
    try {
      const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${cookieKey}=([^;]*)`));
      if (match) {
        treeView.value = match[1] === 'true';
      }
    } catch {
      // document not available
    }
  }

  function setTreeView(val: boolean) {
    treeView.value = val;
    if (import.meta.client) {
      document.cookie = `${cookieKey}=${val}; path=/; max-age=31536000; sameSite=lax`;
    }
  }

  return { treeView, setTreeView };
}
