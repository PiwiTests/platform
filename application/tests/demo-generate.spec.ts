/**
 * Tests for the demo static site generation (`npm run generate:demo`).
 *
 * These tests verify that the Windows prerender fix is in place: on Windows,
 * @nuxt/nitro-server registers the prerender cache storage driver using a
 * `file:///C:/...` URL that Rollup cannot resolve, causing every prerendered
 * route to return 500. The fix (using the built-in `memory` driver for the
 * `internal:nuxt:prerender` storage key) must be present in nuxt.config.ts.
 *
 * The integration test also runs `npm run generate:demo` end-to-end to ensure
 * the static site is generated without any prerender errors on CI (Linux), which
 * exercises the same code path as Windows.
 */
import { test, expect } from '@playwright/test'
import { execSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

// ----------------------------------------------------------------------------
// Config-level check: verifies the fix is present without running a full build
// ----------------------------------------------------------------------------

test.describe('Demo generate configuration', () => {
  test('generate:demo script uses cross-env for cross-platform env variable support', () => {
    const packageJsonPath = join(process.cwd(), 'package.json')
    expect(existsSync(packageJsonPath)).toBe(true)

    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))

    // On Windows, `KEY=value cmd` syntax does not work; cross-env is required
    // so that NUXT_PUBLIC_DEMO_MODE is correctly passed on all platforms.
    // Without cross-env, isDemo stays false on Windows and every prerendered
    // route returns 500 because the SSR server tries to access the database.
    expect(pkg.scripts['generate:demo']).toContain('cross-env')
    expect(pkg.scripts['generate:demo']).toContain('NUXT_PUBLIC_DEMO_MODE=true')
    expect(pkg.devDependencies['cross-env']).toBeDefined()
  })

  test('nuxt.config.ts uses memory storage driver for demo prerender cache', () => {
    const configPath = join(process.cwd(), 'nuxt.config.ts')
    expect(existsSync(configPath)).toBe(true)

    const config = readFileSync(configPath, 'utf-8')

    // The memory driver override must be present to avoid the Windows
    // file:// URL resolution failure in @nuxt/nitro-server.
    expect(config).toContain('\'internal:nuxt:prerender\'')
    expect(config).toContain('driver: \'memory\'')
  })

  test('nuxt.config.ts disables buildCache in demo mode', () => {
    const configPath = join(process.cwd(), 'nuxt.config.ts')
    const config = readFileSync(configPath, 'utf-8')

    // buildCache must be disabled in demo mode to prevent Rollup from looking
    // for a stale client.precomputed.mjs from a previous SSR build cache.
    expect(config).toContain('buildCache: !isDemo')
  })

  test('demo-fetch plugin maps /api/tags and /api/admin/stats to fixture files', () => {
    const pluginPath = join(process.cwd(), 'app', 'plugins', 'demo-fetch.client.ts')
    expect(existsSync(pluginPath)).toBe(true)

    const plugin = readFileSync(pluginPath, 'utf-8')
    expect(plugin).toContain('\'/api/tags\'')
    expect(plugin).toContain('\'/api/admin/stats\'')
    expect(plugin).toContain('\'/api/projects/1/quality\'')
    expect(plugin).toContain('\'/api/projects/1/flaky-tests\'')
  })

  test('demo fixture files exist for all mapped API endpoints', () => {
    const publicDir = join(process.cwd(), 'public')

    const expectedFixtures = [
      'demo/api/projects.json',
      'demo/api/projects/1.json',
      'demo/api/projects/1/test-cases.json',
      'demo/api/projects/1/performance.json',
      'demo/api/projects/1/slow-tests.json',
      'demo/api/projects/1/quality.json',
      'demo/api/projects/1/flaky-tests.json',
      'demo/api/tags.json',
      'demo/api/admin/stats.json',
      'demo/api/test-runs/1.json',
      'demo/api/test-runs/1/network-requests.json',
      'demo/api/test-cases/1.json',
      'demo/api/auth/session.json'
    ]

    for (const fixture of expectedFixtures) {
      const fullPath = join(publicDir, fixture)
      expect(existsSync(fullPath), `Missing fixture: ${fixture}`).toBe(true)
    }
  })

  test('demo fixture /api/tags.json has correct shape', () => {
    const fixturePath = join(process.cwd(), 'public', 'demo', 'api', 'tags.json')
    expect(existsSync(fixturePath)).toBe(true)

    const data = JSON.parse(readFileSync(fixturePath, 'utf-8'))
    expect(data).toHaveProperty('tags')
    expect(Array.isArray(data.tags)).toBe(true)

    if (data.tags.length > 0) {
      const tag = data.tags[0]
      expect(tag).toHaveProperty('id')
      expect(tag).toHaveProperty('text')
      expect(tag).toHaveProperty('color')
    }
  })

  test('demo fixture /api/admin/stats.json has correct shape', () => {
    const fixturePath = join(process.cwd(), 'public', 'demo', 'api', 'admin', 'stats.json')
    expect(existsSync(fixturePath)).toBe(true)

    const data = JSON.parse(readFileSync(fixturePath, 'utf-8'))
    expect(data).toHaveProperty('totalProjects')
    expect(data).toHaveProperty('totalRuns')
    expect(data).toHaveProperty('totalTestCases')
  })
})

// ----------------------------------------------------------------------------
// Integration test: actually runs `npm run generate:demo`
// ----------------------------------------------------------------------------

test.describe('Demo static site generation', () => {
  // Building the demo takes 1-3 minutes; allow 5 minutes to be safe.
  test.setTimeout(300_000)

  test('npm run generate:demo completes without prerender errors', () => {
    let output = ''
    try {
      output = execSync('npm run generate:demo', {
        cwd: process.cwd(),
        encoding: 'utf-8',
        // Capture both stdout and stderr so we can assert on the full output.
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (error: unknown) {
      const err = error as { stdout?: string, stderr?: string, message?: string }
      const combined = [err.stdout, err.stderr, err.message].filter(Boolean).join('\n')
      throw new Error(`npm run generate:demo failed:\n${combined}`)
    }

    // Nitro prints "[500]" next to any route that fails prerendering.
    expect(output).not.toContain('[500]')

    // The Windows cache-driver warning is the root cause of the 500 errors.
    expect(output).not.toContain('could not be resolved')

    // Successful prerendering ends with this message.
    expect(output).toContain('Generated public')
  })

  test('demo output directory contains expected static files', () => {
    const outputDir = join(process.cwd(), '.output', 'public')

    expect(existsSync(outputDir), '.output/public directory must exist after generate').toBe(true)

    // SPA entry point
    expect(existsSync(join(outputDir, 'index.html')), 'index.html missing').toBe(true)

    // SPA catch-all fallback (serves the app for any unmatched route)
    expect(existsSync(join(outputDir, '200.html')), '200.html missing').toBe(true)

    // Custom 404 page
    expect(existsSync(join(outputDir, '404.html')), '404.html missing').toBe(true)

    // Demo fixtures must be copied to the output as static assets
    expect(existsSync(join(outputDir, 'demo', 'api', 'projects.json')), 'projects.json fixture missing').toBe(true)
    expect(existsSync(join(outputDir, 'demo', 'api', 'tags.json')), 'tags.json fixture missing').toBe(true)
    expect(existsSync(join(outputDir, 'demo', 'api', 'admin', 'stats.json')), 'admin/stats.json fixture missing').toBe(true)
  })
})
