import type { BrowserContext } from '@playwright/test';

export const SHOP_ORIGIN = 'https://record-test.local';

/**
 * A two-page shop with a coupon bug: applying SPRING10 posts to
 * `/api/cart/coupon`, which answers 500, the page logs the failure, and the
 * total stays at 50 instead of dropping to 45. The cart has no Download
 * invoice button. The checkout page logs a warning as it loads. With `fixed`,
 * the endpoint answers 200, the total drops, and the button is there.
 */
function cartPage(fixed: boolean): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Cart</title></head><body>
  <header><nav aria-label="Main"><a href="/cart">Cart</a></nav></header>
  <main>
    <h1>Your cart</h1>
    <ul><li>Mug × 2</li><li>Tea × 1</li></ul>
    <form id="coupon-form">
      <label for="coupon">Coupon</label>
      <input id="coupon" name="coupon" />
      <button type="submit">Apply</button>
    </form>
    <p id="total" data-testid="cart-total">Total: 50</p>
    ${fixed ? '<button type="button">Download invoice</button>' : ''}
    <a href="/checkout">Checkout</a>
  </main>
  <script>
    document.getElementById('coupon-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = document.getElementById('coupon').value;
      const res = await fetch('/api/cart/coupon?code=' + encodeURIComponent(code), { method: 'POST' });
      if (!res.ok) {
        console.error('Coupon failed: ' + res.status);
        return;
      }
      document.getElementById('total').textContent = 'Total: 45';
    });
  </script>
</body></html>`;
}

const CHECKOUT_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Checkout</title></head><body>
  <main><h1>Checkout</h1><p>Pay 50</p></main>
  <script>console.warn('Checkout: total not recomputed');</script>
</body></html>`;

export async function routeShop(context: BrowserContext, shop: { fixed: boolean }): Promise<void> {
  await context.route(`${SHOP_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/cart/coupon') {
      await route.fulfill(
        shop.fixed
          ? { status: 200, contentType: 'application/json', body: '{"total":45}' }
          : { status: 500, contentType: 'application/json', body: '{"error":"secret server detail"}' },
      );
      return;
    }
    const body = url.pathname === '/checkout' ? CHECKOUT_PAGE : cartPage(shop.fixed);
    await route.fulfill({ contentType: 'text/html', body });
  });
}
