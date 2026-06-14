import { test, expect } from './fixtures'
import { PROJECT } from '../shared/test-project-names'

test.describe.serial('Tags API Tests', () => {
  let createdTagId: number

  // Clean up test tags before running to ensure idempotency
  test.beforeAll(async ({ request }) => {
    const res = await request.get('/api/tags')
    const data = await res.json()
    for (const tag of (data.tags || [])) {
      if (['api-test-tag', 'api-test-tag-updated', 'duplicate-tag', 'delete-me-tag'].includes(tag.text)) {
        await request.delete(`/api/tags/${tag.id}`)
      }
    }
  })

  test('should return empty tags list initially', async ({ request }) => {
    const res = await request.get('/api/tags')
    expect(res.ok()).toBeTruthy()
    const data = await res.json()
    expect(Array.isArray(data.tags)).toBe(true)
  })

  test('should create a new tag', async ({ request }) => {
    const res = await request.post('/api/tags', {
      data: { text: 'api-test-tag', color: '#3b82f6' }
    })
    expect(res.ok()).toBeTruthy()
    const data = await res.json()
    expect(data.tag).toBeDefined()
    expect(data.tag.text).toBe('api-test-tag')
    expect(data.tag.color).toBe('#3b82f6')
    expect(data.tag.id).toBeDefined()
    createdTagId = data.tag.id
  })

  test('should list created tag', async ({ request }) => {
    const res = await request.get('/api/tags')
    expect(res.ok()).toBeTruthy()
    const data = await res.json()
    const tag = data.tags.find((t: { text: string }) => t.text === 'api-test-tag')
    expect(tag).toBeDefined()
    expect(tag.color).toBe('#3b82f6')
  })

  test('should reject duplicate tag text', async ({ request }) => {
    const res = await request.post('/api/tags', {
      data: { text: 'api-test-tag', color: '#ef4444' }
    })
    expect(res.ok()).toBeFalsy()
    expect(res.status()).toBe(400)
  })

  test('should reject missing tag text', async ({ request }) => {
    const res = await request.post('/api/tags', {
      data: { color: '#3b82f6' }
    })
    expect(res.ok()).toBeFalsy()
    expect(res.status()).toBe(400)
  })

  test('should reject missing color', async ({ request }) => {
    const res = await request.post('/api/tags', {
      data: { text: 'no-color-tag' }
    })
    expect(res.ok()).toBeFalsy()
    expect(res.status()).toBe(400)
  })

  test('should update a tag', async ({ request }) => {
    const res = await request.put(`/api/tags/${createdTagId}`, {
      data: { text: 'api-test-tag-updated', color: '#10b981' }
    })
    expect(res.ok()).toBeTruthy()
    const data = await res.json()
    expect(data.tag.text).toBe('api-test-tag-updated')
    expect(data.tag.color).toBe('#10b981')
  })

  test('should return 404 for unknown tag update', async ({ request }) => {
    const res = await request.put('/api/tags/99999', {
      data: { text: 'ghost', color: '#000000' }
    })
    expect(res.status()).toBe(404)
  })

  test('should delete a tag', async ({ request }) => {
    const deleteTagName = 'delete-me-tag'

    // Create a dedicated delete target
    const createRes = await request.post('/api/tags', {
      data: { text: deleteTagName, color: '#f59e0b' }
    })
    expect(createRes.ok()).toBeTruthy()
    const { tag } = await createRes.json()

    const deleteRes = await request.delete(`/api/tags/${tag.id}`)
    expect(deleteRes.ok()).toBeTruthy()

    // Should be gone from list
    const listRes = await request.get('/api/tags')
    expect(listRes.ok()).toBeTruthy()
    const listData = await listRes.json()
    const found = listData.tags.find((t: { text: string }) => t.text === deleteTagName)
    expect(found).toBeUndefined()
  })

  test('should return 404 for unknown tag delete', async ({ request }) => {
    const res = await request.delete('/api/tags/99999')
    expect(res.status()).toBe(404)
  })
})

test.describe.serial('Tags assigned to projects', () => {
  let projectId: number
  let tagId: number

  test.beforeAll(async ({ request }) => {
    // Create a project via test-run submit
    const runRes = await request.post('/api/test-runs/submit', {
      data: {
        projectName: PROJECT.TAG_ASSIGNMENT,
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 10000,
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        skippedTests: 0,
        testCases: [{ title: 'sample', status: 'passed', duration: 500, location: 't.spec.ts:1:1' }]
      }
    })
    const runData = await runRes.json()
    projectId = runData.projectId

    // Clean up existing tags with these names
    const tagsRes = await request.get('/api/tags')
    const tagsData = await tagsRes.json()
    for (const tag of (tagsData.tags || [])) {
      if (['assign-tag-a', 'assign-tag-b'].includes(tag.text)) {
        await request.delete(`/api/tags/${tag.id}`)
      }
    }

    // Create a tag
    const tagRes = await request.post('/api/tags', {
      data: { text: 'assign-tag-a', color: '#8b5cf6' }
    })
    const tagData = await tagRes.json()
    tagId = tagData.tag.id
  })

  test('should assign a tag to a project', async ({ request }) => {
    const res = await request.put(`/api/projects/${projectId}`, {
      data: { tagIds: [tagId] }
    })
    expect(res.ok()).toBeTruthy()
    const data = await res.json()
    expect(data.tags).toBeDefined()
    expect(data.tags.some((t: { id: number }) => t.id === tagId)).toBe(true)
  })

  test('should include tags in project list', async ({ request }) => {
    const res = await request.get('/api/projects')
    expect(res.ok()).toBeTruthy()
    const projects = await res.json()
    const project = projects.find((p: { id: number }) => p.id === projectId)
    expect(project).toBeDefined()
    expect(project.tags).toBeDefined()
    expect(project.tags.some((t: { id: number }) => t.id === tagId)).toBe(true)
  })

  test('should include tags in project detail', async ({ request }) => {
    const res = await request.get(`/api/projects/${projectId}`)
    expect(res.ok()).toBeTruthy()
    const data = await res.json()
    expect(data.tags).toBeDefined()
    expect(data.tags.some((t: { id: number }) => t.id === tagId)).toBe(true)
  })

  test('should remove all tags from a project', async ({ request }) => {
    const res = await request.put(`/api/projects/${projectId}`, {
      data: { tagIds: [] }
    })
    expect(res.ok()).toBeTruthy()
    const data = await res.json()
    expect(data.tags).toHaveLength(0)
  })

  test('should cascade delete tag from project when tag is deleted', async ({ request }) => {
    // Create a second tag and assign it
    const tagRes = await request.post('/api/tags', {
      data: { text: 'assign-tag-b', color: '#ec4899' }
    })
    const { tag } = await tagRes.json()

    await request.put(`/api/projects/${projectId}`, {
      data: { tagIds: [tag.id] }
    })

    // Delete the tag
    await request.delete(`/api/tags/${tag.id}`)

    // Project should no longer have the tag
    const projectRes = await request.get(`/api/projects/${projectId}`)
    const projectData = await projectRes.json()
    const stillHasTag = projectData.tags.some((t: { id: number }) => t.id === tag.id)
    expect(stillHasTag).toBe(false)
  })
})
