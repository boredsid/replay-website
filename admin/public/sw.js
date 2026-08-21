// Cache only the versioned app shell. Admin API responses can contain private
// attendee data and must never be persisted by the service worker.
// Shell entries are served cache-first, so bump this version whenever anything
// in the list below changes: an installed app keeps serving its cached copy
// until the cache name changes, however many times the asset is redeployed.
const SHELL_CACHE = 'replay-admin-shell-v1';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon-32.png',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('replay-admin-') && key !== SHELL_CACHE)
          .map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Authentication, logout, and admin data always go directly to the network.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/cdn-cgi/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match('/index.html').then((cached) => cached || Response.error()),
      ),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy)));
        }
        return response;
      });
    }),
  );
});
