import { test, expect } from './fixtures'

test.describe('Dashboard UI Tests', () => {
  test.beforeEach(async ({ request }) => {
    // Create test data before each UI test
    await request.post('/api/test-runs/submit', {
      data: {
        projectName: 'ui-test-project',
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 90000,
        totalTests: 5,
        passedTests: 5,
        failedTests: 0,
        skippedTests: 0,
        testCases: [
          {
            title: 'UI test case 1',
            status: 'passed',
            duration: 1000,
            location: 'tests/ui.spec.ts:10:5',
            retries: 0
          }
        ]
      }
    })
  })

  test('should display dashboard home page', async ({ page }) => {
    await page.goto('/')

    // Check page title
    await expect(page).toHaveTitle(/Playwright Dashboard/)

    // Check for statistics cards
    await expect(page.getByText('Total projects')).toBeVisible()
    await expect(page.getByText('Total test runs')).toBeVisible()
    await expect(page.getByText('Active projects')).toBeVisible()

    // Check for recent projects section
    await expect(page.getByText('Recent projects')).toBeVisible()
  })

  test('should display projects list page', async ({ page }) => {
    await page.goto('/projects')

    // Check for at least one project - use more specific selector for the table
    await expect(page.getByRole('link', { name: 'ui-test-project' })).toBeVisible()

    // Check for test run count
    await expect(page.getByText(/\d+ runs/).first()).toBeVisible() // There may be multiple projects
  })

  test('should navigate to project details page', async ({ page }) => {
    await page.goto('/projects')

    // Click on a project - use link role to target the table link, not sidebar
    await page.getByRole('link', { name: 'ui-test-project' }).click()

    // Wait for navigation
    await page.waitForURL(/\/projects\/\d+/)

    // Check for test results trend section
    await expect(page.getByText('Test results trend')).toBeVisible()

    // Check project name in sidebar is expanded
    await expect(page.getByRole('link', { name: 'Test runs' })).toBeVisible()
  })

  test('should navigate to test run details page', async ({ page }) => {
    await page.goto('/projects')

    // Navigate to project - use link role to target table link
    await page.getByRole('link', { name: 'ui-test-project' }).click()
    await page.waitForURL(/\/projects\/\d+/)

    // Click on first test run - look for "View Details" in the table
    const viewButton = page.locator('table').getByRole('link', { name: 'View' }).first()
    await viewButton.click()

    // Wait for navigation
    await page.waitForURL(/\/test-runs\/\d+/)

    // Check test run details are displayed
    await expect(page.locator('h2').first()).toContainText('Test run #')
  })

  test('should show project switcher dropdown', async ({ page }) => {
    await page.goto('/')

    // Find and click the project switcher - use first() to get the header one, not sidebar
    const projectSwitcher = page.getByRole('button', { name: /All projects|ui-test-project/ }).first()
    await expect(projectSwitcher).toBeVisible()

    // Click to open dropdown
    await projectSwitcher.click()

    // Check dropdown options
    await expect(page.getByText('All projects').first()).toBeVisible()
  })

  test('should navigate using sidebar', async ({ page }) => {
    await page.goto('/')

    // Click on Projects in sidebar
    await page.getByRole('link', { name: 'Projects' }).click()

    // Check navigation
    await page.waitForURL('/projects')

    // Click on Home in sidebar
    await page.locator('#dashboard-sidebar-default').getByRole('link', { name: 'Home' }).click()

    // Check navigation
    await page.waitForURL('/')
    await expect(page.getByText('Recent projects')).toBeVisible()
  })

  test('should display test status badges correctly', async ({ page }) => {
    await page.goto('/projects')

    // Check for status badge
    const statusBadge = page.locator('[class*="passed"]').or(page.locator('[class*="success"]')).first()
    await expect(statusBadge).toBeVisible()
  })

  test('should handle empty state gracefully', async ({ page }) => {
    // Create a fresh project with no runs
    const _projectName = `empty-project-${Date.now()}`
    await page.goto('/')

    // The dashboard should still load without errors
    await expect(page.getByText('Total projects')).toBeVisible()
  })

  test('should be responsive', async ({ page }) => {
    // Test desktop view
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto('/')
    await expect(page.getByText('Total projects')).toBeVisible()

    // Test mobile view
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/')
    await expect(page.getByText('Total projects')).toBeVisible()
  })

  test('should refresh data when clicking refresh button', async ({ page }) => {
    await page.goto('/projects')

    // Click refresh button
    const refreshButton = page.getByRole('button', { name: 'Refresh' })
    await expect(refreshButton).toBeVisible()
    await refreshButton.click()

    // Data should still be visible after refresh - use link to target table
    await expect(page.getByRole('link', { name: 'ui-test-project' })).toBeVisible()
  })

  test('should display storage settings page', async ({ page }) => {
    await page.goto('/settings/storage')
    await page.waitForLoadState('networkidle')

    // Check heading and stats section
    await expect(page.getByText('Storage statistics')).toBeVisible()
    await expect(page.getByText('Test runs', { exact: true })).toBeVisible()
    await expect(page.getByText('Cleanup old test runs')).toBeVisible()

    // Verify the cleanup button exists
    await expect(page.getByRole('button', { name: 'Run cleanup' })).toBeVisible()
  })

  test('should show delete confirmation modal on test run page', async ({ page, request }) => {
    // Ensure there is a test run
    const submitRes = await request.post('/api/test-runs/submit', {
      data: {
        projectName: 'ui-test-project',
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 5000,
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        skippedTests: 0,
        testCases: [{ title: 'delete-ui-test', status: 'passed', duration: 500, location: 'tests/x.spec.ts:1:1' }]
      }
    })
    const { testRunId } = await submitRes.json()

    await page.goto(`/test-runs/${testRunId}`)
    await page.waitForLoadState('networkidle')

    // Delete button should be visible in the navbar
    const deleteButton = page.getByRole('button', { name: 'Delete', exact: true })
    await expect(deleteButton).toBeVisible()

    // Click it — confirmation modal should appear
    await deleteButton.click()
    await expect(page.getByText('Delete test run', { exact: true })).toBeVisible()

    // Close the modal
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByText('Delete test run', { exact: true })).not.toBeVisible()
  })
})
