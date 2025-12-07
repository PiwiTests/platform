import fs from 'fs/promises'
import path from 'path'

const DATA_DIR = path.join(process.cwd(), 'data')

// Validate path to prevent directory traversal
function validatePath(filePath: string): string {
  const fullPath = path.resolve(path.join(DATA_DIR, filePath))
  if (!fullPath.startsWith(DATA_DIR)) {
    throw new Error('Invalid file path')
  }
  return fullPath
}

// Simple JSON file storage
export async function readJSON<T>(filePath: string): Promise<T | null> {
  try {
    const fullPath = validatePath(filePath)
    const data = await fs.readFile(fullPath, 'utf-8')
    return JSON.parse(data)
  } catch (error) {
    return null
  }
}

export async function writeJSON<T>(filePath: string, data: T): Promise<void> {
  const fullPath = validatePath(filePath)
  await fs.mkdir(path.dirname(fullPath), { recursive: true })
  await fs.writeFile(fullPath, JSON.stringify(data, null, 2))
}

export async function listFiles(dirPath: string): Promise<string[]> {
  try {
    const fullPath = validatePath(dirPath)
    const files = await fs.readdir(fullPath)
    return files.filter(f => f.endsWith('.json'))
  } catch (error) {
    return []
  }
}

export async function deleteFile(filePath: string): Promise<void> {
  const fullPath = validatePath(filePath)
  await fs.unlink(fullPath)
}
