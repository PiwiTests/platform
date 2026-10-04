import { defineEventHandler, setResponseHeader } from 'h3';
import { HTML_CONTENT_TYPE } from '../../utils/page-template';
import { PRODUCTS, formatPrice, shopPage } from '../../utils/shop';

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Content-Type', HTML_CONTENT_TYPE);
  const items = PRODUCTS.map(
    (p) => `<li><h2><a href="/shop/products/${p.slug}">${p.name}</a></h2><p class="price">${formatPrice(p.price)}</p></li>`,
  ).join('');
  return shopPage(
    'Products',
    `<h1>Products</h1>
     <p role="status" id="added"></p>
     <ul class="products">${items}</ul>`,
    {
      script: `
        const added = sessionStorage.getItem('shop_added');
        sessionStorage.removeItem('shop_added');
        if (added) document.getElementById('added').textContent = added + ' added to the cart';`,
    },
  );
});
