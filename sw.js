/*
 * description: Caches static app resources and serves cached copies offline.
 * createdDate: 2026-11-17
 * maintainer: Truong Lai
 */
var CACHE_NAME = 'evsound-v88';

self.addEventListener('install', function (event) {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if ((key.indexOf('teslasound-v') === 0 || key.indexOf('evsound-v') === 0) && key !== CACHE_NAME) {
          return caches.delete(key);
        }
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.indexOf('/api/') === 0) return;

  var isAppAsset = request.mode === 'navigate' ||
    /\.(?:html|js|css|svg|png|jpe?g|webp|ico|woff2?)$/i.test(url.pathname);
  if (!isAppAsset) return;

  event.respondWith(
    fetch(request).then(function (response) {
      if (!response.ok || response.type !== 'basic') return response;
      return caches.open(CACHE_NAME).then(function (cache) {
        return cache.put(request, response.clone()).then(function () {
          return response;
        });
      });
    }).catch(function () {
      return caches.match(request).then(function (cached) {
        if (cached) return cached;
        throw new Error('Network request failed and no cached copy is available.');
      });
    })
  );
});
