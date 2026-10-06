import { defineEventHandler, setResponseHeader } from 'h3';
import { HTML_CONTENT_TYPE } from '../../utils/page-template';
import { PRODUCTS, shopPage } from '../../utils/shop';

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Content-Type', HTML_CONTENT_TYPE);
  return shopPage(
    'Cart',
    `<h1>Cart</h1>
     <ul id="items"></ul>
     <p id="total"></p>
     <button type="button" class="primary" id="checkout">Checkout</button>`,
    {
      script: `
        const products = ${JSON.stringify(PRODUCTS)};
        const items = shop.cart().map((slug) => products.find((p) => p.slug === slug)).filter(Boolean);
        const list = document.getElementById('items');
        for (const item of items) {
          const li = document.createElement('li');
          li.textContent = item.name + ' · €' + item.price.toFixed(2);
          list.append(li);
        }
        const total = items.reduce((sum, item) => sum + item.price, 0);
        document.getElementById('total').textContent = items.length
          ? 'Total: €' + total.toFixed(2)
          : 'Your cart is empty.';
        const checkout = document.getElementById('checkout');
        checkout.disabled = items.length === 0;
        checkout.addEventListener('click', () => location.assign('/shop/checkout'));`,
    },
  );
});
