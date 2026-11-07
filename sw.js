const CACHE_NAME = 'letitedit-v1';
const ASSETS = [
  '/', '/index.html', '/site.css', '/tools.js', 
  '/freelance.html', '/freelance.css', '/faq.html', '/about.html', '/privacy.html', '/terms.html'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => {
      return response || fetch(e.request);
    })
  );
});
