const CACHE_NAME = 'letitedit-v2';
const ASSETS = [
  '/', '/index.html', '/site.css', '/tools.js',
  '/freelance.html', '/freelance.css', '/faq.html', '/about.html', '/privacy.html', '/terms.html'
];

self.addEventListener('install', (e) => {
  self.skipWaiting(); // Force the new service worker to take over immediately
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.map(key => { if (key !== CACHE_NAME) return caches.delete(key); })
    ))
  );
  self.clients.claim();
});

// NETWORK-FIRST STRATEGY
self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        // If the network request is successful, save a copy to the cache
        const resClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, resClone));
        return response;
      })
      .catch(() => caches.match(e.request)) // If offline, load from cache
  );
});
