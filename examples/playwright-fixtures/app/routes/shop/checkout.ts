import { defineEventHandler, setResponseHeader } from 'h3';
import { HTML_CONTENT_TYPE } from '../../utils/page-template';
import { shopPage } from '../../utils/shop';

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Content-Type', HTML_CONTENT_TYPE);
  return shopPage(
    'Shipping',
    `<h1>Shipping</h1>
     <form id="shipping">
       <label for="name">Full name</label>
       <input id="name" name="name" autocomplete="name" required>
       <label for="address">Address</label>
       <input id="address" name="address" autocomplete="street-address" required>
       <label for="city">City</label>
       <input id="city" name="city" autocomplete="address-level2" required>
       <label for="country">Country</label>
       <select id="country" name="country">
         <option>France</option><option>Germany</option><option>Spain</option><option>United Kingdom</option>
       </select>
       <button type="submit" class="primary">Place order</button>
     </form>`,
    {
      script: `
        document.getElementById('shipping').addEventListener('submit', (event) => {
          event.preventDefault();
          const order = Object.fromEntries(new FormData(event.target));
          sessionStorage.setItem('shop_order', JSON.stringify({ ...order, items: shop.cart().length }));
          shop.setCart([]);
          location.assign('/shop/done');
        });`,
    },
  );
});
