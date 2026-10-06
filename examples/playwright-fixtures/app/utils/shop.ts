/** The demo shop: its products, and the HTML shell of its pages. */
export interface Product {
  slug: string;
  name: string;
  price: number;
  description: string;
}

export const PRODUCTS: Product[] = [
  { slug: 'trail-shoes', name: 'Trail shoes', price: 89, description: 'Light shoes with a grippy sole for muddy paths.' },
  { slug: 'rain-jacket', name: 'Rain jacket', price: 129, description: 'A packable jacket that keeps the rain out.' },
  { slug: 'water-bottle', name: 'Water bottle', price: 19, description: 'Half a litre, keeps water cool for hours.' },
];

/**
 * A shop page. Its script keeps the shop's state in the browser: the signed-in shopper in the `shop_user` cookie, the
 * cart in local storage. A page that needs a shopper sends a visitor to the sign-in page first.
 */
export const shopPage = (title: string, body: string, { signedIn = true, script = '' } = {}) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${title} · Piwi Outdoor</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; color: #1f2933; }
    header { display: flex; gap: 1.25rem; align-items: center; padding: 0.75rem 1.5rem; background: #0f766e; color: #fff; }
    header a, header button { color: #fff; }
    header .brand { font-weight: 700; margin-right: auto; text-decoration: none; }
    header button { background: none; border: 1px solid #fff8; border-radius: 4px; padding: 0.25rem 0.6rem; cursor: pointer; }
    main { max-width: 44rem; margin: 2rem auto; padding: 0 1.5rem; }
    .products { list-style: none; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr)); gap: 1rem; }
    .products li { border: 1px solid #d9e2ec; border-radius: 8px; padding: 1rem; }
    .price { color: #52606d; }
    label { display: block; margin-top: 0.9rem; font-weight: 600; }
    input, select { display: block; margin-top: 0.3rem; width: 100%; max-width: 24rem; padding: 0.45rem; font: inherit; }
    button.primary { margin-top: 1.25rem; background: #0f766e; color: #fff; border: 0; border-radius: 6px; padding: 0.6rem 1.2rem; font: inherit; cursor: pointer; }
    [role="status"] { color: #0f766e; font-weight: 600; min-height: 1.5em; }
  </style>
</head>
<body>
  <header>
    <a class="brand" href="/shop">Piwi Outdoor</a>
    <a href="/shop">Products</a>
    <a href="/shop/cart" aria-label="Cart">Cart (<span id="cart-count">0</span>)</a>
    <a href="/shop/orders">Orders</a>
    <span id="shopper"></span>
    <button type="button" id="sign-out" hidden>Sign out</button>
  </header>
  <main>${body}</main>
  <script>
    const shop = {
      user: () => decodeURIComponent((document.cookie.match(/(?:^|; )shop_user=([^;]*)/) || [])[1] || ''),
      cart: () => JSON.parse(localStorage.getItem('shop_cart') || '[]'),
      setCart: (items) => localStorage.setItem('shop_cart', JSON.stringify(items)),
    };
    if (${signedIn} && !shop.user()) location.replace('/shop/login?next=' + encodeURIComponent(location.pathname));
    document.getElementById('cart-count').textContent = String(shop.cart().length);
    if (shop.user()) {
      document.getElementById('shopper').textContent = shop.user();
      const signOut = document.getElementById('sign-out');
      signOut.hidden = false;
      signOut.addEventListener('click', () => {
        document.cookie = 'shop_user=; path=/; max-age=0';
        location.assign('/shop/login');
      });
    }
    ${script}
  </script>
</body>
</html>`;

export const formatPrice = (price: number) => `€${price.toFixed(2)}`;
