const CACHE_NAME = 'home-library-v6';

const PRECACHE_URLS = [
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/data.js',
  'js/ui.js',
  'manifest.json',
  'icons/icon-192.svg',
  'data/books.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isApiRequest(url) {
  return url.hostname.includes('script.google.com');
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (isApiRequest(url)) {
    // Network-first for the Apps Script API.
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Network-first for the app shell too, falling back to the cache when
  // offline. Cache-first meant a deployed update only showed up after the
  // service worker itself changed *and* the page was reloaded twice.
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
