import { test, expect } from './shop-fixtures';

// The shop, driven through its page objects, which the fixtures give each test (see shop-fixtures.ts).
test.describe('shop', () => {
  test('signs in and lands on the products', async ({ page, loginPage, shopper }) => {
    await loginPage.goto();
    await loginPage.login(shopper.email, process.env.E2E_PASSWORD ?? 'demo-password');
    await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
    await expect(page.getByText(shopper.email)).toBeVisible();
  });

  test('adds products to the cart', async ({ page, signedIn, productsPage }) => {
    await productsPage.addToCart('Trail shoes');
    await productsPage.addToCart('Water bottle');
    await expect(page.getByRole('link', { name: 'Cart' })).toHaveText('Cart (2)');
  });

  test('places an order', async ({ page, signedIn, productsPage, checkoutPage, shopper }) => {
    await productsPage.addToCart('Rain jacket');
    await page.getByRole('link', { name: 'Cart' }).click();
    await expect(page.getByText('Total: €129.00')).toBeVisible();
    await page.getByRole('button', { name: 'Checkout' }).click();
    await checkoutPage.placeOrder(shopper);
    await expect(page.getByRole('heading', { name: `Thank you, ${shopper.name}!` })).toBeVisible();
  });
});
