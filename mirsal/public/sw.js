// Minimal service worker: makes the app installable (required by TWA builders).
// It never caches API or realtime traffic and always prefers the network,
// so users always get the latest interface after a deploy.
self.addEventListener('install', (event) => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname === '/ws') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
