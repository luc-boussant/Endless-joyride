// Builds two outputs from src/:
//   endless-joyland.html  the page published as the Claude artifact (no <html>/<head>; the host adds them)
//   app/                  the installable web app (PWA) for phones: full page, manifest, offline worker, icons
const fs = require('fs');
const crypto = require('crypto');
const dir = __dirname;
const read = f => fs.readFileSync(dir + '/src/' + f, 'utf8');
let body = read('index.html')
  .replace('/*CORE*/', () => read('core.js'))
  .replace('/*UI*/', () => read('ui.js'));

const version = crypto.createHash('sha1').update(body).digest('hex').slice(0, 10);
body = body.replace('__VERSION__', new Date().toISOString().slice(0, 10) + ' · ' + version.slice(0, 6));
fs.writeFileSync(dir + '/endless-joyland.html', body);
const app = dir + '/app';
fs.mkdirSync(app + '/icons', { recursive: true });
for (const f of fs.readdirSync(dir + '/src/icons')) fs.copyFileSync(dir + '/src/icons/' + f, app + '/icons/' + f);

const head = `<!doctype html>
<html lang="en" class="pwa">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#121834">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Joyland">
<meta name="description" content="An ad-free amusement park idle game.">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<link rel="icon" type="image/png" href="icons/icon-192.png">
`;
const swReg = `<script>
if ('serviceWorker' in navigator) {
  // Reload once when a newer version takes over, and look for one whenever the app comes back to the screen.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').then(reg => {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {}));
}
</script>`;
const page = head + body.replace('<div class="app">', '</head>\n<body>\n<div class="app">') + '\n' + swReg + '\n</body>\n</html>\n';
fs.writeFileSync(app + '/index.html', page);

fs.writeFileSync(app + '/manifest.webmanifest', JSON.stringify({
  name: 'Endless Joyland',
  short_name: 'Joyland',
  description: 'An ad-free amusement park idle game.',
  start_url: './',
  scope: './',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#121834',
  theme_color: '#121834',
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}, null, 2));

fs.writeFileSync(app + '/sw.js', `// Offline support: serve the game from the cache, refresh the cache in the background.
const CACHE = 'joyland-${version}';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png'];
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
`);
fs.writeFileSync(app + '/.nojekyll', '');
console.log('built version', version, '| artifact', body.length, 'bytes | app/index.html', page.length, 'bytes');
