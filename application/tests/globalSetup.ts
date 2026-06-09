import reporter from '../../reporter/dist/index.js'

const { createGlobalSetup } = reporter

async function cleanup() {
  try {
    const response = await fetch('http://localhost:3000/api/tests/cleanup', {
      method: 'DELETE'
    })
    if (!response.ok) {
      console.warn(`[Cleanup] Failed: ${response.status} ${await response.text()}`)
    } else {
      const result = await response.json()
      console.log(`[Cleanup] Removed ${result.projectsDeleted} test projects`)
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[Cleanup] Error: ${message}`)
  }
}

export default createGlobalSetup({
  serverUrl: 'http://localhost:3000',
  projectName: 'Piwi Dashboard',
  streaming: false
}, async () => {
  await cleanup()
})
