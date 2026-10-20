/* ============================================================================
   VibeJournal — service worker
   Precache the whole app so it runs with zero network. Bump VERSION to release.
   ========================================================================== */
'use strict';

var VERSION = 'v1.1.0';
var CACHE = 'vibejournal-' + VERSION;

var SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/db.js',
  './js/stats.js',
  './js/instruments.js',
  './js/ui.js',
  './js/picker.js',
  './js/candles.js',
  './js/app.js',
  './vendor/chart.umd.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.svg',
  './icons/favicon-32.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // addAll fails the whole install if any single asset 404s — add
      // individually so one bad path never breaks offline support.
      return Promise.all(SHELL.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () {
          return null;
        });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // navigations: network-first so updates land, cache as the offline safety net
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put('./index.html', copy); });
          return res;
        })
        .catch(function () {
          return caches.match('./index.html').then(function (r) {
            return r || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
          });
        })
    );
    return;
  }

  // everything else: cache-first, quietly refresh in the background
  e.respondWith(
    caches.match(req).then(function (cached) {
      var network = fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return cached; });
      return cached || network;
    })
  );
});

self.addEventListener('message', function (e) {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
