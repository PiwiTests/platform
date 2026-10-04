import { createError, defineEventHandler, getRouterParam, setResponseHeader } from 'h3';
import { HTML_CONTENT_TYPE } from '../../../utils/page-template';
import { PRODUCTS, formatPrice, shopPage } from '../../../utils/shop';

export default defineEventHandler((event) => {
  const product = PRODUCTS.find((p) => p.slug === getRouterParam(event, 'slug'));
  if (!product) throw createError({ statusCode: 404, statusMessage: 'No such product' });
  setResponseHeader(event, 'Content-Type', HTML_CONTENT_TYPE);
  return shopPage(
    product.name,
    `<h1>${product.name}</h1>
     <p class="price">${formatPrice(product.price)}</p>
     <p>${product.description}</p>
     <label for="quantity">Quantity</label>
     <select id="quantity"><option>1</option><option>2</option><option>3</option></select>
     <button type="button" class="primary" id="add">Add to cart</button>
     <p><a href="/shop">Back to products</a></p>`,
    {
      script: `
        document.getElementById('add').addEventListener('click', () => {
          const quantity = Number(document.getElementById('quantity').value);
          shop.setCart([...shop.cart(), ...Array(quantity).fill(${JSON.stringify(product.slug)})]);
          sessionStorage.setItem('shop_added', ${JSON.stringify(product.name)});
          location.assign('/shop');
        });`,
    },
  );
});
