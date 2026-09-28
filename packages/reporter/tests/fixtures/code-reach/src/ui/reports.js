import { formatPrice } from '../utils/format.js';

export function renderReports(root) {
  const p = document.createElement('p');
  p.id = 'revenue';
  p.textContent = `Revenue ${formatPrice([3, 4, 5].reduce((sum, n) => sum + n, 0))}`;
  root.append(p);
}
