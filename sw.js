/* Service worker - network-first so updates arrive immediately;
   falls back to cache only when offline. */
const CACHE = 'travel-planner-v4';
const ASSETS = [
  './index.html',
  './css/styles.css',
  './js/links.js',
  './js/storage.js',
  './js/prices.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // never intercept cross-origin requests (e.g. live price API calls)
  if (new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() =>
      caches.match(e.request).then((hit) => hit ||
        (e.request.mode === 'navigate' ? caches.match('./index.html') : Promise.reject(new Error('offline'))))
    )
  );
});
