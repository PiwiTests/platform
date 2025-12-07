import type { TestRun } from '~/types'

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'id')
  
  const files = await listFiles('test-runs')
  const runs: TestRun[] = []
  
  for (const file of files) {
    const run = await readJSON<TestRun>(`test-runs/${file}`)
    if (run && run.projectId === projectId) {
      runs.push(run)
    }
  }
  
  return runs.sort((a, b) => 
    new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
  )
})
