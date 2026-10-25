// MusicWeb Service Worker — PWA shell and eligible audio response caching.
// Background playback and page lifetime are managed by the browser and OS.

const SHELL_CACHE_NAME = 'musicweb-shell-v3'
const AUDIO_CACHE_NAME = 'musicweb-audio-v2'
const MAX_CACHED_AUDIO = 30 // max number of audio responses to cache

const PRECACHE_SHELL_ASSETS = [
  '/',
  '/manifest.json',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/favicon.ico',
  '/phong-signature.png',
]

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(
    caches
      .open(SHELL_CACHE_NAME)
      .then((cache) =>
        Promise.allSettled(
          PRECACHE_SHELL_ASSETS.map((assetUrl) => cache.add(assetUrl))
        )
      )
      .catch(() => {})
  )
})

self.addEventListener('activate', (event) => {
  const validCaches = new Set([SHELL_CACHE_NAME, AUDIO_CACHE_NAME])
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Clean up old caches
      caches.keys().then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith('musicweb-') && !validCaches.has(name))
            .map((name) => caches.delete(name))
        )
      ),
    ])
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return

  const url = new URL(event.request.url)

  // 1. Intercept audio stream requests from our own API
  if (url.pathname === '/api/drive-stream') {
    event.respondWith(handleAudioFetch(event.request))
    return
  }

  // Skip other API routes or cross-origin dynamic streams
  if (url.pathname.startsWith('/api/')) {
    return
  }

  // 2. For navigation requests (iOS Home Screen launch & route changes):
  //    Network-first with automatic shell cache update and offline fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(handleNavigateFetch(event.request))
    return
  }

  // 3. Static App Shell assets (Next.js bundles, icons, manifest, fonts):
  //    Stale-While-Revalidate for instant iOS PWA cold start
  if (
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/_next/static/') ||
      url.pathname === '/manifest.json' ||
      url.pathname === '/apple-touch-icon.png' ||
      url.pathname === '/icon-192.png' ||
      url.pathname === '/icon-512.png' ||
      url.pathname === '/phong-signature.png')
  ) {
    event.respondWith(handleStaticAssetFetch(event.request))
  }
})

async function handleNavigateFetch(request) {
  try {
    const networkResponse = await fetch(request)
    if (networkResponse && networkResponse.status === 200) {
      const clone = networkResponse.clone()
      caches.open(SHELL_CACHE_NAME).then((cache) => {
        cache.put(request, clone).catch(() => {})
      })
    }
    return networkResponse
  } catch (err) {
    const cachedPage = await caches.match(request)
    if (cachedPage) return cachedPage
    const cachedRoot = await caches.match('/')
    if (cachedRoot) return cachedRoot
    return new Response('Offline — Vui lòng kiểm tra kết nối mạng.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
}

async function handleStaticAssetFetch(request) {
  const cache = await caches.open(SHELL_CACHE_NAME)
  const cached = await cache.match(request)
  const networkPromise = fetch(request)
    .then((res) => {
      if (res && res.status === 200) {
        cache.put(request, res.clone()).catch(() => {})
      }
      return res
    })
    .catch(() => null)

  if (cached) {
    return cached
  }
  const networkRes = await networkPromise
  if (networkRes) return networkRes
  return new Response('Asset unavailable offline', { status: 504 })
}

async function handleAudioFetch(request) {
  try {
    const isRangeRequest = request.headers.has('range')
    const networkResponse = await fetch(request)

    // Only cache full HTTP 200 responses (skip 206 Partial Content / Range requests)
    if (!isRangeRequest && networkResponse.status === 200) {
      const responseToCache = networkResponse.clone()

      caches.open(AUDIO_CACHE_NAME).then(async (cache) => {
        try {
          await cache.put(request, responseToCache)
          const keys = await cache.keys()
          if (keys.length > MAX_CACHED_AUDIO) {
            const toDelete = keys.slice(0, keys.length - MAX_CACHED_AUDIO)
            await Promise.all(toDelete.map((key) => cache.delete(key)))
          }
        } catch (e) {
          // Cache storage error ignored
        }
      })
    }

    return networkResponse
  } catch (err) {
    const cachedResponse = await caches.match(request)
    if (cachedResponse) {
      return cachedResponse
    }
    return new Response('Audio unavailable offline', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    })
  }
}

// Reply to client liveness probes; this does not extend page or OS lifetime.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'KEEP_ALIVE') {
    // Acknowledge when the client supplied a reply port.
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({ type: 'ALIVE' })
    }
  }
})
