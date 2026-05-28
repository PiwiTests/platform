/**
 * Integration tests for the demo static site generation (`npm run generate:demo`).
 *
 * Runs `npm run generate:demo` end-to-end and verifies that:
 *   - The build completes without prerender errors (important on Windows, where
 *     @nuxt/nitro-server can produce file:// URLs that Rollup cannot resolve).
 *   - All expected static assets (HTML, seed data, WASM, service worker) are
 *     present in the output directory.
 */
import { test, expect } from '@playwright/test'
import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

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

    // Service worker must be present in the output
    expect(existsSync(join(outputDir, 'sw.js')), 'sw.js (demo service worker) missing').toBe(true)
  })
})
