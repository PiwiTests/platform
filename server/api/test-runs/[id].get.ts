import type { TestRun } from '~/types'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  
  const testRun = await readJSON<TestRun>(`test-runs/${id}.json`)
  
  if (!testRun) {
    throw createError({
      statusCode: 404,
      message: 'Test run not found'
    })
  }
  
  return testRun
})
