import { test, expect } from './fixtures'
import { waitForHydration, retryPost } from './utils'
import { PROJECT } from '../shared/test-project-names'

test.describe('Dashboard UI Tests', () => {
  test.setTimeout(90000)

  test.beforeEach(async ({ request }) => {
    // Create test data before each UI test
    await retryPost(request, '/api/test-runs/submit', {
      data: {
        projectName: PROJECT.UI_TEST,
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
      },
      timeout: 20000
    })
  })

  test('should display dashboard home page', async ({ page }) => {
    await page.goto('/')

    // Check page title
    await expect(page).toHaveTitle(/Piwi Dashboard/)

    // Check for statistics cards
    await expect(page.getByText('Total projects')).toBeVisible()
    await expect(page.getByText('Total test runs')).toBeVisible()
    await expect(page.getByText('Active projects')).toBeVisible()

    // Check for projects section
    await expect(page.getByText('Project health')).toBeVisible()
  })

  test('should display projects list page', async ({ page }) => {
    await page.goto('/projects')

    // Check for at least one project - use more specific selector for the table
    await expect(page.getByRole('link', { name: PROJECT.UI_TEST })).toBeVisible()

    // Check for test run count
    await expect(page.getByText(/\d+ runs/).first()).toBeVisible() // There may be multiple projects
  })

  test('should navigate to project details page', async ({ page }) => {
    await page.goto('/projects')

    // Click on a project - use link role to target the table link, not sidebar
    await page.getByRole('link', { name: PROJECT.UI_TEST }).click()

    await page.waitForURL(/\/projects\/\d+/)

    // Wait for main content to confirm page loaded
    await expect(page.getByText('Test run statistics over time')).toBeVisible({ timeout: 30000 })

    // Sidebar accordion remounts on navigation (keyed by currentProjectId), so
    // defaultOpen:true takes effect and 'Test runs' should be visible promptly.
    await expect(page.getByRole('link', { name: 'Test runs' })).toBeVisible({ timeout: 15000 })
  })

  test('should navigate to test run details page', async ({ page }) => {
    await page.goto('/projects')

    // Navigate to project - use link role to target table link
    await page.getByRole('link', { name: PROJECT.UI_TEST }).click()
    await page.waitForURL(/\/projects\/\d+/)
    await waitForHydration(page)

    // Click on first test run - wait for table to be interactive before clicking
    const viewButton = page.locator('table').getByRole('link', { name: 'View' }).first()
    await expect(viewButton).toBeVisible({ timeout: 10000 })
    await viewButton.click()

    // Wait for navigation
    await page.waitForURL(/\/test-runs\/\d+/)

    // Check test run details are displayed
    await expect(page.locator('h2').first()).toContainText('Test run #')
  })

  test('should switch between tabs on test run detail page', async ({ page }) => {
    await page.goto('/projects')
    await page.getByRole('link', { name: PROJECT.UI_TEST }).click()
    await page.waitForURL(/\/projects\/\d+/)
    await waitForHydration(page)
    const viewButton = page.locator('table').getByRole('link', { name: 'View' }).first()
    await expect(viewButton).toBeVisible({ timeout: 10000 })
    await viewButton.click()
    await page.waitForURL(/\/test-runs\/\d+/)
    await waitForHydration(page)

    await expect(page.getByRole('columnheader', { name: 'Test case' }).first()).toBeVisible()

    await page.getByRole('tab', { name: /^Timeline/ }).click()
    await page.getByRole('tab', { name: 'Compare' }).click()
    await expect(page.getByText('Run A (baseline)')).toBeVisible({ timeout: 15000 })
    await page.getByRole('tab', { name: 'Slow endpoints' }).click()
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
    await expect(page.getByText('Project health')).toBeVisible()
  })

  test('should display test status badges correctly', async ({ page }) => {
    await page.goto('/projects')

    // Check for status badge
    const statusBadge = page.locator('[class*="passed"]').or(page.locator('[class*="success"]')).first()
    await expect(statusBadge).toBeVisible()
  })

  test('should handle empty state gracefully', async ({ page }) => {
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
    await expect(page.getByRole('link', { name: PROJECT.UI_TEST })).toBeVisible()
  })

  test('should display storage settings page', async ({ page }) => {
    await page.goto('/settings/storage')
    await waitForHydration(page)

    // Check heading and stats section
    await expect(page.getByText('Storage statistics')).toBeVisible()
    await expect(page.getByText('Test runs', { exact: true })).toBeVisible()
    await expect(page.getByText('Cleanup old test runs')).toBeVisible()

    // Verify the cleanup button exists
    await expect(page.getByRole('button', { name: 'Run cleanup' })).toBeVisible()
  })

  test('should show delete confirmation modal on test run page', async ({ page, request }) => {
    // Ensure there is a test run
    const submitRes = await retryPost(request, '/api/test-runs/submit', {
      data: {
        projectName: PROJECT.UI_TEST,
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
    await waitForHydration(page)

    // Delete button should be visible in the navbar
    const deleteButton = page.getByRole('button', { name: 'Delete', exact: true })
    await expect(deleteButton).toBeVisible()

    // Click it — confirmation modal should appear
    await deleteButton.click()
    await expect(page.getByText('Delete test run', { exact: true })).toBeVisible({ timeout: 10000 })

    // Close the modal
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByText('Delete test run', { exact: true })).not.toBeVisible()
  })

  test('metadata blocks remain on the same row when all are displayed', async ({ page, request }) => {
    // Submit a run with CI, SCM, tags and environment so all 4 metadata blocks render
    const submitRes = await retryPost(request, '/api/test-runs/submit', {
      data: {
        projectName: PROJECT.BLOCK_LAYOUT,
        status: 'failed',
        startTime: new Date().toISOString(),
        duration: 60000,
        totalTests: 2,
        passedTests: 0,
        failedTests: 2,
        skippedTests: 0,
        environment: 'staging',
        testCases: [
          { title: 'block-layout-test-a', status: 'failed', duration: 1000, location: 'tests/a.spec.ts:1:1', error: 'Error: failure' },
          { title: 'block-layout-test-b', status: 'passed', duration: 500, location: 'tests/b.spec.ts:1:1' }
        ],
        metadata: {
          ci: { provider: 'GitHub Actions', buildNumber: '42' },
          scm: { commit: 'abc123def456', branch: 'main', author: 'test' },
          tags: ['smoke', 'regression'],
          projectDescription: 'Block layout verification'
        }
      }
    })
    const { testRunId } = await submitRes.json()

    await page.goto(`/test-runs/${testRunId}`)
    await waitForHydration(page)

    // Wait for the RunSummary grid to render
    const runSummary = page.locator('[class*="grid"][class*="lg:grid-cols-12"]').first()
    await expect(runSummary).toBeVisible()

    // Get the metadata block cards (direct children of the grid with col-span classes)
    const blocks = runSummary.locator('> [class*="lg:col-span"]')
    const blockCount = await blocks.count()

    // Should have at least 3 blocks (CI, SCM, Tags/Other) — storage may not show
    expect(blockCount).toBeGreaterThanOrEqual(3)

    // All visible blocks should share the same Y position (same row at lg breakpoint)
    const positions = await blocks.evaluateAll((els) => {
      return els.map((el) => {
        const rect = el.getBoundingClientRect()
        return { y: rect.top, height: rect.height }
      })
    })

    // Group by row (any blocks whose top edge is within 5px of each other)
    const rows = new Map<number, number>()
    for (const p of positions) {
      const key = Math.round(p.y / 5) * 5
      rows.set(key, (rows.get(key) || 0) + 1)
    }

    // All metadata blocks should be in a single row (not wrapped)
    expect(rows.size).toBe(1)
  })
})
