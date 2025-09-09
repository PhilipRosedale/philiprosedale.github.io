const CACHE_NAME = 'run-tracker-v1';
const urlsToCache = [
  './',
  './running.html',
  './manifest.json',
  './favicon.ico'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  // Don't cache Google Sign-In requests
  if (event.request.url.includes('accounts.google.com') || 
      event.request.url.includes('gsi/client')) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Return cached version or fetch from network
        return response || fetch(event.request);
      })
      .catch(error => {
        console.error('Service worker fetch error:', error);
        // Return a fallback response for navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match('./running.html');
        }
        return new Response('Network error', { status: 503 });
      })
  );
}); 