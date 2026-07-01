import { test, expect } from './fixtures';
import { PROJECT } from '#shared/test-project-names';

test.describe('Authentication Tests', () => {
  test('should work without authentication when disabled', async ({ request }) => {
    // Test that API works without auth when PIWI_AUTH_ENABLED is false
    const response = await request.get('/api/auth/me');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.authenticated).toBe(false);
    expect(data.user).toBeNull();
  });

  test('should allow project edit without auth when disabled', async ({ request }) => {
    // First create a project
    const createResponse = await request.post('/api/test-runs/submit', {
      data: {
        projectName: PROJECT.AUTH_TEST,
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 1000,
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        skippedTests: 0,
        testCases: [],
      },
    });
    expect(createResponse.ok()).toBeTruthy();

    const createData = await createResponse.json();
    const projectId = createData.projectId;

    // Try to update the project (should work when auth is disabled)
    const updateResponse = await request.put(`/api/projects/${projectId}`, {
      data: {
        label: 'Updated Label',
        description: 'Updated Description',
      },
    });
    expect(updateResponse.ok()).toBeTruthy();

    const updateData = await updateResponse.json();
    expect(updateData.label).toBe('Updated Label');
    expect(updateData.description).toBe('Updated Description');
  });

  test('should return error when trying to login with auth disabled', async ({ request }) => {
    const response = await request.post('/api/auth/login', {
      data: {
        username: 'admin',
        password: 'password',
      },
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.message).toContain('Authentication is not enabled');
  });
});
