import { defineEventHandler, setResponseHeader } from 'h3';
import { HTML_CONTENT_TYPE } from '../../utils/page-template';
import { shopPage } from '../../utils/shop';

// The order history. No test visits it yet: the dashboard names it a page the app declares and no test reaches.
export default defineEventHandler((event) => {
  setResponseHeader(event, 'Content-Type', HTML_CONTENT_TYPE);
  return shopPage(
    'Your orders',
    `<h1>Your orders</h1>
     <p id="last">No order yet.</p>`,
    {
      script: `
        const order = JSON.parse(sessionStorage.getItem('shop_order') || 'null');
        if (order) document.getElementById('last').textContent =
          'Last order: ' + order.items + ' item(s) to ' + order.name + ', ' + order.city + '.';`,
    },
  );
});
