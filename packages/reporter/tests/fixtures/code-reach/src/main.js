import { renderHeader } from './ui/header.js';
import { renderCart } from './ui/cart.js';
import './analytics.js';

renderHeader(document.body);
document.querySelector('#cart').addEventListener('click', () => renderCart(document.body));
document.querySelector('#reports').addEventListener('click', async () => {
  const { renderReports } = await import('./ui/reports.js');
  renderReports(document.body);
});
