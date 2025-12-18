const CACHE_NAME = 'ficha-app-v2';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  // Activate the new service worker as soon as it's finished installing.
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Service Worker: Cache abierto');
      return cache.addAll(urlsToCache);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  // Only handle http(s) requests. Browser extensions and internal schemes
  // like chrome-extension:// cannot be cached and will throw.
  let url;
  try {
    url = new URL(event.request.url);
  } catch (_) {
    return;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return;
  }

  // Only cache same-origin requests. Let the browser handle third-party/CDN.
  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) {
        return response;
      }

      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }

        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          try {
            // cache.put() returns a Promise; always handle rejections to avoid
            // "Uncaught (in promise)" noise.
            cache.put(event.request, responseToCache).catch(() => {});
          } catch (_) {
            // If caching throws synchronously, ignore.
          }
        });

        return response;
      });
    }).catch(() => {
      // Only fall back to the app shell for navigations.
      if (event.request.mode === 'navigate') {
        return caches.match('/index.html');
      }
      throw new Error('Network error');
    })
  );
});
