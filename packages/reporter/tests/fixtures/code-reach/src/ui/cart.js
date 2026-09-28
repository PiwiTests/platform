import { formatPrice } from '../utils/format.js';

export function renderCart(root) {
  const p = document.createElement('p');
  p.id = 'total';
  p.textContent = `Cart ${formatPrice(4.5)}`;
  root.append(p);
}
