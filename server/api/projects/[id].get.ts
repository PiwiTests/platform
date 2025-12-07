import type { Project } from '~/types'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  
  const project = await readJSON<Project>(`projects/${id}.json`)
  
  if (!project) {
    throw createError({
      statusCode: 404,
      message: 'Project not found'
    })
  }
  
  return project
})
