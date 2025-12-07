import type { Project } from '~/types'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  
  const project: Project = {
    id: body.id || `project-${Date.now()}`,
    name: body.name,
    description: body.description,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  
  await writeJSON(`projects/${project.id}.json`, project)
  
  return project
})
