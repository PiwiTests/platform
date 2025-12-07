# Copilot Instructions for Playwright Dashboard

## Project Overview

This is a Playwright Dashboard built with Nuxt 3 that stores and displays test results. The application is intentionally kept simple to facilitate easy modifications by AI agents.

## Architecture

### Tech Stack
- **Framework**: Nuxt 3 (Vue.js)
- **UI Library**: Nuxt UI (based on Tailwind CSS)
- **Storage**: Simple JSON files (no database)
- **Language**: TypeScript

### Directory Structure

```
playwright-dashboard/
├── app/
│   ├── pages/          # Vue pages (routes)
│   └── app.vue         # Root component
├── server/
│   ├── api/            # API endpoints
│   └── utils/          # Server utilities (storage.ts)
├── types/              # TypeScript type definitions
├── data/               # JSON data storage
│   ├── projects/       # Project files
│   ├── test-runs/      # Test run files
│   └── traces/         # Trace files (future)
└── public/             # Static assets
```

## Data Models

All data models are defined in `types/index.ts`:

- **Project**: Represents a test project
- **TestRun**: Represents a test execution
- **TestCase**: Individual test case information
- **TestResult**: Result of a single test
- **Trace**: Test trace information

## Storage Layer

The storage layer (`server/utils/storage.ts`) provides simple functions:
- `readJSON<T>(path)`: Read a JSON file
- `writeJSON<T>(path, data)`: Write a JSON file
- `listFiles(dir)`: List files in a directory
- `deleteFile(path)`: Delete a file

All data is stored in the `data/` directory as JSON files.

## API Design

API routes follow RESTful conventions and are located in `server/api/`:

### Projects
- GET `/api/projects` - List all projects
- POST `/api/projects` - Create project
- GET `/api/projects/:id` - Get project
- GET `/api/projects/:id/runs` - Get project's test runs

### Test Runs
- POST `/api/test-runs` - Create test run
- GET `/api/test-runs/:id` - Get test run

## UI Pages

- `/` - Home page with project list
- `/projects/:id` - Project detail page with test runs

## Development Guidelines

### When Adding Features

1. **Keep it Simple**: Avoid over-engineering. Use simple solutions.
2. **Follow Existing Patterns**: Look at existing API routes and pages as templates.
3. **Type Everything**: Always use TypeScript types from `types/index.ts`.
4. **Use Nuxt UI Components**: Leverage UButton, UCard, UModal, etc.
5. **No External Database**: Continue using JSON files for storage.

### When Modifying Code

1. **Minimal Changes**: Make the smallest change necessary.
2. **Don't Break Existing APIs**: Maintain backward compatibility.
3. **Update Types**: If data structures change, update `types/index.ts`.
4. **Test Locally**: Run `npm run dev` to verify changes.

### Common Tasks

#### Adding a New API Endpoint

1. Create a file in `server/api/` (e.g., `server/api/my-endpoint.get.ts`)
2. Use the storage utilities from `server/utils/storage.ts` (auto-imported, no explicit import needed)
3. Import types from `~/types`
4. Export a `defineEventHandler` function

**Important**: Server utilities in `server/utils/` are auto-imported by Nuxt. Do NOT explicitly import them - just use them directly.

Example:
```typescript
import type { MyType } from '~/types'

export default defineEventHandler(async (event) => {
  // readJSON, writeJSON, listFiles, deleteFile are auto-imported from server/utils/storage.ts
  const data = await readJSON<MyType>('path/to/file.json')
  return data
})
```

#### Adding a New Page

1. Create a `.vue` file in `app/pages/`
2. Use Nuxt UI components for consistency
3. Use `useFetch` for API calls
4. Use TypeScript for all script code

Example:
```vue
<script setup lang="ts">
import type { MyType } from '~/types'

const { data } = await useFetch<MyType[]>('/api/my-endpoint')
</script>

<template>
  <div>{{ data }}</div>
</template>
```

#### Adding a New Data Model

1. Add the interface to `types/index.ts`
2. Export it so it can be imported elsewhere
3. Use descriptive field names

## File Conventions

- API routes: `server/api/path/[param].method.ts`
- Pages: `app/pages/path/[param].vue`
- Types: `types/index.ts` (single file for simplicity)
- Utilities: `server/utils/name.ts`

## Dependencies

Keep dependencies minimal. Current dependencies:
- `nuxt`: Core framework
- `@nuxt/ui`: UI components
- `@nuxt/icon`: Icon support

Only add new dependencies if absolutely necessary.

## Testing Strategy

For now, manual testing is sufficient:
1. Run `npm run dev`
2. Test in browser
3. Verify API calls in browser DevTools

## Future Enhancements

When adding these features, maintain the simple architecture:
- Trace viewer integration
- Report file uploads
- Test case management
- Search and filtering
- Dashboard statistics

## Common Issues

### Build Errors
- Check that all imports have proper extensions or use aliases
- Verify TypeScript types are correctly defined
- Ensure all dependencies are installed

### API Not Working
- Check file paths in storage operations
- Verify JSON file format
- Check that directories exist in `data/`

### Page Not Loading
- Verify the route file is in correct location
- Check for TypeScript errors in script section
- Ensure API endpoints return expected data

## Best Practices

1. **Use Composables**: Leverage Nuxt 3 composables like `useFetch`, `useRoute`, etc.
2. **Auto-imports**: Nuxt auto-imports components and composables - don't manually import them
3. **Server-side Types**: Share types between client and server using `~/types`
4. **Error Handling**: Use `createError` in API routes for proper error responses
5. **Loading States**: Always show loading/pending states in UI

## Quick Reference

### Creating a Project via API
```bash
curl -X POST http://localhost:3000/api/projects \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Project", "description": "My description"}'
```

### Submitting a Test Run
```bash
curl -X POST http://localhost:3000/api/test-runs \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "project-123",
    "status": "passed",
    "totalTests": 10,
    "passed": 9,
    "failed": 1,
    "skipped": 0,
    "flaky": 0
  }'
```

## Notes for AI Agents

- This codebase is designed to be simple and straightforward
- Don't add complexity unless specifically requested
- Follow the existing patterns rather than introducing new paradigms
- Keep the JSON file storage approach - it's intentionally simple
- Maintain TypeScript typing for all new code
- Use Nuxt UI components for consistency
