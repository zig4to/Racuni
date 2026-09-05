/* Predpomnilnik lupine aplikacije, da deluje tudi brez povezave.
   Ob spremembi datotek povečaj VERSION. */
var VERSION = 'racuni-v47';
var SHELL = [
  './', './index.html', './style.css', './icon.svg', './manifest.json',
  './js/db.js', './js/detect.js', './js/app.js', './js/boni.js', './js/sync.js', './js/cloud.js', './js/install-promo.js',
  './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-maskable-192.png', './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }).then(function () {
    return self.skipWaiting();
  }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  /* Razširitve brskalnika (npr. avtomatski drsniki) včasih v stran vrinejo
     lastne zahteve s shemo chrome-extension:/moz-extension: — te gredo skozi
     fetch tega SW, ker teče znotraj nadzorovane strani, Cache API pa jih ne
     zna shraniti (samo http/https). Brez tega preskoka c.put() vrže
     nepričakovano napako v konzoli ob vsaki taki zahtevi. */
  if (e.request.url.indexOf('http') !== 0) return;
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      return hit || fetch(e.request).then(function (res) {
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put(e.request, copy); });
        return res;
      }).catch(function () { return hit; });
    })
  );
});
