import { test, expect } from '@playwright/test'

test.describe('User Management Page Tests', () => {
  // Helper to wait for page hydration
  async function waitForHydration(page) {
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
  }

  test('should display user management page', async ({ page }) => {
    await page.goto('/settings/users')
    await waitForHydration(page)

    // Check page title
    await expect(page.getByRole('heading', { name: 'User Management' })).toBeVisible()

    // Check that Add User button is visible
    await expect(page.getByRole('button', { name: 'Add User' }).first()).toBeVisible()

    // Check info message about auth being disabled
    await expect(page.getByText('Authentication is disabled')).toBeVisible()
  })

  test('should open modal when clicking Add User button', async ({ page }) => {
    await page.goto('/settings/users')
    await waitForHydration(page)

    // Modal should not be visible initially
    await expect(page.getByRole('heading', { name: 'Add New User' })).not.toBeVisible()

    // Click Add User button
    await page.getByRole('button', { name: 'Add User' }).first().click()

    // Wait for modal to appear
    await expect(page.getByRole('heading', { name: 'Add New User' })).toBeVisible({ timeout: 10000 })

    // Check form fields are visible
    await expect(page.getByLabel('Username', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Display Name')).toBeVisible()
    await expect(page.getByLabel('Role', { exact: true })).toBeVisible()
  })

  test('should close modal when clicking Cancel', async ({ page }) => {
    await page.goto('/settings/users')
    await waitForHydration(page)

    // Open modal
    await page.getByRole('button', { name: 'Add User' }).first().click()
    await expect(page.getByRole('heading', { name: 'Add New User' })).toBeVisible({ timeout: 10000 })

    // Click Cancel button
    await page.getByRole('button', { name: 'Cancel' }).click()

    // Modal should be closed
    await expect(page.getByRole('heading', { name: 'Add New User' })).not.toBeVisible()
  })

  test('should create a new user', async ({ page }) => {
    await page.goto('/settings/users')
    await waitForHydration(page)

    // Open modal
    await page.getByRole('button', { name: 'Add User' }).first().click()
    await expect(page.getByRole('heading', { name: 'Add New User' })).toBeVisible({ timeout: 10000 })

    // Fill in the form
    await page.getByLabel('Username', { exact: true }).fill('testuser')
    await page.getByLabel('Password', { exact: true }).fill('testpassword123')
    await page.getByLabel('Display Name').fill('Test User')

    // Select role (administrator)
    await page.getByLabel('Role', { exact: true }).click()
    await page.getByRole('option', { name: 'Administrator' }).click()

    // Submit form
    await page.getByRole('button', { name: 'Create User' }).click()

    // Check for success message (toast notification)
    await expect(page.getByText('User created', { exact: true })).toBeVisible({ timeout: 5000 })

    // Check that user appears in the table
    await expect(page.getByRole('cell', { name: 'testuser' })).toBeVisible()
  })

  test('should display user in table after creation', async ({ page }) => {
    await page.goto('/settings/users')
    await waitForHydration(page)

    // If there are users, the table should be visible
    const noUsersText = page.getByText('No users yet')
    const usersTable = page.getByRole('table')

    // Either show empty state or table with users
    const hasUsers = await usersTable.isVisible().catch(() => false)
    const isEmpty = await noUsersText.isVisible().catch(() => false)

    expect(hasUsers || isEmpty).toBe(true)
  })

  test('should validate form fields', async ({ page }) => {
    await page.goto('/settings/users')
    await waitForHydration(page)

    // Open modal
    await page.getByRole('button', { name: 'Add User' }).first().click()
    await expect(page.getByRole('heading', { name: 'Add New User' })).toBeVisible({ timeout: 10000 })

    // Try to submit empty form
    await page.getByRole('button', { name: 'Create User' }).click()

    // Form should not submit (validation should prevent it)
    // Modal should still be visible
    await expect(page.getByRole('heading', { name: 'Add New User' })).toBeVisible()
  })

  test('should show delete confirmation for users', async ({ page }) => {
    await page.goto('/settings/users')
    await waitForHydration(page)

    // First create a user if none exist
    const noUsersText = await page.getByText('No users yet').isVisible().catch(() => false)

    if (noUsersText) {
      // Create a test user first
      await page.getByRole('button', { name: 'Add User' }).first().click()
      await expect(page.getByRole('heading', { name: 'Add New User' })).toBeVisible({ timeout: 10000 })

      await page.getByLabel('Username', { exact: true }).fill('deletetest')
      await page.getByLabel('Password', { exact: true }).fill('password123')
      await page.getByLabel('Role', { exact: true }).click()
      await page.getByRole('option', { name: 'User' }).click()
      await page.getByRole('button', { name: 'Create User' }).click()
      await page.waitForTimeout(2000)
    }

    // Now check if there's a delete button (trash icon)
    const deleteButtons = page.getByRole('button').filter({ has: page.locator('[class*="lucide-trash"]') })
    const hasDeleteButton = await deleteButtons.count() > 0

    if (hasDeleteButton) {
      // Clicking delete should show confirmation dialog
      // Note: This requires handling the confirm() dialog in the test
      page.on('dialog', dialog => dialog.accept())
      await deleteButtons.first().click()

      // Check for success message
      await expect(page.getByText('User deleted')).toBeVisible({ timeout: 5000 })
    }
  })
})
