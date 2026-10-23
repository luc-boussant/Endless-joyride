// Offline support: serve the game from the cache, refresh the cache in the background.
const CACHE = 'joyland-c0c2225553';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'vendor/three.min.js', 'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const page = e.request.mode === 'navigate' || e.request.destination === 'document';
  e.respondWith(caches.open(CACHE).then(async cache => {
    const hit = await cache.match(e.request, { ignoreSearch: true }) || (page ? await cache.match('index.html') : null);
    const net = fetch(e.request, page ? { cache: 'no-cache' } : undefined)
      .then(res => { if (res && (res.ok || res.type === 'opaque')) cache.put(e.request, res.clone()); return res; });
    if (page) {
      // The game page itself: newest version when online, cached copy when offline or slow.
      const timeout = new Promise(r => setTimeout(() => r(null), 4000));
      const res = await Promise.race([net.catch(() => null), timeout]);
      return res || hit || net;
    }
    return hit || net.catch(() => hit);
  }));
});
