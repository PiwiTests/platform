import type { BrowserContext, Page } from '@playwright/test';

/** Opens every shadow root the pages of `context` attach, so a spec can read a panel that is closed by design. */
export async function openShadowRoots(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init: ShadowRootInit) {
      return attach.call(this, { ...init, mode: 'open' });
    };
  });
}

/**
 * The elements inside the page's open shadow roots whose text is wider than
 * their box: a label or a button that clips. Only an element holding text of
 * its own counts, so a box that a positioned child spills out of does not.
 * Text fields and code are left out: code (`code`, `.mono`, `.piwi-loc`) is the
 * same in every language, and some rows cut a long locator on purpose.
 */
export function clippedInShadows(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    const holdsText = (el: Element) =>
      [...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim() !== '');
    const walk = (root: Document | ShadowRoot) => {
      for (const el of root.querySelectorAll<HTMLElement>('*')) {
        if (el.shadowRoot) walk(el.shadowRoot);
        if (root === document || !holdsText(el)) continue;
        if (['INPUT', 'TEXTAREA', 'SELECT', 'STYLE', 'CODE'].includes(el.tagName)) continue;
        if (el.closest('.mono, .piwi-loc')) continue;
        const overflow = getComputedStyle(el).overflowX;
        if (overflow === 'auto' || overflow === 'scroll') continue;
        if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) {
          const text = (el.textContent ?? '').trim().slice(0, 60);
          found.push(`${el.tagName.toLowerCase()}.${el.className}: ${el.scrollWidth} > ${el.clientWidth} "${text}"`);
        }
      }
    };
    walk(document);
    return found;
  });
}
