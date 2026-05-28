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

  test('package.json has seed:demo script', () => {
    const packageJsonPath = join(process.cwd(), 'package.json')
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
    expect(pkg.scripts['seed:demo']).toBeDefined()
    expect(pkg.scripts['seed:demo']).toContain('generate-demo-seed')
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

  test('nuxt.config.ts excludes sql.js from Vite optimizeDeps', () => {
    const configPath = join(process.cwd(), 'nuxt.config.ts')
    const config = readFileSync(configPath, 'utf-8')
    expect(config).toContain('sql.js')
    expect(config).toContain('optimizeDeps')
  })

  test('demo-fetch plugin uses handleDemoRequest for dynamic API handling', () => {
    const pluginPath = join(process.cwd(), 'app', 'plugins', 'demo-fetch.client.ts')
    expect(existsSync(pluginPath)).toBe(true)

    const plugin = readFileSync(pluginPath, 'utf-8')
    expect(plugin).toContain('handleDemoRequest')
  })

  test('demo seed SQL file exists', () => {
    const seedPath = join(process.cwd(), 'public', 'demo', 'seed.sql')
    expect(existsSync(seedPath), 'public/demo/seed.sql must exist').toBe(true)
  })

  test('demo seed SQL file has correct structure', () => {
    const seedPath = join(process.cwd(), 'public', 'demo', 'seed.sql')
    const seed = readFileSync(seedPath, 'utf-8')

    expect(seed).toContain('CREATE TABLE IF NOT EXISTS projects')
    expect(seed).toContain('CREATE TABLE IF NOT EXISTS test_runs')
    expect(seed).toContain('CREATE TABLE IF NOT EXISTS test_cases')
    expect(seed).toContain('INSERT INTO projects')
    expect(seed).toContain('INSERT INTO test_runs')
  })

  test('sql-wasm-browser.wasm file exists in public/demo', () => {
    const wasmPath = join(process.cwd(), 'public', 'demo', 'sql-wasm-browser.wasm')
    expect(existsSync(wasmPath), 'public/demo/sql-wasm-browser.wasm must exist').toBe(true)
  })

  test('demo db.client.ts exists', () => {
    const dbPath = join(process.cwd(), 'app', 'demo', 'db.client.ts')
    expect(existsSync(dbPath), 'app/demo/db.client.ts must exist').toBe(true)
  })

  test('demo api router exists', () => {
    const routerPath = join(process.cwd(), 'app', 'demo', 'api', 'router.ts')
    expect(existsSync(routerPath), 'app/demo/api/router.ts must exist').toBe(true)
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

    // Demo assets must be copied to the output
    expect(existsSync(join(outputDir, 'demo', 'seed.sql')), 'seed.sql missing').toBe(true)
    expect(existsSync(join(outputDir, 'demo', 'sql-wasm-browser.wasm')), 'sql-wasm-browser.wasm missing').toBe(true)
  })
})
