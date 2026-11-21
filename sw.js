// خدمة التطبيق: تخلي الموقع يتثبت كتطبيق ويفتح بسرعة، ودائمًا يجيب آخر نسخة من الإنترنت أول
const CACHE = 'aqeq-v1';
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)).catch(() => {}); return r; })
    .catch(() => caches.match(e.request).then((r) => r || caches.match('./'))));
});
