// Offline cache – so the app opens without network once visited.
// Bump CACHE on every deploy that changes config.js: a stale key cached here
// (or in the browser's own HTTP cache) would otherwise outlive the fix.
const CACHE = 'stash-v4';
const ASSETS = [
  './', './index.html', './config.js', './manifest.json',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // never cache Supabase traffic — it must hit the network or fail loudly
  if (!e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    // no-store: bypass the browser's own HTTP cache too, not just this cache API
    // (index.html and config.js are tiny and must never be served stale)
    fetch(e.request, { cache: 'no-store' })
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
