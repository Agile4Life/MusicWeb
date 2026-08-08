// MusicWeb Service Worker — Background Audio + Audio Caching
// Keeps audio playing when app is minimized/screen locked on mobile

const CACHE_NAME = 'musicweb-audio-v2'
const MAX_CACHED_AUDIO = 30 // max number of audio responses to cache

self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Clean up old caches
      caches.keys().then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith('musicweb-') && name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        )
      ),
    ])
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Only intercept audio stream requests from our own API
  if (url.pathname === '/api/drive-stream') {
    event.respondWith(handleAudioFetch(event.request))
    return
  }

  // For navigation and other requests, use network-first strategy
  // This keeps the app shell working even with spotty connections
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    )
    return
  }
})

async function handleAudioFetch(request) {
  try {
    // Always try network first for fresh audio
    const networkResponse = await fetch(request)

    // If the response is a redirect (302), follow it and cache the final response
    // The drive-stream API now returns 302 redirects to Google CDN
    if (networkResponse.ok || networkResponse.status === 206 || networkResponse.type === 'opaqueredirect') {
      // Clone the response before caching (response body can only be consumed once)
      const responseToCache = networkResponse.clone()

      // Cache in background — don't block the response
      caches.open(CACHE_NAME).then(async (cache) => {
        try {
          await cache.put(request, responseToCache)
          // Evict oldest entries if cache is too large
          const keys = await cache.keys()
          if (keys.length > MAX_CACHED_AUDIO) {
            const toDelete = keys.slice(0, keys.length - MAX_CACHED_AUDIO)
            await Promise.all(toDelete.map((key) => cache.delete(key)))
          }
        } catch (e) {
          // Cache storage full or other error — not critical
        }
      })
    }

    return networkResponse
  } catch (err) {
    // Network failed — try serving from cache (offline playback)
    const cachedResponse = await caches.match(request)
    if (cachedResponse) {
      return cachedResponse
    }
    // No cache available either
    return new Response('Audio unavailable offline', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    })
  }
}

// Keep service worker alive during audio playback
// This prevents the browser from killing the SW while music is playing
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'KEEP_ALIVE') {
    // Acknowledge to keep the connection alive
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({ type: 'ALIVE' })
    }
  }
})
