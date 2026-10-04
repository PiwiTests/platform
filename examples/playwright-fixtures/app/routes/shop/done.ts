import { defineEventHandler, setResponseHeader } from 'h3';
import { HTML_CONTENT_TYPE } from '../../utils/page-template';
import { shopPage } from '../../utils/shop';

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Content-Type', HTML_CONTENT_TYPE);
  return shopPage(
    'Thank you',
    `<h1 id="thanks">Thank you!</h1>
     <p id="summary"></p>
     <p><a href="/shop">Continue shopping</a></p>`,
    {
      script: `
        const order = JSON.parse(sessionStorage.getItem('shop_order') || 'null');
        if (order) {
          document.getElementById('thanks').textContent = 'Thank you, ' + order.name + '!';
          document.getElementById('summary').textContent =
            order.items + ' item(s) on their way to ' + order.city + ', ' + order.country + '.';
        }`,
    },
  );
});
