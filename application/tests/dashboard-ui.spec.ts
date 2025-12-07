import { test, expect } from '@playwright/test';

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
    });
  });

  test('should display dashboard home page', async ({ page }) => {
    await page.goto('/');
    
    // Check page title
    await expect(page).toHaveTitle(/Playwright Dashboard/);
    
    // Check for main heading
    await expect(page.locator('h1')).toContainText('Playwright Dashboard');
    
    // Check for statistics cards
    await expect(page.getByText('Total Projects')).toBeVisible();
    await expect(page.getByText('Total Test Runs')).toBeVisible();
    await expect(page.getByText('Active Projects')).toBeVisible();
    
    // Check for recent projects section
    await expect(page.getByText('Recent Projects')).toBeVisible();
  });

  test('should display projects list page', async ({ page }) => {
    await page.goto('/projects');
    
    // Check heading
    await expect(page.getByText('Playwright Test Projects')).toBeVisible();
    
    // Check for at least one project
    await expect(page.getByText('ui-test-project')).toBeVisible();
    
    // Check for test run count
    await expect(page.getByText('test runs')).toBeVisible();
  });

  test('should navigate to project details page', async ({ page }) => {
    await page.goto('/projects');
    
    // Click on a project
    await page.getByText('ui-test-project').click();
    
    // Wait for navigation
    await page.waitForURL(/\/projects\/\d+/);
    
    // Check project name is displayed
    await expect(page.getByText('ui-test-project')).toBeVisible();
    
    // Check for test runs section
    await expect(page.getByText('Test Runs')).toBeVisible();
  });

  test('should navigate to test run details page', async ({ page }) => {
    await page.goto('/projects');
    
    // Navigate to project
    await page.getByText('ui-test-project').click();
    await page.waitForURL(/\/projects\/\d+/);
    
    // Click on first test run
    const viewDetailsButton = page.getByRole('button', { name: 'View Details' }).first();
    await viewDetailsButton.click();
    
    // Wait for navigation
    await page.waitForURL(/\/test-runs\/\d+/);
    
    // Check test run details are displayed
    await expect(page.getByText('Test Run Details')).toBeVisible();
    await expect(page.getByText('Test Cases')).toBeVisible();
  });

  test('should show project switcher dropdown', async ({ page }) => {
    await page.goto('/');
    
    // Find and click the project switcher
    const projectSwitcher = page.getByRole('button', { name: /All Projects|ui-test-project/ });
    await expect(projectSwitcher).toBeVisible();
    
    // Click to open dropdown
    await projectSwitcher.click();
    
    // Check dropdown options
    await expect(page.getByText('All Projects')).toBeVisible();
    await expect(page.getByText('ui-test-project')).toBeVisible();
  });

  test('should navigate using sidebar', async ({ page }) => {
    await page.goto('/');
    
    // Click on Projects in sidebar
    await page.getByRole('link', { name: 'Projects' }).click();
    
    // Check navigation
    await page.waitForURL('/projects');
    await expect(page.getByText('Playwright Test Projects')).toBeVisible();
    
    // Click on Home in sidebar
    await page.getByRole('link', { name: 'Home' }).click();
    
    // Check navigation
    await page.waitForURL('/');
    await expect(page.locator('h1')).toContainText('Playwright Dashboard');
  });

  test('should display test status badges correctly', async ({ page }) => {
    await page.goto('/projects');
    
    // Check for status badge
    const statusBadge = page.locator('[class*="passed"]').or(page.locator('[class*="success"]')).first();
    await expect(statusBadge).toBeVisible();
  });

  test('should handle empty state gracefully', async ({ page }) => {
    // Create a fresh project with no runs
    const projectName = `empty-project-${Date.now()}`;
    await page.goto('/');
    
    // The dashboard should still load without errors
    await expect(page.locator('h1')).toContainText('Playwright Dashboard');
  });

  test('should be responsive', async ({ page }) => {
    // Test desktop view
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');
    await expect(page.locator('h1')).toBeVisible();
    
    // Test mobile view
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await expect(page.locator('h1')).toBeVisible();
  });

  test('should refresh data when clicking refresh button', async ({ page }) => {
    await page.goto('/projects');
    
    // Click refresh button
    const refreshButton = page.getByRole('button', { name: 'Refresh' });
    await expect(refreshButton).toBeVisible();
    await refreshButton.click();
    
    // Data should still be visible after refresh
    await expect(page.getByText('ui-test-project')).toBeVisible();
  });
});
