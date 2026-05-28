/// <reference lib="WebWorker" />
/**
 * Demo-mode service worker.
 *
 * Intercepts fetch requests that target the API routes used by the Nuxt app
 * and handles them entirely in-browser using sql.js (WASM SQLite) + Drizzle
 * ORM.  This eliminates the need for any real server in the static demo build.
 *
 * How it integrates with the app:
 *   1. The `demo-fetch.client.ts` plugin rewrites every `/api/…` call to
 *      `[demoBase]/api/…` (e.g. `/playwright-dashboard/demo/api/projects`),
 *      which falls inside the service worker's registration scope.
 *   2. This service worker intercepts those fetch events, queries the
 *      in-browser SQLite database, and returns JSON responses.
 *
 * The service worker is only registered in demo mode (controlled by the
 * @vite-pwa/nuxt module configuration in nuxt.config.ts).
 */

import { handleDemoRequest } from '../demo/api/router'
import { configureDemoDb } from '../demo/db.client'

declare const self: ServiceWorkerGlobalScope & typeof globalThis

// Derive the base URL from the service worker's own location.
// e.g. if SW is at https://host/playwright-dashboard/demo/sw.js
//   SW_DIR_URL = 'https://host/playwright-dashboard/demo/'
//   API_PREFIX  = '/playwright-dashboard/demo/api/'
const SW_DIR_URL = self.location.href.replace(/\/[^/]*$/, '/')
const API_PREFIX = new URL(SW_DIR_URL).pathname.replace(/\/+$/, '') + '/api/'

// Configure the db module to locate WASM + seed SQL relative to the SW.
configureDemoDb(SW_DIR_URL)

// ── Lifecycle ──────────────────────────────────────────────────────────────

self.addEventListener('install', () => {
  // Take control immediately so the very first navigation after registration
  // is already intercepted without a second page load.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  // Claim all open clients so existing tabs benefit from the SW right away.
  event.waitUntil(self.clients.claim())
})

// ── Fetch interception ─────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Only handle requests to the demo-scoped API prefix.
  if (!url.pathname.startsWith(API_PREFIX)) return

  // Map /playwright-dashboard/demo/api/… back to /api/…
  const apiPath = '/api/' + url.pathname.slice(API_PREFIX.length)
  const queryString = url.search ? url.search.slice(1) : undefined
  const method = event.request.method.toUpperCase() as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

  event.respondWith(
    (async () => {
      let body: unknown
      if (method !== 'GET') {
        try {
          body = await event.request.clone().json()
        } catch {
          body = undefined
        }
      }

      let result: unknown
      try {
        result = await handleDemoRequest(apiPath, method, body, queryString)
      } catch (e) {
        console.error('[Demo SW] handler error', e)
        return new Response(
          JSON.stringify({ statusCode: 500, message: 'Internal server error' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        )
      }

      if (result === undefined) {
        return new Response(
          JSON.stringify({ statusCode: 404, message: 'Not found' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        )
      }

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    })()
  )
})
