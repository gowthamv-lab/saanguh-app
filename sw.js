// ===============================
// Saanguh Service Worker
// Minimal SW for PWA + background audio
// Does NOT interfere with existing network requests
// ===============================

const CACHE_NAME = 'saanguh-v1';

// Only cache essential static assets (not audio streams)
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/index.css',
  '/css/components.css',
  '/css/player.css',
  '/css/responsive.css',
  '/js/supabase.js',
  '/js/auth.js',
  '/js/songs.js',
  '/js/player.js',
  '/js/playlists.js',
  '/js/favorites.js',
  '/js/downloads.js',
  '/js/app.js'
];

// Install: cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: network-first strategy (safe, won't break anything)
// Only falls back to cache if network fails
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // NEVER cache/intercept audio streams, API calls, or external requests
  if (
    event.request.url.includes('/stream/') ||
    event.request.url.includes('/api/') ||
    event.request.url.includes('/proxy/') ||
    event.request.url.includes('supabase') ||
    event.request.url.includes('googleapis') ||
    event.request.url.includes('gstatic') ||
    url.origin !== self.location.origin
  ) {
    return; // Let the browser handle these normally
  }

  // For same-origin static assets: network first, cache fallback
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Update cache with fresh response
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() => {
        // Network failed, try cache
        return caches.match(event.request);
      })
  );
});
