import type { Project } from '~/types'

export default defineEventHandler(async () => {
  const files = await listFiles('projects')
  const projects: Project[] = []
  
  for (const file of files) {
    const project = await readJSON<Project>(`projects/${file}`)
    if (project) projects.push(project)
  }
  
  return projects.sort((a, b) => 
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )
})
