import { test, expect } from '@playwright/test';

test.describe('API Server Tests', () => {
  let projectId: number;
  let testRunId: number;

  test('should submit test results via JSON API', async ({ request }) => {
    const response = await request.post('/api/test-runs/submit', {
      data: {
        projectName: 'test-api-project',
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 120000,
        totalTests: 10,
        passedTests: 9,
        failedTests: 1,
        skippedTests: 0,
        testCases: [
          {
            title: 'should login successfully',
            status: 'passed',
            duration: 1500,
            location: 'tests/login.spec.ts:10:5',
            retries: 0
          },
          {
            title: 'should handle errors',
            status: 'failed',
            duration: 2300,
            location: 'tests/errors.spec.ts:5:5',
            error: 'Expected true but got false',
            retries: 1
          }
        ]
      }
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.testRunId).toBeDefined();
    expect(data.projectId).toBeDefined();
    
    projectId = data.projectId;
    testRunId = data.testRunId;
  });

  test('should get list of projects', async ({ request }) => {
    const response = await request.get('/api/projects');
    
    expect(response.ok()).toBeTruthy();
    const projects = await response.json();
    expect(Array.isArray(projects)).toBe(true);
    expect(projects.length).toBeGreaterThan(0);
    
    const project = projects.find((p: any) => p.name === 'test-api-project');
    expect(project).toBeDefined();
    expect(project.totalRuns).toBeGreaterThan(0);
  });

  test('should get project details', async ({ request }) => {
    // First, get the project list to find our project
    const projectsResponse = await request.get('/api/projects');
    const projects = await projectsResponse.json();
    const project = projects.find((p: any) => p.name === 'test-api-project');
    
    expect(project).toBeDefined();
    
    // Now get project details
    const response = await request.get(`/api/projects/${project.id}`);
    expect(response.ok()).toBeTruthy();
    
    const projectDetails = await response.json();
    expect(projectDetails.name).toBe('test-api-project');
    expect(projectDetails.testRuns).toBeDefined();
    expect(Array.isArray(projectDetails.testRuns)).toBe(true);
  });

  test('should get test run details', async ({ request }) => {
    // First, get the project list to find our test run
    const projectsResponse = await request.get('/api/projects');
    const projects = await projectsResponse.json();
    const project = projects.find((p: any) => p.name === 'test-api-project');
    
    const projectDetailsResponse = await request.get(`/api/projects/${project.id}`);
    const projectDetails = await projectDetailsResponse.json();
    const testRun = projectDetails.testRuns[0];
    
    expect(testRun).toBeDefined();
    
    // Now get test run details
    const response = await request.get(`/api/test-runs/${testRun.id}`);
    expect(response.ok()).toBeTruthy();
    
    const testRunDetails = await response.json();
    expect(testRunDetails.id).toBe(testRun.id);
    expect(testRunDetails.status).toBeDefined();
    expect(testRunDetails.testCases).toBeDefined();
    expect(Array.isArray(testRunDetails.testCases)).toBe(true);
    expect(testRunDetails.testCases.length).toBe(2);
  });

  test('should get test case details', async ({ request }) => {
    // Get test run to find test cases
    const projectsResponse = await request.get('/api/projects');
    const projects = await projectsResponse.json();
    const project = projects.find((p: any) => p.name === 'test-api-project');
    
    const projectDetailsResponse = await request.get(`/api/projects/${project.id}`);
    const projectDetails = await projectDetailsResponse.json();
    const testRun = projectDetails.testRuns[0];
    
    const testRunDetailsResponse = await request.get(`/api/test-runs/${testRun.id}`);
    const testRunDetails = await testRunDetailsResponse.json();
    const testCase = testRunDetails.testCases[0];
    
    expect(testCase).toBeDefined();
    
    // Now get test case details
    const response = await request.get(`/api/test-cases/${testCase.id}`);
    expect(response.ok()).toBeTruthy();
    
    const testCaseDetails = await response.json();
    expect(testCaseDetails.id).toBe(testCase.id);
    expect(testCaseDetails.title).toBeDefined();
    expect(testCaseDetails.status).toBeDefined();
  });

  test('should handle invalid project ID gracefully', async ({ request }) => {
    const response = await request.get('/api/projects/99999');
    expect(response.status()).toBe(404);
  });

  test('should handle invalid test run ID gracefully', async ({ request }) => {
    const response = await request.get('/api/test-runs/99999');
    expect(response.status()).toBe(404);
  });

  test('should handle invalid test case ID gracefully', async ({ request }) => {
    const response = await request.get('/api/test-cases/99999');
    expect(response.status()).toBe(404);
  });

  test('should reject malformed JSON in submit endpoint', async ({ request }) => {
    const response = await request.post('/api/test-runs/submit', {
      data: {
        projectName: 'test-project'
        // Missing required fields
      }
    });
    
    expect(response.ok()).toBeFalsy();
  });
});
