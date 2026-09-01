const CACHE_VERSION = 'replay-attendee-v1';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const DATA_CACHE = `${CACHE_VERSION}-data`;
const APP_SHELL = ['/', '/manifest.webmanifest', '/replay-icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => !key.startsWith(CACHE_VERSION)).map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.pathname === '/api/app/bootstrap' || (
    url.hostname === 'api.replaycon.in' && url.pathname === '/api/app/bootstrap'
  )) {
    event.respondWith(networkFirst(request, DATA_CACHE).catch(() => new Response(
      JSON.stringify({ error: 'offline_without_cached_event' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    )));
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL_CACHE).catch(() => caches.match('/')));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        const clone = response.clone();
        caches.open(SHELL_CACHE).then((cache) => cache.put(request, clone));
      }
      return response;
    })),
  );
});

// --- Push notifications -----------------------------------------------------

self.addEventListener('push', (event) => {
  // A push with no payload still means something happened, so show a neutral
  // notice rather than nothing at all. Some services also send empty pushes to
  // keep a subscription warm.
  let payload = { title: 'REPLAY', body: 'Something has changed at the event.' };
  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch {
      payload.body = event.data.text() || payload.body;
    }
  }

  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    // Tagging lets a newer notice about the same thing replace an older one
    // rather than stacking up on the lock screen.
    tag: payload.tag || 'replay',
    data: { url: payload.url || '/#now' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data && event.notification.data.url ? event.notification.data.url : '/#now';

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Reuse a tab that is already open rather than piling up windows: someone
    // at a convention taps a lot of these.
    for (const client of clients) {
      if (client.url.includes(self.location.origin)) {
        await client.focus();
        if ('navigate' in client) await client.navigate(target);
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
