// Biscord service worker: uygulama kabuğunu önbelleğe alır, anlık bildirimleri gösterir
const CACHE = 'biscord-v3';
const SHELL = ['/', '/css/app.css', '/css/v2.css', '/css/v3.css', '/js/app.js', '/js/util.js', '/js/api.js', '/js/voice.js', '/js/emoji.js', '/js/ctx.js', '/favicon.svg', '/icons/icon-192.png', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Önce ağ, ağ yoksa önbellek (güncellemeler hemen görünür, çevrimdışıyken kabuk açılır)
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/') || url.pathname.startsWith('/uploads/')) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok && (SHELL.includes(url.pathname) || url.pathname.startsWith('/js/') || url.pathname.startsWith('/css/'))) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || (e.request.mode === 'navigate' ? caches.match('/') : undefined))),
  );
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch { d = { title: 'Biscord', body: e.data?.text() }; }
  e.waitUntil((async () => {
    // Biscord açık ve görünürse bildirim gösterme (uygulama kendisi gösterir)
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.some((w) => w.visibilityState === 'visible')) return;
    await self.registration.showNotification(d.title || 'Biscord', {
      body: d.body || '', icon: d.icon || '/icons/icon-192.png', badge: '/icons/badge-72.png',
      tag: d.tag, renotify: !!d.tag, data: { url: d.url || '/channels/@me' }, vibrate: [80, 40, 80],
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '/channels/@me';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = wins.find((c) => new URL(c.url).origin === location.origin);
    if (w) { await w.focus(); w.postMessage({ type: 'navigate', url }); } else await self.clients.openWindow(url);
  })());
});
