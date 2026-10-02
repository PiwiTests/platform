/** A message from one of the extension's own pages (popup, options, DevTools), not from a content script. */
export function fromExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  return !!sender.url?.startsWith(chrome.runtime.getURL(''));
}
